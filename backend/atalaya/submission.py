"""Empaquetador y verificador de la entrega del Reto 2 (Hackathon INE 2026).

Verifica todos los entregables obligatorios, valida reglas de privacidad y tamaño,
y genera el paquete ZIP listo para envío por correo.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import io
import json
import os
from pathlib import Path
import re
import sys
from typing import Literal
import urllib.error
import urllib.request
import zipfile

import openpyxl
import pandas as pd


FORBIDDEN_COLUMNS = {
    "nombre_ciudadano",
    "nombre_completo",
    "curp",
    "clave_elector",
    "domicilio",
    "direccion",
    "telefono",
    "celular",
    "email",
    "correo_electronico",
    "rfc",
}

REQUIRED_HTML_SECTIONS = [
    ("Variables", r"variables"),
    ("Semáforo", r"sem[aá]foro"),
    ("Escenarios", r"escenarios"),
    ("Recomendaciones", r"recomendaciones"),
    ("Priorización", r"priorizaci[oó]n"),
]

KEEP_CSVS = {
    "semaforo_ponderado.csv",
    "municipios.csv",
    "priorizacion.csv",
    "LEEME.csv",
}

LEEME_CARTAS_TEXT = """INSTRUCCIONES PARA CARTAS FIRMADAS (HACKATHON INE 2026 - RETO 2)
================================================================

Para completar la entrega del Reto 2 («Hackea la participación: Datos que construyen
democracia»), se deben colocar en esta carpeta los siguientes dos documentos oficiales
firmados en formato PDF por los integrantes del equipo:

1. Carta de cesión de derechos:
   - Nombre sugerido: carta_cesion_derechos.pdf
   - El nombre del archivo debe contener la palabra 'cesion' o 'cesión'.

2. Carta bajo protesta de decir verdad:
   - Nombre sugerido: carta_decir_verdad.pdf
   - El nombre del archivo debe contener la palabra 'verdad'.

Descarga de formatos oficiales de la convocatoria:
https://ine.mx/hackathon-2026/

Una vez colocados ambos archivos firmados en esta carpeta (deliverables/entrega/cartas/),
ejecute nuevamente el verificador y empaquetador:
    python -m atalaya.submission
