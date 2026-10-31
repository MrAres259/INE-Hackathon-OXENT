"""Plain-language templates and formatting utilities for zone explanations.

All user-visible text is written in Mexican Spanish, free of statistical jargon
(no 'pp', 'rho', 'Spearman', 'ridge', 'percentil', 'desviación', 'r_abs', 'vulnerabilidad estructural').
"""
from __future__ import annotations

import re
from typing import Any, Callable

import pandas as pd


FORBIDDEN_WORDS_PATTERN = re.compile(
    r"\b(pp|rho|spearman|ridge|percentil(?:es)?|desviaci[oó]n(?:es)?|r_abs|vulnerabilidad\s+estructural)\b",
    re.IGNORECASE,
)


def fmt_pct(val: float | None, is_ratio: bool = True, decimals: int = 1) -> str:
    """Format percentage in es-MX format with space before %: '52.1 %'."""
    if val is None or pd.isna(val):
        return "N/D"
    num = float(val) * 100.0 if is_ratio else float(val)
    return f"{num:.{decimals}f} %"


def fmt_pts(val: float | None, decimals: int = 1, signed: bool = False) -> str:
    """Format points without 'pp': '3.2 puntos' or '-3.2 puntos'."""
    if val is None or pd.isna(val):
        return "N/D"
    num = float(val)
    if signed and num > 0:
        return f"+{num:.{decimals}f} puntos"
    if num < 0:
        return f"-{abs(num):.{decimals}f} puntos"
    return f"{num:.{decimals}f} puntos"


def fmt_int(val: int | float | None) -> str:
    """Format integer with thousands separator: '1,744,296'."""
    if val is None or pd.isna(val):
        return "N/D"
    return f"{int(round(float(val))):,}"


def fmt_fraction(k: int, n: int) -> str:
    """Format fraction: '5 de 6'."""
    return f"{k} de {n}"


def age_label(ag: str) -> str:
    """Convert age code into plain Spanish label: '18 a 24 años', '65 años o más'."""
    s = str(ag).strip()
    mapping = {
        "18-24": "18 a 24 años",
        "18_24": "18 a 24 años",
        "25-29": "25 a 29 años",
        "25_29": "25 a 29 años",
        "30-34": "30 a 34 años",
        "30_34": "30 a 34 años",
        "35-39": "35 a 39 años",
        "35_39": "35 a 39 años",
        "40-44": "40 a 44 años",
        "40_44": "40 a 44 años",
        "45-49": "45 a 49 años",
        "45_49": "45 a 49 años",
        "50-54": "50 a 54 años",
        "50_54": "50 a 54 años",
        "55-59": "55 a 59 años",
        "55_59": "55 a 59 años",
        "60-64": "60 a 64 años",
        "60_64": "60 a 64 años",
        "65+": "65 años o más",
        "65-mas": "65 años o más",
        "65_mas": "65 años o más",
        "65ymas": "65 años o más",
        "65 y más": "65 años o más",
        "65 y mas": "65 años o más",
    }
    if s in mapping:
        return mapping[s]
    parts = re.split(r"[-_]", s)
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
        return f"{parts[0]} a {parts[1]} años"
    if not s.endswith("años") and not s.endswith("más"):
        return f"{s} años"
    return s


def color_words(cat: str | None) -> str:
    """Return descriptive color label: 'naranja (riesgo alto)'."""
    c = str(cat).lower() if cat else ""
    if "rojo" in c:
        return "rojo (riesgo muy alto)"
    if "naranja" in c:
        return "naranja (riesgo alto)"
    if "amarillo" in c:
        return "amarillo (riesgo medio)"
    if "verde" in c:
        return "verde (riesgo bajo)"
    return "sin dato"


