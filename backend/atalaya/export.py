"""Export deliverable datasets, scenario maps, and documentation for ATALAYA."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import numpy as np
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
import pandas as pd

from atalaya import config
from atalaya.ingest.common import read_parquet, to_num, zpad
from atalaya.model.forecast import BASE_FEATURES, CCPC_FEATURES
from atalaya.model.recommend import build_reference, recommend
from atalaya.model.scenarios import simulate


CATEGORIES = ["verde", "amarillo", "naranja", "rojo", "sin_dato"]


def round_val(v: float | int | None, decimals: int = 4) -> float | int | None:
    """Safely round numeric value or return None if NaN/None."""
    if v is None or pd.isna(v):
        return None
    try:
        val = float(v)
        if decimals == 0:
            return int(round(val))
        return round(val, decimals)
    except (ValueError, TypeError):
        return None


def get_gov_2027_entities(seed_dir: Path | None = None) -> set[str]:
    """Return set of 2-digit cve_ent that have gubernatorial elections in 2027."""
    default_gov_2027 = {
        "01", "02", "03", "04", "06", "08", "12", "16",
        "18", "19", "22", "23", "24", "25", "26", "29", "32",
    }
    s_dir = Path(seed_dir) if seed_dir is not None else config.SEED_DIR
    p = s_dir / "concurrencia_gubernatura.csv"
    if not p.is_file():
        alt_p = Path(__file__).resolve().parent.parent.parent / "data/seed/concurrencia_gubernatura.csv"
        if alt_p.is_file():
            p = alt_p
    if p.is_file():
        try:
            df_gov = pd.read_csv(p, dtype={"cve_ent": str, "year": int})
            df_2027 = df_gov[df_gov["year"] == 2027]
            ents = set(df_2027["cve_ent"].astype(str).str.strip().apply(lambda x: zpad(str(x), 2)))
            if ents:
                return ents
        except Exception:
            pass
    return default_gov_2027


def format_excel_sheet(ws: openpyxl.worksheet.worksheet.Worksheet, df: pd.DataFrame | None = None) -> None:
    """Apply styling: bold header, header fill, freeze panes, and sampled column auto-widths."""
    header_fill = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")

    ws.freeze_panes = "A2"
    if ws.max_row >= 1:
        for col_idx in range(1, ws.max_column + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # Estimate column widths efficiently without traversing entire sheet
    if df is not None and not df.empty:
        sample_df = df.head(50)
        for idx, col_name in enumerate(df.columns, start=1):
            col_letter = get_column_letter(idx)
            max_val_len = sample_df[col_name].astype(str).str.len().max() if len(sample_df) > 0 else 0
            name_len = len(str(col_name))
            best_len = max(name_len, int(max_val_len) if pd.notna(max_val_len) else 0)
            ws.column_dimensions[col_letter].width = min(max(best_len + 4, 12), 50)
    else:
        for col_idx in range(1, ws.max_column + 1):
            col_letter = get_column_letter(col_idx)
            cell_val = ws.cell(row=1, column=col_idx).value
            ws.column_dimensions[col_letter].width = min(max(len(str(cell_val or "")) + 4, 12), 50)


def create_leeme_dataframe(metrics_data: dict | None = None) -> pd.DataFrame:
    """Create descriptive content for LEEME sheet and CSV."""
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    m = metrics_data or {}
    sel_model = m.get("selected_model", "persist_l1 (fallback)")
    nat_level = m.get("national_level_assumption", 51.84)
    offset = m.get("offset_pp", m.get("offset", "N/D"))

    lines = [
        ("PROYECTO", "ATALAYA — Predicción y Escenarios de Riesgo de Abstención Electoral en México"),
        ("CONVOCATORIA", "Hackathon INE — Reto 2: Predicción y escenarios de riesgo de abstención"),
        ("ELECCIÓN OBJETIVO", "Elección Federal 2027 (Diputaciones Federales)"),
        ("FECHA DE GENERACIÓN", now_str),
        (
            "AVISO DE PRIVACIDAD Y ÉTICA",
            "Datos estrictamente agregados a nivel municipal y estatal. No contiene datos personales ni registros del padrón electoral nominativo.",
        ),
        (
            "DESCRIPCIÓN GENERAL",
            "Base de datos analítica con proyecciones de participación, índice de riesgo de abstención, descomposición de factores explicativos (drivers), recomendaciones preventivas estructuradas y simulación de escenarios de intervención.",
        ),
        ("REGLA DE CONFIABILIDAD HISTÓRICA (CCPC §11.1)", ""),
        (
            "Criterio de confiabilidad",
            "Un municipio-año se considera 'confiable' (reliable = True) si la tasa de condición no especificada ns_rate <= 0.50 y la participación observada >= 0.02 (participacion >= 0.02, 2.0%). Registros con 0.30 < ns_rate <= 0.50 se catalogan de baja confianza (low_confidence = True).",
        ),
        (
            "Tratamiento de registros no confiables",
            "Los registros no confiables (ns_rate > 0.50 o participacion < 0.02) se excluyen de la calibración y rezagos del modelo econométrico, y se exportan con participación vacía (nunca como 0%) para evitar sesgos por cuadernillos no disponibles.",
        ),
        ("MODELO PREDICTIVO SELECCIONADO Y DESEMPEÑO (§11.3)", ""),
        (
            "Modelo seleccionado",
            f"Modelo ganador del torneo de candidatos: '{sel_model}'. Seleccionado por menor MAE promedio en backtests honestos (folds 2021 y 2024).",
        ),
    ]

    candidates = m.get("candidates", [])
    if candidates:
        cand_str = " | ".join(
            f"{c.get('name')}: MAE={c.get('mean_mae_pp', c.get('mae_avg', c.get('mae_pp')))} pp"
            + (f", Spearman={c.get('spearman_avg', c.get('spearman'))}" if (c.get('spearman_avg') or c.get('spearman')) else "")
            + (f", top20_hit={c.get('top20_hit_avg', c.get('top20_hit'))}" if (c.get('top20_hit_avg') or c.get('top20_hit')) else "")
            for c in candidates
        )
        lines.append(("Evaluación de candidatos en competencia", cand_str))

    backtests = m.get("backtests", [])
    if backtests:
        bt_str = " | ".join(
            f"Fold {b.get('test_year')}: MAE={b.get('mae_pp')} pp (vs naive {b.get('baseline_mae_pp')} pp), RMSE={b.get('rmse_pp')} pp, Spearman={b.get('spearman')}, top20_hit={b.get('top20_hit')}"
            for b in backtests
        )
        lines.append(("Desempeño en backtest out-of-sample", bt_str))

    lines.extend([
        ("SUPUESTO DE NIVEL NACIONAL 2027", ""),
        (
            "Supuesto nacional",
            f"Nivel nacional supuesto para la intermedia 2027: {nat_level}% (basado en la última intermedia federal comparable de 2021 = 51.84%). Offset histórico de intermedias: {offset} pp.",
        ),
        (
            "ADVERTENCIA METODOLÓGICA",
            "El semáforo compara zonas entre sí; las cifras absolutas dependen del supuesto nacional.",
        ),
        ("FUENTES OFICIALES", ""),
        (
            "INE — Plataforma CCPC (2009-2024)",
            "Conteos Censales de Participación Ciudadana del Instituto Nacional Electoral (INE). URL: https://sicee.ine.mx / Plataforma CCPC",
        ),
        (
            "INEGI — Censo de Población y Vivienda 2020",
            "Principales resultados por localidad y municipio (ITER 2020). URL: https://www.inegi.org.mx/programas/ccpv/2020/",
        ),
        (
            "CONAPO — Marginación Municipal 2020",
            "Índices de marginación municipal 2020, Consejo Nacional de Población. URL: https://www.gob.mx/conapo/documentos/indices-de-marginacion-2020-284372",
        ),
        (
            "INEGI — Marco Geoestadístico 2024",
            "Límites político-administrativos municipales y estatales 2024 (2,478 municipios). URL: https://www.inegi.org.mx/temas/mg/",
        ),
        ("SEMÁFORO DE RIESGO DE ABSTENCIÓN", ""),
        ("Verde", "Riesgo bajo (Índice de riesgo < 35.0). Tendencia favorable o estabilidad alta."),
        ("Amarillo", "Riesgo moderado (35.0 <= Índice de riesgo < 55.0). Factores de atención media."),
        ("Naranja", "Riesgo alto (55.0 <= Índice de riesgo < 75.0). Se recomienda focalización preventiva prioritaria."),
        ("Rojo", "Riesgo muy alto (Índice de riesgo >= 75.0). Máxima prioridad institucional para intervención anticipada."),
        ("Sin dato", "Información histórica insuficiente para estimar tendencia o pronóstico confiable."),
        ("ESCENARIOS SIMULADOS", ""),
        (
            "Base (Sin intervención)",
            "Pronóstico inercial de desviaciones relativas respecto a la media nacional con concurrencia de gubernatura 2027.",
        ),
        (
            "Intervención (Hipotética focalizada)",
            "Efecto de programas preventivos dirigidos (voto joven, casillas rurales, lenguas indígenas o campaña general) con cobertura parametrizable.",
        ),
        (
            "Pesimista",
            "Escenario adverso con choque general a la baja (-2.0 pp de participación) y acentuación del 50% en tendencias negativas.",
        ),
    ])
    return pd.DataFrame(lines, columns=["seccion", "contenido"])


def create_dictionary_dataframe() -> pd.DataFrame:
    """Create data dictionary catalog for all sheets."""
    dic_rows = [
        # municipios
        ("municipios", "id", "Clave geoestadística única del municipio (CVEGEO, 5 dígitos)", "clave", "INEGI 2024"),
        ("municipios", "cve_ent", "Clave de entidad federativa (2 dígitos)", "clave", "INEGI/INE"),
        ("municipios", "name", "Nombre oficial del municipio", "texto", "INEGI 2024"),
        ("municipios", "lista_nominal", "Número de ciudadanos en lista nominal de electores (última elección)", "personas", "INE CCPC"),
        ("municipios", "last_year", "Año de la última elección federal de diputaciones registrada", "año", "INE CCPC"),
        ("municipios", "last_reliable_year", "Último año con datos de participación confiables (ns_rate <= 0.5)", "año", "ATALAYA"),
        ("municipios", "last_participation", "Participación observada en la última elección federal", "proporción (0-1)", "INE CCPC"),
        ("municipios", "pred_participation_base", "Participación estimada para 2027 en escenario base", "proporción (0-1)", "ATALAYA Modelo"),
        ("municipios", "pred_abstention_base", "Abstención pronosticada para 2027 en escenario base (1 - participación)", "proporción (0-1)", "ATALAYA Modelo"),
        ("municipios", "pred_dev_pp", "Desviación pronosticada de participación respecto a la media nacional", "puntos porcentuales", "ATALAYA Modelo"),
        ("municipios", "fallback_model", "Modelo econométrico alternativo utilizado por rezagos incompletos", "texto", "ATALAYA Modelo"),
        ("municipios", "gov_2027", "Indicador si la entidad tiene elección de gubernatura en 2027 (1=Sí, 0=No)", "binario", "INE Calendario"),
        ("municipios", "pred_low_base", "Límite inferior del intervalo de confianza al 90% para abstención 2027", "proporción (0-1)", "ATALAYA Modelo"),
        ("municipios", "pred_high_base", "Límite superior del intervalo de confianza al 90% para abstención 2027", "proporción (0-1)", "ATALAYA Modelo"),
        ("municipios", "trend_pp", "Tendencia histórica relativa de participación por elección federal", "puntos porcentuales", "ATALAYA Modelo"),
        ("municipios", "volatility_pp", "Volatilidad cíclica histórica de la participación", "puntos porcentuales", "ATALAYA Modelo"),
        ("municipios", "risk_score_base", "Índice sintético de riesgo de abstención (0-100)", "índice", "ATALAYA Modelo"),
        ("municipios", "category_base", "Categoría del semáforo de riesgo en escenario base", "categoría", "ATALAYA Modelo"),
        ("municipios", "pred_abstention_intervencion", "Abstención estimada 2027 bajo escenario de intervención", "proporción (0-1)", "ATALAYA Modelo"),
        ("municipios", "category_intervencion", "Categoría del semáforo bajo escenario de intervención", "categoría", "ATALAYA Modelo"),
        ("municipios", "delta_pp_intervencion", "Diferencia de abstención vs base en intervención (negativo = reducción)", "puntos porcentuales", "ATALAYA Modelo"),
        ("municipios", "pred_abstention_pesimista", "Abstención estimada 2027 bajo escenario pesimista", "proporción (0-1)", "ATALAYA Modelo"),
        ("municipios", "category_pesimista", "Categoría del semáforo bajo escenario pesimista", "categoría", "ATALAYA Modelo"),
        ("municipios", "delta_pp_pesimista", "Diferencia de abstención vs base en escenario pesimista", "puntos porcentuales", "ATALAYA Modelo"),
        ("municipios", "top_driver", "Principal factor sociodemográfico que empuja el riesgo de abstención", "texto", "ATALAYA Modelo"),
        ("municipios", "top_recommendation", "Recomendación institucional preventiva prioritaria", "texto", "ATALAYA Reglas"),
        ("municipios", "coverage_ln", "Cobertura de lista nominal respecto a población en edad de votar", "proporción (0-1.2)", "INE CCPC / INEGI"),
        ("municipios", "pob_tot", "Población total municipal Censo 2020", "personas", "INEGI 2020"),
        ("municipios", "pob_18ymas", "Población de 18 años y más Censo 2020", "personas", "INEGI 2020"),
        ("municipios", "pct_18_24", "Proporción de jóvenes de 18 a 24 años sobre adultos", "proporción (0-1)", "INEGI 2020"),
        ("municipios", "pct_65ymas", "Proporción de adultos mayores (65+) sobre adultos", "proporción (0-1)", "INEGI 2020"),
        ("municipios", "graproes", "Grado promedio de escolaridad (población de 15 años y más)", "años", "INEGI 2020"),
        ("municipios", "pct_hli", "Proporción de población hablante de lengua indígena", "proporción (0-1)", "INEGI 2020"),
        ("municipios", "pct_sin_servsalud", "Proporción de población sin afiliación a servicios de salud", "proporción (0-1)", "INEGI 2020"),
        ("municipios", "pct_internet", "Proporción de viviendas habitadas con internet", "proporción (0-1)", "INEGI 2020"),
        ("municipios", "pct_rural", "Proporción de población en localidades rurales (< 2,500 hab.)", "proporción (0-1)", "INEGI 2020"),
        ("municipios", "pct_analfabeta", "Proporción de población analfabeta de 15 años y más", "proporción (0-1)", "CONAPO 2020"),
        ("municipios", "pct_po2sm", "Proporción de población ocupada con ingresos hasta 2 salarios mínimos", "proporción (0-1)", "CONAPO 2020"),
        ("municipios", "im_2020", "Índice de marginación municipal CONAPO 2020", "índice", "CONAPO 2020"),
        ("municipios", "gm_2020", "Grado de marginación municipal CONAPO 2020", "categoría", "CONAPO 2020"),
        ("municipios", "part_pj_2025", "Participación en elección judicial federal extraordinaria 2025", "proporción (0-1)", "INE 2025"),
        ("municipios", "pct_ln_18_34", "Proporción de lista nominal entre 18 y 34 años en última DIP_FED", "proporción (0-1)", "INE CCPC"),
        ("municipios", "part_18_34", "Participación de electores 18-34 años en última elección federal", "proporción (0-1)", "INE CCPC"),
        ("municipios", "gap_youth_pp", "Brecha de participación juvenil vs promedio municipal en pp", "puntos porcentuales", "INE CCPC"),
        ("municipios", "gap_sexo_pp", "Brecha de participación mujeres vs hombres (part_M - part_H) en pp", "puntos porcentuales", "INE CCPC"),
        ("municipios", "pct_ln_rural", "Proporción de lista nominal en secciones rurales", "proporción (0-1)", "INE CCPC"),
        ("municipios", "imputed_census", "Indicador si los datos de censo fueron imputados por creación municipal post-2020", "booleano", "ATALAYA"),

        # estados
        ("estados", "id", "Clave de entidad federativa (2 dígitos)", "clave", "INEGI/INE"),
        ("estados", "name", "Nombre de la entidad federativa", "texto", "INEGI 2024"),
        ("estados", "lista_nominal", "Lista nominal total agregada estatal", "personas", "INE CCPC"),
        ("estados", "last_year", "Año de la última elección federal", "año", "INE CCPC"),
        ("estados", "last_participation", "Participación observada estatal última elección", "proporción (0-1)", "INE CCPC"),
        ("estados", "pred_participation_base", "Participación estimada estatal 2027 escenario base", "proporción (0-1)", "ATALAYA Modelo"),
        ("estados", "pred_abstention_base", "Abstención pronosticada estatal 2027 escenario base", "proporción (0-1)", "ATALAYA Modelo"),
        ("estados", "pred_low_base", "Límite inferior del intervalo de abstención estatal", "proporción (0-1)", "ATALAYA Modelo"),
        ("estados", "pred_high_base", "Límite superior del intervalo de abstención estatal", "proporción (0-1)", "ATALAYA Modelo"),
        ("estados", "trend_pp", "Tendencia histórica estatal de participación", "puntos porcentuales", "ATALAYA Modelo"),
        ("estados", "volatility_pp", "Volatilidad cíclica histórica estatal", "puntos porcentuales", "ATALAYA Modelo"),
        ("estados", "risk_score_base", "Índice de riesgo estatal agregado", "índice", "ATALAYA Modelo"),
        ("estados", "category_base", "Semáforo de riesgo estatal", "categoría", "ATALAYA Modelo"),
        ("estados", "pred_abstention_intervencion", "Abstención estatal estimada en intervención", "proporción (0-1)", "ATALAYA Modelo"),
        ("estados", "category_intervencion", "Semáforo estatal en intervención", "categoría", "ATALAYA Modelo"),
        ("estados", "delta_pp_intervencion", "Reducción de abstención estatal en intervención", "puntos porcentuales", "ATALAYA Modelo"),
        ("estados", "pred_abstention_pesimista", "Abstención estatal estimada en escenario pesimista", "proporción (0-1)", "ATALAYA Modelo"),
        ("estados", "category_pesimista", "Semáforo estatal en escenario pesimista", "categoría", "ATALAYA Modelo"),
        ("estados", "delta_pp_pesimista", "Aumento de abstención estatal en escenario pesimista", "puntos porcentuales", "ATALAYA Modelo"),
        ("estados", "top_driver", "Principal factor de abstención estatal", "texto", "ATALAYA Modelo"),
        ("estados", "top_recommendation", "Recomendación institucional prioritaria estatal", "texto", "ATALAYA Reglas"),

        # semaforo_ponderado
        ("semaforo_ponderado", "scenario", "Escenario simulado ('base', 'intervencion', 'pesimista')", "texto", "ATALAYA"),
        ("semaforo_ponderado", "category", "Categoría del semáforo de riesgo", "categoría", "ATALAYA"),
        ("semaforo_ponderado", "n_municipios", "Número de municipios clasificados en la categoría", "entero", "ATALAYA"),
        ("semaforo_ponderado", "pct_municipios", "Porcentaje sobre el total de municipios", "porcentaje", "ATALAYA"),
        ("semaforo_ponderado", "lista_nominal", "Electores acumulados en lista nominal de esa categoría", "personas", "ATALAYA / CCPC"),
        ("semaforo_ponderado", "pct_lista_nominal", "Porcentaje sobre la lista nominal nacional", "porcentaje", "ATALAYA"),

        # participacion_historica
        ("participacion_historica", "id", "Clave geográfica (CVEGEO 5 dígitos para municipio, 2 para estado)", "clave", "INE CCPC"),
        ("participacion_historica", "level", "Nivel geográfico ('mun' o 'state')", "texto", "ATALAYA"),
        ("participacion_historica", "cve_ent", "Clave de entidad federativa (2 dígitos)", "clave", "INEGI/INE"),
        ("participacion_historica", "name", "Nombre de la unidad geográfica", "texto", "INEGI 2024"),
        ("participacion_historica", "year", "Año de la elección federal", "año", "INE CCPC"),
        ("participacion_historica", "election", "Tipo de elección ('DIP_FED', 'PJF', etc.)", "clave", "INE CCPC"),
        ("participacion_historica", "lista_nominal", "Ciudadanos inscritos en lista nominal (LN)", "personas", "INE CCPC"),
        ("participacion_historica", "votos_totales", "Votos emitidos con marca de voto (SV)", "votos", "INE CCPC"),
        ("participacion_historica", "nv", "Ciudadanos sin marca de voto (NV)", "personas", "INE CCPC"),
        ("participacion_historica", "ns", "Registros con condición no especificada (NS)", "personas", "INE CCPC"),
        ("participacion_historica", "ns_rate", "Tasa de registros no especificados (NS / LN)", "proporción (0-1)", "INE CCPC"),
        ("participacion_historica", "reliable", "Indicador de confiabilidad (ns_rate <= 0.50 y participacion >= 0.02)", "booleano", "ATALAYA"),
        ("participacion_historica", "low_confidence", "Indicador de baja confianza (0.30 < ns_rate <= 0.50)", "booleano", "ATALAYA"),
        ("participacion_historica", "participacion", "Participación oficial calculada como SV / (SV + NV). Vacía si no es confiable.", "proporción (0-1)", "INE CCPC"),

        # perfil_edad_sexo
        ("perfil_edad_sexo", "cvegeo", "Clave geográfica municipal (5 dígitos)", "clave", "INE CCPC"),
        ("perfil_edad_sexo", "cve_ent", "Clave de entidad federativa (2 dígitos)", "clave", "INE CCPC"),
        ("perfil_edad_sexo", "year", "Año de la elección", "año", "INE CCPC"),
        ("perfil_edad_sexo", "election", "Tipo de elección", "clave", "INE CCPC"),
        ("perfil_edad_sexo", "age_group", "Grupo de edad ('18-24', '25-34', etc.)", "categoría", "INE CCPC"),
        ("perfil_edad_sexo", "sexo", "Sexo del elector ('H' hombre, 'M' mujer, 'X' no binario)", "categoría", "INE CCPC"),
        ("perfil_edad_sexo", "ln", "Lista nominal del grupo", "personas", "INE CCPC"),
        ("perfil_edad_sexo", "sv", "Votos con marca en el grupo", "votos", "INE CCPC"),
        ("perfil_edad_sexo", "nv", "Votos sin marca en el grupo", "personas", "INE CCPC"),
        ("perfil_edad_sexo", "ns", "Condición no especificada", "personas", "INE CCPC"),
        ("perfil_edad_sexo", "participacion", "Participación del subgrupo SV / (SV + NV)", "proporción (0-1)", "INE CCPC"),

        # drivers
        ("drivers", "id", "Clave geográfica de la unidad", "clave", "ATALAYA Modelo"),
        ("drivers", "level", "Nivel ('mun' o 'state')", "texto", "ATALAYA Modelo"),
        ("drivers", "rank", "Orden de importancia del factor (1 a 5)", "entero", "ATALAYA Modelo"),
        ("drivers", "key", "Identificador de la variable explicativa", "clave", "ATALAYA Modelo"),
        ("drivers", "label", "Nombre en español de la variable explicativa", "texto", "ATALAYA Catálogo"),
        ("drivers", "contribution_pp", "Efecto estimado sobre la abstención respecto a la media nacional", "puntos porcentuales", "ATALAYA Modelo"),
        ("drivers", "direction", "Sentido del efecto ('sube_abstencion' o 'baja_abstencion')", "texto", "ATALAYA Modelo"),

        # recomendaciones
        ("recomendaciones", "id", "Clave geográfica municipal o estatal", "clave", "ATALAYA"),
        ("recomendaciones", "level", "Nivel geográfico ('mun' o 'state')", "texto", "ATALAYA"),
        ("recomendaciones", "name", "Nombre de la unidad", "texto", "INEGI"),
        ("recomendaciones", "reco_rank", "Orden de prioridad de la recomendación (1 a 4)", "entero", "ATALAYA Reglas"),
        ("recomendaciones", "reco_id", "Clave de la regla preventiva activada", "clave", "ATALAYA Reglas"),
        ("recomendaciones", "title", "Título ejecutivo de la acción preventiva recomendada", "texto", "ATALAYA Reglas"),
        ("recomendaciones", "rationale", "Justificación técnica contextualizada con datos locales", "texto", "ATALAYA Reglas"),
        ("recomendaciones", "priority", "Nivel de prioridad ('alta', 'media', 'baja')", "categoría", "ATALAYA Reglas"),
        ("recomendaciones", "lever", "Palanca estratégica institucional asociada", "texto", "ATALAYA Reglas"),
        ("recomendaciones", "source", "Origen de la formulación ('rules' o 'llm')", "texto", "ATALAYA Reglas"),

        # metricas_modelo
        ("metricas_modelo", "seccion", "Sección de métricas ('backtest', 'coeficiente_estructural', 'parametro', 'candidato')", "texto", "ATALAYA"),
        ("metricas_modelo", "campo", "Identificador del parámetro o variable", "texto", "ATALAYA"),
        ("metricas_modelo", "valor", "Valor numérico o descripción de la métrica", "texto", "ATALAYA"),
        ("metricas_modelo", "detalle", "Información complementaria y notas metodológicas", "texto", "ATALAYA"),
    ]
    return pd.DataFrame(dic_rows, columns=["hoja", "columna", "descripcion", "unidad", "fuente"])


def export_deliverables(
    build_dir: Path | str | None = None,
    geo_dir: Path | str | None = None,
    out_dir: Path | str | None = None,
    min_profile_rows: int = 50000,
) -> int:
    """Generate all official project deliverables."""
    b_dir = Path(build_dir) if build_dir is not None else config.BUILD_DIR
    g_dir = Path(geo_dir) if geo_dir is not None else config.DATA_DIR.parent / "frontend/public/geo"
    o_dir = Path(out_dir) if out_dir is not None else config.DATA_DIR.parent / "deliverables"

    o_dir.mkdir(parents=True, exist_ok=True)
    csv_dir = o_dir / "csv"
    csv_dir.mkdir(parents=True, exist_ok=True)

    print(f"ATALAYA Export — Generando entregables oficiales en '{o_dir}'...")

    # 1. Load inputs and pre-validations
    part_path = b_dir / "participation.parquet"
    if not part_path.is_file():
        print(f"[-] Error: No se encontró '{part_path}'. Ejecuta el pipeline primero.")
        return 1

    part_df = read_parquet(part_path)
    if "reliable" not in part_df.columns:
        print(
            "[-] Error de validación previa: 'participation.parquet' no contiene la columna obligatoria 'reliable'. "
            "Abortando export para evitar entregables defectuosos (código 2)."
        )
        return 2

    profile_path = b_dir / "ccpc_profile_mun.parquet"
    if not profile_path.is_file():
        profile_path = b_dir / "ccpc_profile.parquet"
    profile_df = read_parquet(profile_path) if profile_path.is_file() else pd.DataFrame()

    if len(profile_df) < min_profile_rows:
        print(
            f"[-] Error de validación previa: '{profile_path.name}' tiene {len(profile_df)} filas "
            f"(mínimo requerido: {min_profile_rows}). Posible archivo incompleto o sobreescrito por tests. "
            f"Abortando export para evitar entregables defectuosos (código 2)."
        )
        return 2

    units_path = b_dir / "units.parquet"
    if not units_path.is_file():
        print(f"[-] Error: No se encontró '{units_path}'. Ejecuta 'python -m atalaya.model.build' primero.")
        return 1

    units_df = read_parquet(units_path)
    drivers_path = b_dir / "drivers.parquet"
    drivers_df = read_parquet(drivers_path) if drivers_path.is_file() else pd.DataFrame()

    metrics_path = b_dir / "metrics.json"
    metrics_data = {}
    if metrics_path.is_file():
        try:
            metrics_data = json.loads(metrics_path.read_text(encoding="utf-8"))
        except Exception:
            metrics_data = {}

    # Read CCPC features for last DIP_FED election metrics per municipality
    ccpc_features_path = b_dir / "ccpc_features.parquet"
    ccpc_metrics_map: dict[str, dict] = {}
    if ccpc_features_path.is_file():
        try:
            df_cf = read_parquet(ccpc_features_path)
            if not df_cf.empty:
                if "level" in df_cf.columns:
                    df_cf = df_cf[df_cf["level"] == "mun"]
                if "election" in df_cf.columns:
                    df_cf = df_cf[df_cf["election"] == "DIP_FED"]
                elif "year" in df_cf.columns:
                    df_cf = df_cf[df_cf["year"] <= 2024]
                if "year" in df_cf.columns and "cvegeo" in df_cf.columns:
                    df_cf = df_cf.sort_values(["cvegeo", "year"]).groupby("cvegeo").last().reset_index()
                    df_cf["id"] = df_cf["cvegeo"].astype(str).str.strip().apply(lambda v: zpad(str(v), 5))
                    ccpc_metrics_map = df_cf.set_index("id").to_dict(orient="index")
        except Exception as e:
            print(f"Aviso leyendo ccpc_features.parquet: {e}")

    # Seed 2027 gubernatorial concurrence
    gov_2027_ents = get_gov_2027_entities()

    # 2. Simulate scenarios
    print("Simulando escenarios base, intervencion y pesimista...")
    mun_base, _ = simulate(units_df, scenario="base", level="mun")
    mun_int, _ = simulate(units_df, scenario="intervencion", level="mun")
    mun_pes, _ = simulate(units_df, scenario="pesimista", level="mun")

    st_base, _ = simulate(units_df, scenario="base", level="state")
    st_int, _ = simulate(units_df, scenario="intervencion", level="state")
    st_pes, _ = simulate(units_df, scenario="pesimista", level="state")

    mb_idx = mun_base.set_index("id")
    mi_idx = mun_int.set_index("id")
    mp_idx = mun_pes.set_index("id")

    sb_idx = st_base.set_index("id")
    si_idx = st_int.set_index("id")
    sp_idx = st_pes.set_index("id")

    # Precompute drivers and recommendations
    reco_ref_mun = build_reference(units_df, level="mun")
    reco_ref_st = build_reference(units_df, level="state")

    top_driver_map: dict[str, str] = {}
    if not drivers_df.empty:
        d_r1 = drivers_df[drivers_df["rank"] == 1]
        for _, r in d_r1.iterrows():
            top_driver_map[str(r["id"])] = str(r["label"])

    top_reco_map: dict[str, str] = {}
    reco_records: list[dict] = []

    # Recommendations for municipalities
    mun_units_df = units_df[units_df["level"] == "mun"].copy()
    for _, r_unit in mun_units_df.iterrows():
        u_id = str(r_unit["id"])
        u_dict = r_unit.to_dict()
        u_drivers = (
            drivers_df[drivers_df["id"] == u_id].to_dict(orient="records")
            if not drivers_df.empty
            else []
        )
        recs = recommend(u_dict, u_drivers, reco_ref_mun)
        if recs:
            top_reco_map[u_id] = recs[0].get("title", "")
        for idx_rc, rc in enumerate(recs[:4], start=1):
            reco_records.append({
                "id": u_id,
                "level": "mun",
                "name": u_dict.get("name", ""),
                "reco_rank": idx_rc,
                "reco_id": rc.get("id", ""),
                "title": rc.get("title", ""),
                "rationale": rc.get("rationale", ""),
                "priority": rc.get("priority", "baja"),
                "lever": rc.get("lever", ""),
                "source": rc.get("source", "rules"),
            })

    # Recommendations for states
    st_units_df = units_df[units_df["level"] == "state"].copy()
    for _, r_unit in st_units_df.iterrows():
        u_id = str(r_unit["id"])
        u_dict = r_unit.to_dict()
        u_drivers = (
            drivers_df[drivers_df["id"] == u_id].to_dict(orient="records")
            if not drivers_df.empty
            else []
        )
        recs = recommend(u_dict, u_drivers, reco_ref_st)
        if recs:
            top_reco_map[u_id] = recs[0].get("title", "")
        for idx_rc, rc in enumerate(recs[:4], start=1):
            reco_records.append({
                "id": u_id,
                "level": "state",
                "name": u_dict.get("name", ""),
                "reco_rank": idx_rc,
                "reco_id": rc.get("id", ""),
                "title": rc.get("title", ""),
                "rationale": rc.get("rationale", ""),
                "priority": rc.get("priority", "baja"),
                "lever": rc.get("lever", ""),
                "source": rc.get("source", "rules"),
            })

    reco_df = pd.DataFrame(reco_records)

    # 3. GeoJSON Export (if geo files exist)
    mun_geo_dir = g_dir / "mun"
    states_geo_file = g_dir / "states.json"
    mun_u_idx = mun_units_df.set_index("id")

    if mun_geo_dir.is_dir() and any(mun_geo_dir.glob("*.json")):
        print("Generando deliverables/mapa_escenarios_municipal.geojson...")
        all_mun_features = []
        for jf in sorted(mun_geo_dir.glob("*.json")):
            try:
                gdata = json.loads(jf.read_text(encoding="utf-8"))
            except Exception:
                continue
            feats_list = gdata.get("features", [])
            for feat in feats_list:
                p = feat.get("properties", {})
                raw_id = str(p.get("id", "")).strip()
                ent = zpad(str(p.get("ent", raw_id[:2])).strip(), 2)
                mun_id = zpad(raw_id, 5)

                b_row = mb_idx.loc[mun_id] if mun_id in mb_idx.index else None
                i_row = mi_idx.loc[mun_id] if mun_id in mi_idx.index else None
                p_row = mp_idx.loc[mun_id] if mun_id in mp_idx.index else None
                u_row = mun_u_idx.loc[mun_id] if mun_id in mun_u_idx.index else None

                name = str(p.get("name", "")).strip()
                if not name and b_row is not None and "name" in b_row:
                    name = str(b_row["name"])

                cf_row = ccpc_metrics_map.get(mun_id, {})
                pct_ln_18_34 = cf_row.get("pct_ln_18_34") if "pct_ln_18_34" in cf_row else (u_row.get("pct_ln_18_34") if u_row is not None else None)
                part_18_34 = cf_row.get("part_18_34") if "part_18_34" in cf_row else (u_row.get("part_18_34_last", u_row.get("part_18_34")) if u_row is not None else None)
                gap_youth_pp = cf_row.get("gap_youth_pp") if "gap_youth_pp" in cf_row else (u_row.get("gap_youth_pp_last", u_row.get("gap_youth_pp")) if u_row is not None else None)
                gap_sexo_pp = cf_row.get("gap_sexo_pp") if "gap_sexo_pp" in cf_row else (u_row.get("gap_sexo_pp_last", u_row.get("gap_sexo_pp")) if u_row is not None else None)
                pct_ln_rural = cf_row.get("pct_ln_rural") if "pct_ln_rural" in cf_row else (u_row.get("pct_ln_rural_last", u_row.get("pct_ln_rural")) if u_row is not None else None)

                feat["properties"] = {
                    "id": mun_id,
                    "ent": ent,
                    "name": name,
                    "lista_nominal": round_val(b_row["lista_nominal"], 0) if b_row is not None else None,
                    "last_year": round_val(b_row["last_year"], 0) if b_row is not None else None,
                    "last_reliable_year": round_val(u_row.get("last_reliable_year"), 0) if u_row is not None else None,
                    "last_participation": round_val(b_row["last_participation"], 4) if b_row is not None else None,
                    "pred_dev_pp": round_val(u_row.get("pred_dev_pp"), 4) if u_row is not None else None,
                    "fallback_model": str(u_row.get("fallback_model")) if u_row is not None and pd.notna(u_row.get("fallback_model")) and u_row.get("fallback_model") else None,
                    "gov_2027": 1 if ent in gov_2027_ents else 0,
                    "pred_abstention_base": round_val(b_row["pred_abstention"], 4) if b_row is not None else None,
                    "category_base": str(b_row["category"]) if b_row is not None and pd.notna(b_row["category"]) else "sin_dato",
                    "pred_abstention_intervencion": round_val(i_row["pred_abstention"], 4) if i_row is not None else None,
                    "category_intervencion": str(i_row["category"]) if i_row is not None and pd.notna(i_row["category"]) else "sin_dato",
                    "delta_pp_intervencion": round_val(i_row["delta_vs_base_pp"], 4) if i_row is not None else None,
                    "pred_abstention_pesimista": round_val(p_row["pred_abstention"], 4) if p_row is not None else None,
                    "category_pesimista": str(p_row["category"]) if p_row is not None and pd.notna(p_row["category"]) else "sin_dato",
                    "risk_score_base": round_val(b_row["risk_score"], 2) if b_row is not None else None,
                    "trend_pp": round_val(b_row["trend_pp"], 4) if b_row is not None else None,
                    "top_driver": top_driver_map.get(mun_id, ""),
                    "top_recommendation": top_reco_map.get(mun_id, ""),
                    "imputed_census": bool(u_row.get("imputed_census", False)) if u_row is not None else False,
                    "part_pj_2025": round_val(u_row.get("part_pj_2025"), 4) if u_row is not None else None,
                    "pct_ln_18_34": round_val(pct_ln_18_34, 4),
                    "part_18_34": round_val(part_18_34, 4),
                    "gap_youth_pp": round_val(gap_youth_pp, 2),
                    "gap_sexo_pp": round_val(gap_sexo_pp, 2),
                    "pct_ln_rural": round_val(pct_ln_rural, 4),
                }
                all_mun_features.append(feat)

        mun_fc = {"type": "FeatureCollection", "features": all_mun_features}
        mun_geojson_path = o_dir / "mapa_escenarios_municipal.geojson"
        mun_geojson_path.write_text(json.dumps(mun_fc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    else:
        print(f"Aviso: No se encontraron GeoJSON en '{mun_geo_dir}'. Omitiendo mapa_escenarios_municipal.geojson.")

    if states_geo_file.is_file():
        print("Generando deliverables/mapa_escenarios_estatal.geojson...")
        try:
            st_gdata = json.loads(states_geo_file.read_text(encoding="utf-8"))
            st_features = st_gdata.get("features", [])
            for feat in st_features:
                p = feat.get("properties", {})
                st_id = zpad(str(p.get("id", "")).strip(), 2)
                name = str(p.get("name", "")).strip()

                b_row = sb_idx.loc[st_id] if st_id in sb_idx.index else None
                i_row = si_idx.loc[st_id] if st_id in si_idx.index else None
                p_row = sp_idx.loc[st_id] if st_id in sp_idx.index else None

                if not name and b_row is not None and "name" in b_row:
                    name = str(b_row["name"])

                feat["properties"] = {
                    "id": st_id,
                    "name": name,
                    "lista_nominal": round_val(b_row["lista_nominal"], 0) if b_row is not None else None,
                    "last_participation": round_val(b_row["last_participation"], 4) if b_row is not None else None,
                    "pred_abstention_base": round_val(b_row["pred_abstention"], 4) if b_row is not None else None,
                    "category_base": str(b_row["category"]) if b_row is not None and pd.notna(b_row["category"]) else "sin_dato",
                    "pred_abstention_intervencion": round_val(i_row["pred_abstention"], 4) if i_row is not None else None,
                    "category_intervencion": str(i_row["category"]) if i_row is not None and pd.notna(i_row["category"]) else "sin_dato",
                    "delta_pp_intervencion": round_val(i_row["delta_vs_base_pp"], 4) if i_row is not None else None,
                    "pred_abstention_pesimista": round_val(p_row["pred_abstention"], 4) if p_row is not None else None,
                    "category_pesimista": str(p_row["category"]) if p_row is not None and pd.notna(p_row["category"]) else "sin_dato",
                    "risk_score_base": round_val(b_row["risk_score"], 2) if b_row is not None else None,
                    "trend_pp": round_val(b_row["trend_pp"], 4) if b_row is not None else None,
                    "top_driver": top_driver_map.get(st_id, ""),
                    "top_recommendation": top_reco_map.get(st_id, ""),
                }
            st_fc = {"type": "FeatureCollection", "features": st_features}
            st_geojson_path = o_dir / "mapa_escenarios_estatal.geojson"
            st_geojson_path.write_text(json.dumps(st_fc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"Aviso: Error procesando states.json ({e}).")
    else:
        print(f"Aviso: No se encontró '{states_geo_file}'. Omitiendo mapa_escenarios_estatal.geojson.")

    # 4. Construct DataFrames for Excel and CSVs
    print("Construyendo tablas de datos para Excel y CSV...")

    # A. Municipios
    mun_table_rows = []
    for _, u in mun_units_df.iterrows():
        mid = str(u["id"])
        ent = zpad(str(u.get("cve_ent", mid[:2])), 2)
        b_r = mb_idx.loc[mid] if mid in mb_idx.index else None
        i_r = mi_idx.loc[mid] if mid in mi_idx.index else None
        p_r = mp_idx.loc[mid] if mid in mp_idx.index else None

        cf_row = ccpc_metrics_map.get(mid, {})
        pct_ln_18_34 = cf_row.get("pct_ln_18_34") if "pct_ln_18_34" in cf_row else u.get("pct_ln_18_34")
        part_18_34 = cf_row.get("part_18_34") if "part_18_34" in cf_row else u.get("part_18_34_last", u.get("part_18_34"))
        gap_youth_pp = cf_row.get("gap_youth_pp") if "gap_youth_pp" in cf_row else u.get("gap_youth_pp_last", u.get("gap_youth_pp"))
        gap_sexo_pp = cf_row.get("gap_sexo_pp") if "gap_sexo_pp" in cf_row else u.get("gap_sexo_pp_last", u.get("gap_sexo_pp"))
        pct_ln_rural = cf_row.get("pct_ln_rural") if "pct_ln_rural" in cf_row else u.get("pct_ln_rural_last", u.get("pct_ln_rural"))

        gov_2027 = 1 if ent in gov_2027_ents else 0

        row = {
            "id": mid,
            "cve_ent": ent,
            "name": u.get("name", ""),
            "lista_nominal": round_val(b_r["lista_nominal"], 0) if b_r is not None else None,
            "last_year": round_val(b_r["last_year"], 0) if b_r is not None else None,
            "last_reliable_year": round_val(u.get("last_reliable_year"), 0),
            "last_participation": round_val(b_r["last_participation"], 4) if b_r is not None else None,
            "pred_participation_base": round_val(b_r["pred_participation"], 4) if b_r is not None else None,
            "pred_abstention_base": round_val(b_r["pred_abstention"], 4) if b_r is not None else None,
            "pred_dev_pp": round_val(u.get("pred_dev_pp"), 4),
            "fallback_model": str(u.get("fallback_model")) if pd.notna(u.get("fallback_model")) and u.get("fallback_model") else None,
            "gov_2027": gov_2027,
            "pred_low_base": round_val(b_r["pred_low"], 4) if b_r is not None else None,
            "pred_high_base": round_val(b_r["pred_high"], 4) if b_r is not None else None,
            "trend_pp": round_val(b_r["trend_pp"], 4) if b_r is not None else None,
            "volatility_pp": round_val(u.get("volatility_pp"), 4),
            "risk_score_base": round_val(b_r["risk_score"], 2) if b_r is not None else None,
            "category_base": str(b_r["category"]) if b_r is not None and pd.notna(b_r["category"]) else "sin_dato",
            "pred_abstention_intervencion": round_val(i_r["pred_abstention"], 4) if i_r is not None else None,
            "category_intervencion": str(i_r["category"]) if i_r is not None and pd.notna(i_r["category"]) else "sin_dato",
            "delta_pp_intervencion": round_val(i_r["delta_vs_base_pp"], 4) if i_r is not None else None,
            "pred_abstention_pesimista": round_val(p_r["pred_abstention"], 4) if p_r is not None else None,
            "category_pesimista": str(p_r["category"]) if p_r is not None and pd.notna(p_r["category"]) else "sin_dato",
            "delta_pp_pesimista": round_val(p_r["delta_vs_base_pp"], 4) if p_r is not None else None,
            "top_driver": top_driver_map.get(mid, ""),
            "top_recommendation": top_reco_map.get(mid, ""),
            "coverage_ln": round_val(u.get("coverage_ln"), 4),
            "pob_tot": round_val(u.get("pob_tot"), 0),
            "pob_18ymas": round_val(u.get("pob_18ymas"), 0),
            "pct_18_24": round_val(u.get("pct_18_24"), 4),
            "pct_65ymas": round_val(u.get("pct_65ymas"), 4),
            "graproes": round_val(u.get("graproes"), 2),
            "pct_hli": round_val(u.get("pct_hli"), 4),
            "pct_sin_servsalud": round_val(u.get("pct_sin_servsalud"), 4),
            "pct_internet": round_val(u.get("pct_internet"), 4),
            "pct_rural": round_val(u.get("pct_rural"), 4),
            "pct_analfabeta": round_val(u.get("pct_analfabeta"), 4),
            "pct_po2sm": round_val(u.get("pct_po2sm"), 4),
            "im_2020": round_val(u.get("im_2020"), 4),
            "gm_2020": str(u.get("gm_2020")) if pd.notna(u.get("gm_2020")) else "",
            "part_pj_2025": round_val(u.get("part_pj_2025"), 4),
            "pct_ln_18_34": round_val(pct_ln_18_34, 4),
            "part_18_34": round_val(part_18_34, 4),
            "gap_youth_pp": round_val(gap_youth_pp, 2),
            "gap_sexo_pp": round_val(gap_sexo_pp, 2),
            "pct_ln_rural": round_val(pct_ln_rural, 4),
            "part_18_34_last": round_val(part_18_34, 4),
            "gap_youth_pp_last": round_val(gap_youth_pp, 2),
            "gap_sexo_pp_last": round_val(gap_sexo_pp, 2),
            "pct_ln_rural_last": round_val(pct_ln_rural, 4),
            "imputed_census": bool(u.get("imputed_census", False)),
        }
        mun_table_rows.append(row)

    df_municipios = pd.DataFrame(mun_table_rows)

    # B. Estados
    st_table_rows = []
    for _, u in st_units_df.iterrows():
        sid = str(u["id"])
        b_r = sb_idx.loc[sid] if sid in sb_idx.index else None
        i_r = si_idx.loc[sid] if sid in si_idx.index else None
        p_r = sp_idx.loc[sid] if sid in sp_idx.index else None

        row = {
            "id": sid,
            "name": u.get("name", ""),
            "lista_nominal": round_val(b_r["lista_nominal"], 0) if b_r is not None else None,
            "last_year": round_val(b_r["last_year"], 0) if b_r is not None else None,
            "last_participation": round_val(b_r["last_participation"], 4) if b_r is not None else None,
            "pred_participation_base": round_val(b_r["pred_participation"], 4) if b_r is not None else None,
            "pred_abstention_base": round_val(b_r["pred_abstention"], 4) if b_r is not None else None,
            "pred_low_base": round_val(b_r["pred_low"], 4) if b_r is not None else None,
            "pred_high_base": round_val(b_r["pred_high"], 4) if b_r is not None else None,
            "trend_pp": round_val(b_r["trend_pp"], 4) if b_r is not None else None,
            "volatility_pp": round_val(u.get("volatility_pp"), 4),
            "risk_score_base": round_val(b_r["risk_score"], 2) if b_r is not None else None,
            "category_base": str(b_r["category"]) if b_r is not None and pd.notna(b_r["category"]) else "sin_dato",
            "pred_abstention_intervencion": round_val(i_r["pred_abstention"], 4) if i_r is not None else None,
            "category_intervencion": str(i_r["category"]) if i_r is not None and pd.notna(i_r["category"]) else "sin_dato",
            "delta_pp_intervencion": round_val(i_r["delta_vs_base_pp"], 4) if i_r is not None else None,
            "pred_abstention_pesimista": round_val(p_r["pred_abstention"], 4) if p_r is not None else None,
            "category_pesimista": str(p_r["category"]) if p_r is not None and pd.notna(p_r["category"]) else "sin_dato",
            "delta_pp_pesimista": round_val(p_r["delta_vs_base_pp"], 4) if p_r is not None else None,
            "top_driver": top_driver_map.get(sid, ""),
            "top_recommendation": top_reco_map.get(sid, ""),
            "coverage_ln": round_val(u.get("coverage_ln"), 4),
            "pob_tot": round_val(u.get("pob_tot"), 0),
            "pob_18ymas": round_val(u.get("pob_18ymas"), 0),
            "pct_18_24": round_val(u.get("pct_18_24"), 4),
            "pct_65ymas": round_val(u.get("pct_65ymas"), 4),
            "graproes": round_val(u.get("graproes"), 2),
            "pct_hli": round_val(u.get("pct_hli"), 4),
            "pct_sin_servsalud": round_val(u.get("pct_sin_servsalud"), 4),
            "pct_internet": round_val(u.get("pct_internet"), 4),
            "pct_rural": round_val(u.get("pct_rural"), 4),
            "pct_analfabeta": round_val(u.get("pct_analfabeta"), 4),
            "pct_po2sm": round_val(u.get("pct_po2sm"), 4),
            "part_pj_2025": round_val(u.get("part_pj_2025"), 4),
            "part_18_34_last": round_val(u.get("part_18_34_last"), 4),
            "gap_youth_pp_last": round_val(u.get("gap_youth_pp_last"), 2),
            "gap_sexo_pp_last": round_val(u.get("gap_sexo_pp_last"), 2),
            "pct_ln_rural_last": round_val(u.get("pct_ln_rural_last"), 4),
        }
        st_table_rows.append(row)

    df_estados = pd.DataFrame(st_table_rows)

    # C. Participacion historica
    if not part_df.empty:
        df_part_hist = part_df.copy()
        if "cvegeo" in df_part_hist.columns and "id" not in df_part_hist.columns:
            df_part_hist["id"] = df_part_hist["cvegeo"].astype(str).str.strip().apply(lambda v: zpad(str(v), 5))
        if "level" not in df_part_hist.columns:
            df_part_hist["level"] = "mun"

        name_map = (
            mun_units_df.set_index("id")["name"].to_dict()
            if not mun_units_df.empty and "id" in mun_units_df.columns and "name" in mun_units_df.columns
            else {}
        )
        if "name" not in df_part_hist.columns and "id" in df_part_hist.columns:
            df_part_hist["name"] = df_part_hist["id"].map(name_map).fillna("")

        for col_n in ["lista_nominal", "votos_totales", "nv", "ns"]:
            if col_n in df_part_hist.columns:
                df_part_hist[col_n] = pd.to_numeric(df_part_hist[col_n], errors="coerce").fillna(0).astype(int)

        if "ns_rate" in df_part_hist.columns:
            df_part_hist["ns_rate"] = df_part_hist["ns_rate"].apply(lambda v: round_val(v, 4))
        if "reliable" in df_part_hist.columns:
            df_part_hist["reliable"] = df_part_hist["reliable"].astype(bool)
        if "low_confidence" in df_part_hist.columns:
            df_part_hist["low_confidence"] = df_part_hist["low_confidence"].astype(bool)

        if "participacion" in df_part_hist.columns:
            df_part_hist["participacion"] = df_part_hist["participacion"].apply(lambda v: round_val(v, 4))
            # Participación no confiable se exporta vacía, nunca 0
            if "reliable" in df_part_hist.columns:
                unrel_mask = ~df_part_hist["reliable"].fillna(False).astype(bool)
                df_part_hist.loc[unrel_mask, "participacion"] = None

        desired_order = [
            "id", "level", "cve_ent", "name", "year", "election",
            "lista_nominal", "votos_totales", "nv", "ns",
            "ns_rate", "reliable", "low_confidence", "participacion",
        ]
        present_cols = [c for c in desired_order if c in df_part_hist.columns]
        extra_cols = [c for c in df_part_hist.columns if c not in desired_order]
        df_part_hist = df_part_hist[present_cols + extra_cols]
    else:
        df_part_hist = pd.DataFrame(columns=[
            "id", "level", "cve_ent", "name", "year", "election",
            "lista_nominal", "votos_totales", "nv", "ns",
            "ns_rate", "reliable", "low_confidence", "participacion",
        ])

    # D. Perfil edad sexo
    if not profile_df.empty:
        df_perfil = profile_df.copy()
        if "cvegeo" in df_perfil.columns:
            df_perfil["cvegeo"] = df_perfil["cvegeo"].astype(str).str.strip().apply(lambda v: zpad(str(v), 5))

        group_cols = [c for c in ["cvegeo", "cve_ent", "year", "election", "age_group", "sexo"] if c in df_perfil.columns]
        sum_cols = [c for c in ["ln", "sv", "nv", "ns"] if c in df_perfil.columns]
        if group_cols and sum_cols:
            df_perfil = df_perfil.groupby(group_cols, as_index=False)[sum_cols].sum()

        for col_n in ["ln", "sv", "nv", "ns"]:
            if col_n in df_perfil.columns:
                df_perfil[col_n] = pd.to_numeric(df_perfil[col_n], errors="coerce").fillna(0).astype(int)

        if "sv" in df_perfil.columns and "nv" in df_perfil.columns:
            denom = df_perfil["sv"] + df_perfil["nv"]
            df_perfil["participacion"] = np.where(denom > 0, df_perfil["sv"] / denom, np.nan)
            df_perfil["participacion"] = df_perfil["participacion"].apply(lambda v: round_val(v, 4))
        elif "participacion" in df_perfil.columns:
            df_perfil["participacion"] = df_perfil["participacion"].apply(lambda v: round_val(v, 4))
    else:
        df_perfil = pd.DataFrame(columns=[
            "cvegeo", "cve_ent", "year", "election", "age_group", "sexo",
            "ln", "sv", "nv", "ns", "participacion",
        ])

    # E. Drivers
    df_drivers = drivers_df.copy() if not drivers_df.empty else pd.DataFrame(columns=[
        "id", "level", "rank", "key", "label", "contribution_pp", "direction"
    ])

    # F. Metricas modelo
    metrics_records = []
    if metrics_data:
        # General parameters
        metrics_records.append({"seccion": "parametro", "campo": "target_year", "valor": metrics_data.get("target_year"), "detalle": "Año federal objetivo"})
        if "selected_model" in metrics_data:
            metrics_records.append({"seccion": "modelo_seleccionado", "campo": "selected_model", "valor": metrics_data.get("selected_model"), "detalle": "Modelo ganador del torneo de candidatos"})
        if "national_level_assumption" in metrics_data:
            metrics_records.append({"seccion": "parametro", "campo": "national_level_assumption", "valor": metrics_data.get("national_level_assumption"), "detalle": "Nivel nacional supuesto para intermedia 2027 (%)"})
        if "offset_pp" in metrics_data:
            metrics_records.append({"seccion": "parametro", "campo": "offset_pp", "valor": metrics_data.get("offset_pp"), "detalle": "Offset histórico de intermedias respecto a la media nacional (pp)"})
        metrics_records.append({"seccion": "parametro", "campo": "lambda", "valor": metrics_data.get("lambda"), "detalle": "Penalización ridge seleccionada"})
        metrics_records.append({"seccion": "parametro", "campo": "sigma_pp", "valor": metrics_data.get("sigma_pp"), "detalle": "Desviación estándar de residuales (pp)"})
        metrics_records.append({"seccion": "parametro", "campo": "structural_r2", "valor": metrics_data.get("structural_r2"), "detalle": "R² en validación cruzada 5-fold"})
        metrics_records.append({"seccion": "parametro", "campo": "generated_at", "valor": metrics_data.get("generated_at"), "detalle": "Fecha de calibración"})

        # Candidates tournament
        for c in metrics_data.get("candidates", []):
            c_name = c.get("name")
            mae_avg = c.get("mean_mae_pp", c.get("mae_avg", c.get("mae_pp")))
            metrics_records.append({
                "seccion": "candidato",
                "campo": c_name,
                "valor": mae_avg,
                "detalle": f"MAE promedio={mae_avg} pp | Spearman={c.get('spearman_avg', c.get('spearman'))} | top20_hit={c.get('top20_hit_avg', c.get('top20_hit'))}",
            })

        # Backtests
        for b in metrics_data.get("backtests", []):
            ty = b.get("test_year")
            mae = b.get("mae_pp")
            rmse = b.get("rmse_pp")
            sp = b.get("spearman")
            b_mae = b.get("baseline_mae_pp")
            n_un = b.get("n")
            detail = f"MAE={mae} pp vs naive={b_mae} pp | RMSE={rmse} pp | Spearman={sp} | n={n_un}"
            metrics_records.append({"seccion": "backtest", "campo": f"fold_{ty}", "valor": mae, "detalle": detail})

        # Coefficients
        for c in metrics_data.get("coefficients", []):
            k = c.get("key")
            lbl = c.get("label", k)
            coef = c.get("coef_pp_per_sd")
            metrics_records.append({
                "seccion": "coeficiente_estructural",
                "campo": k,
                "valor": coef,
                "detalle": f"{lbl} (pp de participación por 1 desviación estándar)",
            })

    df_metricas = pd.DataFrame(metrics_records) if metrics_records else pd.DataFrame(columns=["seccion", "campo", "valor", "detalle"])

    # G. Semaforo ponderado
    print("Calculando resumen ponderado de semáforo...")
    summary_rows = []
    scenarios_list = [
        ("base", df_municipios["category_base"] if "category_base" in df_municipios.columns else pd.Series()),
        ("intervencion", df_municipios["category_intervencion"] if "category_intervencion" in df_municipios.columns else pd.Series()),
        ("pesimista", df_municipios["category_pesimista"] if "category_pesimista" in df_municipios.columns else pd.Series()),
    ]
    tot_muns = len(df_municipios)
    tot_ln = to_num(df_municipios["lista_nominal"]).sum() if "lista_nominal" in df_municipios.columns else 0

    for sc_id, cat_series in scenarios_list:
        for cat in CATEGORIES:
            m_mask = cat_series == cat
            n_m = int(m_mask.sum())
            pct_m = round(float(n_m / tot_muns * 100.0), 2) if tot_muns > 0 else 0.0
            ln_sum = to_num(df_municipios.loc[m_mask, "lista_nominal"]).sum() if "lista_nominal" in df_municipios.columns else 0
            pct_ln = round(float(ln_sum / tot_ln * 100.0), 2) if tot_ln > 0 else 0.0
            summary_rows.append({
                "scenario": sc_id,
                "category": cat,
                "n_municipios": n_m,
                "pct_municipios": pct_m,
                "lista_nominal": int(round(ln_sum)),
                "pct_lista_nominal": pct_ln,
            })

    df_semaforo_ponderado = pd.DataFrame(summary_rows)

    # H. LEEME & Diccionario
    df_leeme = create_leeme_dataframe(metrics_data)
    df_diccionario = create_dictionary_dataframe()

    # 5. Write Excel Workbook (openpyxl)
    xlsx_path = o_dir / "base_datos_atalaya.xlsx"
    print(f"Escribiendo '{xlsx_path}'...")
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    sheets_to_write = [
        ("LEEME", df_leeme),
        ("diccionario", df_diccionario),
        ("semaforo_ponderado", df_semaforo_ponderado),
        ("municipios", df_municipios),
        ("estados", df_estados),
        ("participacion_historica", df_part_hist),
        ("perfil_edad_sexo", df_perfil),
        ("drivers", df_drivers),
        ("recomendaciones", reco_df),
        ("metricas_modelo", df_metricas),
    ]

    for sheet_name, df_content in sheets_to_write:
        ws = wb.create_sheet(title=sheet_name)
        headers = list(df_content.columns)
        ws.append(headers)
        for r in df_content.itertuples(index=False, name=None):
            ws.append(list(r))
        format_excel_sheet(ws, df_content)

    wb.save(xlsx_path)

    # 6. Write CSV files in deliverables/csv/ (UTF-8 with BOM)
    print(f"Exportando CSVs con BOM en '{csv_dir}'...")
    for sheet_name, df_content in sheets_to_write:
        csv_file = csv_dir / f"{sheet_name}.csv"
        df_content.to_csv(csv_file, index=False, encoding="utf-8-sig")

    # 7. Write semaforo_resumen.csv (backward compatibility)
    df_semaforo_ponderado.to_csv(o_dir / "semaforo_resumen.csv", index=False, encoding="utf-8-sig")

    # 8. Print file sizes summary
    print("\n" + "=" * 60)
    print("ATALAYA — Resumen de archivos entregables generados:")
    print("=" * 60)
    for p in sorted(o_dir.rglob("*")):
        if p.is_file():
            size_kb = p.stat().st_size / 1024.0
            if size_kb >= 1024:
                size_str = f"{size_kb / 1024.0:8.2f} MB"
            else:
                size_str = f"{size_kb:8.1f} KB"
            rel_p = p.relative_to(o_dir.parent)
            print(f"  {size_str}  {rel_p}")
    print("=" * 60)

    # Check GeoJSON size limit
    mun_geo_out = o_dir / "mapa_escenarios_municipal.geojson"
    if mun_geo_out.is_file():
        m_bytes = mun_geo_out.stat().st_size
        print(f"Tamaño GeoJSON municipal: {m_bytes / (1024 * 1024):.2f} MB (Meta: < 25 MB)")
        if m_bytes > 25 * 1024 * 1024:
            print("Aviso: El GeoJSON municipal supera 25 MB.")

    return 0


def main() -> None:
    """CLI entrypoint for atalaya.export."""
    parser = argparse.ArgumentParser(description="Export ATALAYA deliverables and scenario maps")
    parser.add_argument("--build-dir", type=Path, default=config.BUILD_DIR, help="Path to build dir")
    parser.add_argument(
        "--geo-dir",
        type=Path,
        default=config.DATA_DIR.parent / "frontend/public/geo",
        help="Path to frontend public geo dir",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=config.DATA_DIR.parent / "deliverables",
        help="Path to output deliverables directory",
    )
    parser.add_argument(
        "--min-profile-rows",
        type=int,
        default=50000,
        help="Minimum required rows in ccpc_profile_mun to avoid exporting defective datasets",
    )
    args = parser.parse_args()

    sys.exit(
        export_deliverables(
            build_dir=args.build_dir,
            geo_dir=args.geo_dir,
            out_dir=args.out,
            min_profile_rows=args.min_profile_rows,
        )
    )


if __name__ == "__main__":
    main()