"""


@dataclass
class CheckResult:
    """Resultado individual de una verificación de entregable."""

    name: str
    status: Literal["OK", "FALTA", "AVISO"]
    detail: str


def get_pdf_info(pdf_path: Path) -> tuple[int, float, float]:
    """Obtiene el número de páginas y dimensiones (ancho, alto en pt) de un PDF."""
    try:
        import pdfplumber

        with pdfplumber.open(pdf_path) as pdf:
            pages = len(pdf.pages)
            w = float(pdf.pages[0].width) if pages > 0 else 0.0
            h = float(pdf.pages[0].height) if pages > 0 else 0.0
            return pages, w, h
    except Exception:
        pass

    try:
        data = pdf_path.read_bytes()
        pages = len(re.findall(rb"/Type\s*/Page\b", data))
        return pages, 0.0, 0.0
    except Exception:
        return 0, 0.0, 0.0


def check_presentation(deliverables_dir: Path) -> CheckResult:
    """Verifica la existencia y límite de páginas de presentacion_ejecutiva.pdf."""
    target = deliverables_dir / "presentacion_ejecutiva.pdf"
    if not target.is_file():
        return CheckResult("Presentación ejecutiva", "FALTA", f"No se encontró {target.name}")

    pages, _, _ = get_pdf_info(target)
    if pages == 0:
        return CheckResult("Presentación ejecutiva", "FALTA", "El archivo PDF está vacío o corrupto (0 páginas)")
    if pages > 10:
        return CheckResult(
            "Presentación ejecutiva",
            "FALTA",
            f"{pages} diapositivas (excede el máximo permitido de 10)",
        )
    return CheckResult("Presentación ejecutiva", "OK", f"{pages} diapositivas (≤ 10 exigidas)")


def check_report(deliverables_dir: Path) -> CheckResult:
    """Verifica reporte_metodologico.pdf (10-15 pp, carta) y secciones en el HTML hermano."""
    pdf_target = deliverables_dir / "reporte_metodologico.pdf"
    html_target = deliverables_dir / "reporte_metodologico.html"

    if not pdf_target.is_file():
        return CheckResult("Reporte metodológico", "FALTA", f"No se encontró {pdf_target.name}")

    pages, w, h = get_pdf_info(pdf_target)
    if pages == 0:
        return CheckResult("Reporte metodológico", "FALTA", "El archivo PDF está vacío o corrupto (0 páginas)")
    if pages < 10 or pages > 15:
        return CheckResult(
            "Reporte metodológico",
            "FALTA",
            f"{pages} páginas (debe tener entre 10 y 15 cuartillas)",
        )

    paper_note = ""
    if w > 0 and h > 0:
        is_letter = (abs(w - 612) <= 25 and abs(h - 792) <= 25) or (abs(w - 792) <= 25 and abs(h - 612) <= 25)
        if is_letter:
            paper_note = ", tamaño carta"
        else:
            paper_note = f", dimensiones {w:.0f}x{h:.0f} pt difieren de carta estándar (612x792 pt)"

    if not html_target.is_file():
        return CheckResult(
            "Reporte metodológico",
            "FALTA",
            f"{pages} páginas{paper_note}, pero falta el HTML hermano {html_target.name}",
        )

    try:
        html_content = html_target.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        return CheckResult("Reporte metodológico", "FALTA", f"Error leyendo {html_target.name}: {e}")

    missing_sections = []
    for label, pattern in REQUIRED_HTML_SECTIONS:
        if not re.search(pattern, html_content, re.IGNORECASE):
            missing_sections.append(label)

    if missing_sections:
        return CheckResult(
            "Reporte metodológico",
            "FALTA",
            f"{pages} páginas{paper_note}, pero faltan secciones clave en HTML: {', '.join(missing_sections)}",
        )

    return CheckResult(
        "Reporte metodológico",
        "OK",
        f"{pages} páginas{paper_note}, HTML con 5/5 secciones clave",
    )


def check_scenarios_map(deliverables_dir: Path) -> CheckResult:
    """Verifica GeoJSONs municipal y estatal (conteo, FeatureCollection, base e intervención) y visor HTML."""
    mun_target = deliverables_dir / "mapa_escenarios_municipal.geojson"
    st_target = deliverables_dir / "mapa_escenarios_estatal.geojson"
    viewer_target = deliverables_dir / "visor_escenarios.html"

    if not mun_target.is_file():
        return CheckResult("Mapa de escenarios", "FALTA", f"No se encontró {mun_target.name}")

    try:
        mun_data = json.loads(mun_target.read_text(encoding="utf-8"))
    except Exception as e:
        return CheckResult("Mapa de escenarios", "FALTA", f"{mun_target.name} no es JSON válido: {e}")

    if mun_data.get("type") != "FeatureCollection":
        return CheckResult("Mapa de escenarios", "FALTA", f"{mun_target.name} debe ser FeatureCollection")

    mun_features = mun_data.get("features", [])
    if len(mun_features) != 2478:
        return CheckResult(
            "Mapa de escenarios",
            "FALTA",
            f"{mun_target.name} tiene {len(mun_features)} features (esperados: 2,478)",
        )

    mun_props = mun_features[0].get("properties", {})
    mun_base_keys = [k for k in mun_props if "base" in k.lower()]
    mun_interv_keys = [k for k in mun_props if "interv" in k.lower()]
    if not mun_base_keys or not mun_interv_keys:
        return CheckResult(
            "Mapa de escenarios",
            "FALTA",
            f"{mun_target.name} no contiene propiedades de base e intervención",
        )

    if not st_target.is_file():
        return CheckResult("Mapa de escenarios", "FALTA", f"No se encontró {st_target.name}")

    try:
        st_data = json.loads(st_target.read_text(encoding="utf-8"))
    except Exception as e:
        return CheckResult("Mapa de escenarios", "FALTA", f"{st_target.name} no es JSON válido: {e}")

    if st_data.get("type") != "FeatureCollection":
        return CheckResult("Mapa de escenarios", "FALTA", f"{st_target.name} debe ser FeatureCollection")

    st_features = st_data.get("features", [])
    if len(st_features) != 32:
        return CheckResult(
            "Mapa de escenarios",
            "FALTA",
            f"{st_target.name} tiene {len(st_features)} features (esperados: 32)",
        )

    st_props = st_features[0].get("properties", {})
    st_base_keys = [k for k in st_props if "base" in k.lower()]
    st_interv_keys = [k for k in st_props if "interv" in k.lower()]
    if not st_base_keys or not st_interv_keys:
        return CheckResult(
            "Mapa de escenarios",
            "FALTA",
            f"{st_target.name} no contiene propiedades de base e intervención",
        )

    if not viewer_target.is_file():
        return CheckResult(
            "Mapa de escenarios",
            "AVISO",
            f"GeoJSONs OK (2,478 mun / 32 est con base/intervención); falta {viewer_target.name} (generable con python -m atalaya.viewer)",
        )

    return CheckResult(
        "Mapa de escenarios",
        "OK",
        f"GeoJSONs OK (2,478 mun / 32 est con base/intervención) y visor HTML presente",
    )


def check_database(deliverables_dir: Path) -> CheckResult:
    """Verifica base_datos_atalaya.xlsx, carpeta csv/ y reglas estrictas de privacidad."""
    xlsx_target = deliverables_dir / "base_datos_atalaya.xlsx"
    csv_dir = deliverables_dir / "csv"

    if not xlsx_target.is_file():
        return CheckResult("Base de datos anonimizada", "FALTA", f"No se encontró {xlsx_target.name}")

    try:
        wb = openpyxl.load_workbook(xlsx_target, read_only=True)
        sheets = wb.sheetnames
        wb.close()
        if not sheets:
            return CheckResult("Base de datos anonimizada", "FALTA", f"{xlsx_target.name} no contiene hojas")
    except Exception as e:
        return CheckResult("Base de datos anonimizada", "FALTA", f"Error abriendo {xlsx_target.name}: {e}")

    if not csv_dir.is_dir():
        return CheckResult("Base de datos anonimizada", "FALTA", f"No se encontró la carpeta {csv_dir.name}/")

    csv_files = sorted(csv_dir.glob("*.csv"))
    if not csv_files:
        return CheckResult("Base de datos anonimizada", "FALTA", f"La carpeta {csv_dir.name}/ está vacía")

    for cpath in csv_files:
        try:
            with open(cpath, "r", encoding="utf-8", errors="ignore") as f:
                header_line = f.readline().strip()
            cols = [c.strip().strip('"').strip("'").lower() for c in header_line.split(",") if c.strip()]
            for col in cols:
                if col in FORBIDDEN_COLUMNS or "curp" in col or "clave_elector" in col or "nombre_ciudadano" in col:
                    return CheckResult(
                        "Base de datos anonimizada",
                        "FALTA",
                        f"Columna de datos personales prohibida '{col}' detectada en {cpath.name}",
                    )
        except Exception as e:
            return CheckResult("Base de datos anonimizada", "FALTA", f"Error leyendo encabezados de {cpath.name}: {e}")

    perfil_csv = csv_dir / "perfil_edad_sexo.csv"
    if perfil_csv.is_file():
        try:
            df = pd.read_csv(perfil_csv)
            counts_and_rate = [c for c in ["sv", "nv", "ns", "participacion"] if c in df.columns]

            if "ln" in df.columns:
                ln_num = pd.to_numeric(df["ln"], errors="coerce")
                low_ln = df[ln_num.notna() & (ln_num < 10)]
                if not low_ln.empty:
                    if counts_and_rate:
                        violations = low_ln[low_ln[counts_and_rate].notna().any(axis=1)]
                        if not violations.empty:
                            return CheckResult(
                                "Base de datos anonimizada",
                                "FALTA",
                                f"En perfil_edad_sexo.csv hay {len(violations)} fila(s) con ln < 10 sin suprimir conteos o tasa",
                            )
                    if "suprimido" in df.columns:
                        unmarked = low_ln[~low_ln["suprimido"].astype(str).str.strip().str.lower().isin(["true", "1"])]
                        if not unmarked.empty:
                            return CheckResult(
                                "Base de datos anonimizada",
                                "FALTA",
                                f"En perfil_edad_sexo.csv hay {len(unmarked)} fila(s) con ln < 10 no marcadas como suprimido=True",
                            )

            if "suprimido" in df.columns and counts_and_rate:
                sup_mask = df["suprimido"].astype(str).str.strip().str.lower().isin(["true", "1"])
                sup_rows = df[sup_mask]
                if not sup_rows.empty:
                    violations = sup_rows[sup_rows[counts_and_rate].notna().any(axis=1)]
                    if not violations.empty:
                        return CheckResult(
                            "Base de datos anonimizada",
                            "FALTA",
                            f"En perfil_edad_sexo.csv hay {len(violations)} fila(s) con suprimido=True con conteos o tasa no nulos",
                        )
        except Exception as e:
            return CheckResult("Base de datos anonimizada", "FALTA", f"Error validando perfil_edad_sexo.csv: {e}")

    return CheckResult(
        "Base de datos anonimizada",
        "OK",
        f"XLSX ({len(sheets)} hojas), {len(csv_files)} CSVs, sin datos personales, supresión ln<10 OK",
    )


def check_letters(cartas_dir: Path) -> CheckResult:
    """Verifica la presencia de cartas de cesión de derechos y decir verdad en formato PDF."""
    cartas_dir.mkdir(parents=True, exist_ok=True)
    leeme_path = cartas_dir / "LEEME.txt"
    if not leeme_path.is_file():
        try:
            leeme_path.write_text(LEEME_CARTAS_TEXT, encoding="utf-8")
        except Exception:
            pass

    pdf_files = list(cartas_dir.glob("*.pdf"))
    cesion = any("cesion" in p.name.lower() or "cesión" in p.name.lower() for p in pdf_files)
    verdad = any("verdad" in p.name.lower() for p in pdf_files)

    if cesion and verdad:
        return CheckResult("Cartas firmadas", "OK", "Cartas de cesión de derechos y de decir verdad presentes")

    missing = []
    if not cesion:
        missing.append("carta_cesion_derechos*.pdf")
    if not verdad:
        missing.append("carta_decir_verdad*.pdf")

    return CheckResult(
        "Cartas firmadas",
        "FALTA",
        f"Faltan cartas en {cartas_dir.as_posix()}: {', '.join(missing)}",
    )


def check_connectivity(app_url: str) -> CheckResult:
    """Verifica si la aplicación pública responde en /api/health (no bloqueante, timeout 5s)."""
    if not app_url or not app_url.strip():
        return CheckResult("Enlaces y conectividad", "AVISO", "URL de la app pública no configurada")

    clean_url = app_url.strip().rstrip("/")
    health_url = f"{clean_url}/api/health"

    try:
        req = urllib.request.Request(health_url, headers={"User-Agent": "atalaya-submission/1.0"})
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            status_code = getattr(resp, "status", 200)
            if status_code == 200:
                return CheckResult("Enlaces y conectividad", "OK", f"App pública responde en {health_url} (HTTP 200)")
            return CheckResult("Enlaces y conectividad", "AVISO", f"App responde HTTP {status_code} en {health_url}")
    except Exception as e:
        return CheckResult(
            "Enlaces y conectividad",
            "AVISO",
            f"App pública no responde en {health_url} ({e}) (no bloqueante)",
        )


def build_enlaces_text(team: str, app_url: str, repo_url: str) -> str:
    """Genera el contenido de ENLACES.txt incluido en la raíz del paquete."""
    return f"""================================================================================