def color_and_risk(cat: str | None) -> tuple[str, str]:
    """Return tuple of (color_name, risk_label): e.g. ('naranja', 'riesgo alto')."""
    c = str(cat).lower() if cat else ""
    if "rojo" in c:
        return ("rojo", "riesgo muy alto")
    if "naranja" in c:
        return ("naranja", "riesgo alto")
    if "amarillo" in c:
        return ("amarillo", "riesgo medio")
    if "verde" in c:
        return ("verde", "riesgo bajo")
    return ("sin dato", "sin clasificar")


def semaforo_title(cat: str | None, risk_score: float, comp_word: str) -> str:
    """Format semaforo reason title without double parentheses."""
    col, rsg = color_and_risk(cat)
    return f"Está en {col} ({rsg}, {risk_score:.1f} de 100) sobre todo por {comp_word}"


def plain_abstention(pts: float, score: float, pred_disp: str, rank_pct: float, zonas: str) -> str:
    """Format plain text for expected abstention component."""
    r = round(rank_pct)
    if rank_pct >= 50.0:
        return (
            f"Pesa {pts:.1f} de {score:.1f} puntos: se espera que aquí no vote "
            f"el {pred_disp}, más que en el {r} % de los {zonas}."
        )
    comp_rank = 100 - r
    return (
        f"Pesa {pts:.1f} de {score:.1f} puntos: se espera que aquí no vote "
        f"el {pred_disp}, menos que en el {comp_rank} % de los {zonas}."
    )


def plain_vulnerability(pts: float, rank_pct: float, zonas: str) -> str:
    """Format plain text for vulnerability / profile component."""
    r = round(rank_pct)
    if rank_pct >= 50.0:
        return (
            f"Pesa {pts:.1f}: su perfil (escolaridad, edad, servicios, internet, ruralidad) "
            f"se parece al de las zonas que votan menos; está más expuesta que el {r} % de los {zonas}."
        )
    comp_rank = 100 - r
    return (
        f"Pesa {pts:.1f}: su perfil se parece al de las zonas que votan más; "
        f"está menos expuesta que el {comp_rank} % de los {zonas}."
    )


def plain_trend(pts: float, trend_pp: float) -> str:
    """Format plain text for trend component."""
    if abs(trend_pp) < 0.5:
        return f"Pesa {pts:.1f}: su participación se ha mantenido estable."
    if trend_pp < 0:
        return f"Pesa {pts:.1f}: su participación ha venido bajando {abs(trend_pp):.1f} puntos por elección."
    return f"Pesa {pts:.1f}: su participación ha venido subiendo ({trend_pp:.1f} puntos por elección)."


def plain_volatility(pts: float, vol_pp: float, rank_pct: float, zonas: str) -> str:
    """Format plain text for volatility component."""
    r = round(rank_pct)
    if rank_pct >= 50.0:
        return (
            f"Pesa {pts:.1f}: su participación cambia de una elección a otra (±{vol_pp:.1f} puntos), "
            f"más que en el {r} % de los {zonas}."
        )
    comp_rank = 100 - r
    return (
        f"Pesa {pts:.1f}: su participación es de las más estables (±{vol_pp:.1f} puntos): "
        f"cambia menos que en el {comp_rank} % de los {zonas}."
    )


EVIDENCE_TYPE_WORDS: dict[str, str] = {
    "dato_medido": "Dato medido",
    "calculo_del_modelo": "Cálculo del modelo",
    "asociacion": "Relación, no prueba causa",
    "contexto_descriptivo": "Dato de contexto",
}

STRENGTH_WORDS: dict[str, str] = {
    "fuerte": "Fuerte",
    "moderada": "Moderada",
    "debil": "Débil",
}


def zone_noun(level: str, plural: bool = True) -> str:
    """Return plain Spanish noun for geographic units: 'municipios', 'estados'."""
    lvl = str(level).lower()
    if lvl == "mun":
        return "municipios" if plural else "municipio"
    if lvl == "state":
        return "estados" if plural else "estado"
    return "zonas" if plural else "zona"


def component_title_word(comp_key: str) -> str:
    """Return friendly name for risk components."""
    mapping = {
        "abs": "la abstención esperada",
        "vuln": "las características de la zona",
        "trend": "la tendencia de participación",
        "vol": "los cambios de una elección a otra",
    }
    return mapping.get(comp_key, "las condiciones observadas")