ATALAYA · HACKATHON INE 2026 · RETO 2
Eje: Predicción y escenarios de riesgo de abstención
Equipo: {team}
================================================================================

1. APLICACIÓN PÚBLICA (TABLERO DINÁMICO)
--------------------------------------------------------------------------------
URL: {app_url or "http://46.250.172.193:8080"}
- Tablero interactivo con mapa nacional vectorial (estados y municipios).
- Visualización de semáforo de riesgo y escenarios (Base, Intervención, Pesimista).
- Simulación dinámica de metas y políticas de participación ciudadana.
- Asistente analítico inteligente con explicaciones contextuales.

2. REPOSITORIO DE CÓDIGO
--------------------------------------------------------------------------------
URL: {repo_url or "https://github.com/oxent/atalaya"}
- Código fuente completo (backend FastAPI + frontend Next.js).
- Pipeline reproducible de ingesta de datos electorales y censales oficiales.
- Modelo predictivo, balance de datos y calibración.
- Suites de pruebas unitarias y de integración.

3. VISOR AUTÓNOMO DE ESCENARIOS (OFFLINE / SIN INTERNET)
--------------------------------------------------------------------------------
Ubicación: 03_mapa_escenarios/visor_escenarios.html
Instrucciones:
1. Abra el archivo 'visor_escenarios.html' directamente en cualquier navegador web
   moderno (Google Chrome, Microsoft Edge, Mozilla Firefox o Safari).