ASSOC_META: dict[str, dict[str, Any]] = {
    "pct_sin_servsalud": {
        "condition_high": "más población sin afiliación a servicios de salud",
        "condition_low": "menos población sin afiliación a servicios de salud",
        "value_label": "de su población no cuenta con afiliación a servicios de salud",
    },
    "graproes": {
        "condition_high": "mayor escolaridad promedio",
        "condition_low": "menor escolaridad promedio",
        "value_label": "años de escolaridad promedio",
    },
    "pct_internet": {
        "condition_high": "más viviendas con internet",
        "condition_low": "menos viviendas con internet",
        "value_label": "de las viviendas disponen de internet",
    },
    "pct_rural": {
        "condition_high": "mayor proporción de población rural",
        "condition_low": "menor proporción de población rural",
        "value_label": "de sus habitantes vive en localidades rurales",
    },
    "pct_hli": {
        "condition_high": "mayor población hablante de lengua indígena",
        "condition_low": "menor población hablante de lengua indígena",
        "value_label": "de la población habla una lengua indígena",
    },
    "pct_analfabeta": {
        "condition_high": "mayor tasa de analfabetismo",
        "condition_low": "menor tasa de analfabetismo",
        "value_label": "de analfabetismo en población adulta",
    },
    "pct_po2sm": {
        "condition_high": "más población con ingresos de hasta dos salarios mínimos",
        "condition_low": "menos población con ingresos de hasta dos salarios mínimos",
        "value_label": "de la población ocupada percibe hasta dos salarios mínimos",
    },
    "pct_18_24": {
        "condition_high": "mayor concentración de jóvenes de 18 a 24 años",
        "condition_low": "menor concentración de jóvenes de 18 a 24 años",
        "value_label": "de su población adulta tiene entre 18 y 24 años",
    },
    "pct_65ymas": {
        "condition_high": "mayor proporción de personas mayores de 65 años",
        "condition_low": "menor proporción de personas mayores de 65 años",
        "value_label": "de su población adulta tiene 65 años o más",
    },
    "im_2020": {
        "condition_high": "mayor grado de marginación",
        "condition_low": "menor grado de marginación",
        "value_label": "en el índice de marginación",
    },
}


def clean_recommendation_rationale(rationale: str) -> str:
    """Sanitize recommendation rationale to remove jargon and extract actionable advice."""
    text = str(rationale).strip()
    text = re.sub(r"\bpp\b", "puntos", text)
    text = re.sub(r"\bpercentil\s+\d+\s+nacional\b", "nivel nacional prioritario", text, flags=re.IGNORECASE)
    text = re.sub(r"\bpercentil\b", "nivel", text, flags=re.IGNORECASE)

    # Extract actionable advice (sentence after the colon/period if it starts with unit name)
    if ":" in text:
        after_colon = text.split(":", 1)[1].strip()
        sentences = [s.strip() for s in re.split(r"\.\s+", after_colon) if s.strip()]
        if len(sentences) > 1:
            # First sentence usually describes the numeric trigger; subsequent sentences are the action
            action_text = ". ".join(sentences[1:]).rstrip(".") + "."
            # Remove specific numbers from action text if any
            action_text = re.sub(r"\b18\s*a\s*24\s*años\b", "jóvenes", action_text)
            action_text = re.sub(r"\b65\s*(?:años\s*o\s*más|\+)\b", "personas mayores", action_text)
            action_text = re.sub(r"\b2[,.]?500\s*habitantes\b", "población rural", action_text)
            return action_text

    # Fallback cleanup
    text = re.sub(r"\b18\s*a\s*24\s*años\b", "jóvenes", text)
    text = re.sub(r"\b65\s*(?:años\s*o\s*más|\+)\b", "personas mayores", text)
    text = re.sub(r"\b2[,.]?500\s*habitantes\b", "población rural", text)
    return text