2. Funciona de manera 100% autónoma y sin conexión a internet ni dependencias externas.
3. Permite alternar entre los escenarios de abstención, inspeccionar el semáforo
   por entidad federativa y municipio, y consultar factores y recomendaciones.

4. DATOS DE CONTACTO DEL EQUIPO
--------------------------------------------------------------------------------
Equipo: {team}
Representante / Enlace técnico:
- Nombre completo: __________________________________________________
- Correo electrónico: _______________________________________________
- Teléfono de contacto: _____________________________________________
- Institución / Procedencia: ________________________________________

5. BASE DE DATOS Y ENLACES COMPLEMENTARIOS
--------------------------------------------------------------------------------
- La base de datos completa se incluye en 04_base_datos/base_datos_atalaya.xlsx
  (11 hojas con metodología, diccionario, semáforo, priorización y anonimización).
- Enlace opcional para descarga de base de datos completa / extendida en la nube:
  URL: [https://drive.google.com/... o https://onedrive.live.com/...]
"""


def write_zip_archive(
    zip_path: Path,
    file_map: dict[str, Path | bytes],
    exclude_duplicate_csvs: bool = False,
) -> float:
    """Escribe los archivos en un ZIP con nivel 9 de compresión y devuelve el tamaño en MB."""
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for arcname, item in file_map.items():
            if exclude_duplicate_csvs and arcname.startswith("04_base_datos/csv/"):
                csv_fname = Path(arcname).name
                if csv_fname not in KEEP_CSVS:
                    continue

            if isinstance(item, bytes):
                zf.writestr(arcname, item)
            elif isinstance(item, Path) and item.is_file():
                zf.write(item, arcname)

    size_mb = zip_path.stat().st_size / (1024 * 1024)
    return size_mb


def build_package(
    deliverables_dir: Path,
    out_dir: Path,
    cartas_dir: Path,
    team: str = "OXENT",
    app_url: str = "",
    repo_url: str = "",
    max_mb: float = 20.0,
    is_incomplete: bool = False,
) -> tuple[Path, float, list[str]]:
    """Construye el archivo ZIP con la estructura oficial del Reto 2."""
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = "_INCOMPLETO.zip" if is_incomplete else ".zip"
    clean_team = re.sub(r"[^\w]", "_", team.strip())
    zip_filename = f"{clean_team}_Reto2_Prediccion_y_escenarios_de_riesgo_de_abstencion{suffix}"
    zip_path = out_dir / zip_filename

    file_map: dict[str, Path | bytes] = {}

    # 01 Presentacion
    pres = deliverables_dir / "presentacion_ejecutiva.pdf"
    if pres.is_file():
        file_map["01_presentacion_ejecutiva.pdf"] = pres

    # 02 Reporte
    rep = deliverables_dir / "reporte_metodologico.pdf"
    if rep.is_file():
        file_map["02_reporte_metodologico.pdf"] = rep

    # 03 Mapa de escenarios
    visor = deliverables_dir / "visor_escenarios.html"
    if visor.is_file():
        file_map["03_mapa_escenarios/visor_escenarios.html"] = visor

    mun_geo = deliverables_dir / "mapa_escenarios_municipal.geojson"
    if mun_geo.is_file():
        file_map["03_mapa_escenarios/mapa_escenarios_municipal.geojson"] = mun_geo

    st_geo = deliverables_dir / "mapa_escenarios_estatal.geojson"
    if st_geo.is_file():
        file_map["03_mapa_escenarios/mapa_escenarios_estatal.geojson"] = st_geo

    figuras_dir = deliverables_dir / "figuras"
    if figuras_dir.is_dir():
        for fig in sorted(figuras_dir.glob("*.png")):
            file_map[f"03_mapa_escenarios/figuras/{fig.name}"] = fig

    # 04 Base de datos
    xlsx = deliverables_dir / "base_datos_atalaya.xlsx"
    if xlsx.is_file():
        file_map["04_base_datos/base_datos_atalaya.xlsx"] = xlsx

    csv_dir = deliverables_dir / "csv"
    if csv_dir.is_dir():
        for c in sorted(csv_dir.glob("*.csv")):
            file_map[f"04_base_datos/csv/{c.name}"] = c

    # 05 Cartas
    if cartas_dir.is_dir():
        for card in sorted(cartas_dir.glob("*.pdf")):
            file_map[f"05_cartas/{card.name}"] = card

    # ENLACES.txt
    enlaces_txt = build_enlaces_text(team=team, app_url=app_url, repo_url=repo_url)
    file_map["ENLACES.txt"] = enlaces_txt.encode("utf-8")

    warnings: list[str] = []

    # Intento 1: con todos los CSVs
    size_mb = write_zip_archive(zip_path, file_map, exclude_duplicate_csvs=False)

    # Intento 2: si excede el límite, excluir CSVs duplicados del XLSX
    if size_mb > max_mb:
        size_mb = write_zip_archive(zip_path, file_map, exclude_duplicate_csvs=True)
        if size_mb > max_mb:
            heaviest_arcname = ""
            heaviest_bytes = 0
            for arc, it in file_map.items():
                b = it.stat().st_size if isinstance(it, Path) else len(it)
                if b > heaviest_bytes:
                    heaviest_bytes = b
                    heaviest_arcname = arc
            h_mb = heaviest_bytes / (1024 * 1024)
            warnings.append(
                f"El ZIP ({size_mb:.2f} MB) excede {max_mb:.0f} MB para envío por correo. "
                f"Archivo más pesado: {heaviest_arcname} ({h_mb:.2f} MB). "
                f"Se sugiere compartir la base completa por enlace (Drive/OneDrive) en ENLACES.txt."
            )
        else:
            warnings.append(
                f"ZIP optimizado a {size_mb:.2f} MB excluyendo CSVs duplicados del XLSX (hojas intactas en XLSX)."
            )

    return zip_path, size_mb, warnings


def verify_all(
    deliverables_dir: Path,
    cartas_dir: Path,
    app_url: str = "",
) -> list[CheckResult]:
    """Ejecuta todas las verificaciones exigidas por la convocatoria."""
    results: list[CheckResult] = []
    results.append(check_presentation(deliverables_dir))
    results.append(check_report(deliverables_dir))
    results.append(check_scenarios_map(deliverables_dir))
    results.append(check_database(deliverables_dir))
    results.append(check_letters(cartas_dir))
    results.append(check_connectivity(app_url))
    return results


def print_summary_table(
    checks: list[CheckResult],
    team: str,
    zip_path: Path | None,
    size_mb: float | None,
    is_incomplete: bool,
    package_warnings: list[str],
) -> None:
    """Imprime el resumen de verificación en tabla clara y formateada."""
    sep = "=" * 80
    subsep = "-" * 80

    print(f"\n{sep}")
    print(f"VERIFICACIÓN DE ENTREGABLES · RETO 2 (HACKATHON INE 2026)")
    print(f"Equipo: {team} · Eje: Predicción y escenarios de riesgo de abstención")
    print(sep)
    print(f"{'Entregable':<26} {'Estado':<8} {'Detalle'}")
    print(subsep)

    for c in checks:
        status_disp = f"[{c.status}]"
        print(f"{c.name:<26} {status_disp:<8} {c.detail}")

    print(subsep)

    for w in package_warnings:
        print(f"[AVISO PAQUETE] {w}")

    if zip_path is not None and size_mb is not None:
        state_str = "INCOMPLETO (permitido con --allow-missing-letters)" if is_incomplete else "LISTO"
        print(f"Estado global: {state_str}")
        print(f"Paquete ZIP:   {zip_path.as_posix()} ({size_mb:.2f} MB)")
    else:
        print("Estado global: FALTA (paquete bloqueado)")
        print("[-] El paquete NO se encuentra listo para entrega. Corrija los errores arriba indicados.")

    print(f"{sep}\n")


def main(argv: list[str] | None = None) -> int:
    """Punto de entrada de la CLI de verificación y empaquetado."""
    parser = argparse.ArgumentParser(
        description="Empaquetador y verificador de la entrega del Reto 2 (Hackathon INE 2026)"
    )
    parser.add_argument("--team", default="OXENT", help="Nombre del equipo (default: OXENT)")
    parser.add_argument(
        "--app-url",
        default=os.getenv("ATALAYA_PUBLIC_URL", "http://46.250.172.193:8080"),
        help="URL pública de la aplicación",
    )
    parser.add_argument(
        "--repo-url",
        default=os.getenv("ATALAYA_REPO_URL", "https://github.com/oxent/atalaya"),
        help="URL pública del repositorio",
    )
    parser.add_argument(
        "--deliverables",
        type=Path,
        default=None,
        help="Ruta al directorio deliverables/ (default: ../deliverables)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Ruta al directorio de salida (default: deliverables/entrega)",
    )
    parser.add_argument(
        "--max-mb",
        type=float,
        default=20.0,
        help="Límite en MB antes de excluir CSVs duplicados (default: 20.0)",
    )
    parser.add_argument(
        "--allow-missing-letters",
        action="store_true",
        help="Genera el ZIP aun si faltan cartas firmadas (lo marca INCOMPLETO)",
    )

    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parents[2]
    deliverables_dir = (
        args.deliverables.resolve()
        if args.deliverables is not None
        else (repo_root / "deliverables").resolve()
    )
    out_dir = (
        args.out.resolve()
        if args.out is not None
        else (deliverables_dir / "entrega").resolve()
    )

    if (deliverables_dir / "entrega" / "cartas").is_dir():
        cartas_dir = (deliverables_dir / "entrega" / "cartas").resolve()
    else:
        cartas_dir = (out_dir / "cartas").resolve()

    checks = verify_all(
        deliverables_dir=deliverables_dir,
        cartas_dir=cartas_dir,
        app_url=args.app_url,
    )

    has_fatal_falta = False
    letters_missing = False

    for c in checks:
        if c.status == "FALTA":
            if c.name == "Cartas firmadas":
                letters_missing = True
                if not args.allow_missing_letters:
                    has_fatal_falta = True
            else:
                has_fatal_falta = True

    if has_fatal_falta:
        print_summary_table(
            checks=checks,
            team=args.team,
            zip_path=None,
            size_mb=None,
            is_incomplete=False,
            package_warnings=[],
        )
        return 1

    zip_path, size_mb, pkg_warnings = build_package(
        deliverables_dir=deliverables_dir,
        out_dir=out_dir,
        cartas_dir=cartas_dir,
        team=args.team,
        app_url=args.app_url,
        repo_url=args.repo_url,
        max_mb=args.max_mb,
        is_incomplete=letters_missing,
    )

    print_summary_table(
        checks=checks,
        team=args.team,
        zip_path=zip_path,
        size_mb=size_mb,
        is_incomplete=letters_missing,
        package_warnings=pkg_warnings,
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
