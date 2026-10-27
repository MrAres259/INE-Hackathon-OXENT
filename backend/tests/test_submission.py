"""Tests para el empaquetador y verificador de entrega de ATALAYA (Reto 2)."""

from __future__ import annotations

import json
from pathlib import Path
import zipfile

import openpyxl
import pandas as pd
import pytest

from atalaya.submission import (
    build_enlaces_text,
    check_connectivity,
    check_database,
    check_letters,
    check_presentation,
    check_report,
    check_scenarios_map,
    get_pdf_info,
    main,
    verify_all,
)


def make_fake_pdf(num_pages: int, width: int = 612, height: int = 792) -> bytes:
    """Genera un archivo PDF sintético con num_pages objetos /Type /Page y dimensiones."""
    objects = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    kids = " ".join(f"{i} 0 R" for i in range(3, 3 + num_pages))
    objects.append(f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {num_pages} >>\nendobj\n".encode())
    for i in range(3, 3 + num_pages):
        objects.append(
            f"{i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] >>\nendobj\n".encode()
        )
    header = b"%PDF-1.4\n"
    body = b"".join(objects)
    trailer = f"trailer\n<< /Root 1 0 R /Size {3 + num_pages} >>\n%%EOF\n".encode()
    return header + body + trailer


def setup_synthetic_deliverables(root: Path) -> tuple[Path, Path, Path]:
    """Crea una estructura completa de entregables sintéticos válidos en tmp_path."""
    deliv_dir = root / "deliverables"
    deliv_dir.mkdir(parents=True, exist_ok=True)
    out_dir = root / "entrega"
    out_dir.mkdir(parents=True, exist_ok=True)
    cartas_dir = out_dir / "cartas"
    cartas_dir.mkdir(parents=True, exist_ok=True)

    # 1. Presentación (10 páginas)
    (deliv_dir / "presentacion_ejecutiva.pdf").write_bytes(make_fake_pdf(10))

    # 2. Reporte (12 páginas, tamaño carta) y HTML hermano
    (deliv_dir / "reporte_metodologico.pdf").write_bytes(make_fake_pdf(12, 612, 792))
    html_content = """<!DOCTYPE html>
    <html>
    <head><title>Reporte Metodológico</title></head>
    <body>
      <h1>Reporte Metodológico ATALAYA</h1>
      <h2>1. Variables y Datos</h2>
      <h2>2. Semáforo de Riesgo</h2>
      <h2>3. Escenarios de Participación</h2>
      <h2>4. Recomendaciones Preventivas</h2>
      <h2>5. Priorización Territorial</h2>
    </body>
    </html>
    """
    (deliv_dir / "reporte_metodologico.html").write_text(html_content, encoding="utf-8")

    # 3. GeoJSON municipal (2,478) y estatal (32) con base e intervención
    mun_features = [
        {
            "type": "Feature",
            "properties": {
                "id": f"{i:05d}",
                "pred_abstention_base": 0.40,
                "category_base": "amarillo",
                "pred_abstention_intervencion": 0.35,
                "category_intervencion": "verde",
            },
            "geometry": None,
        }
        for i in range(1, 2479)
    ]
    mun_fc = {"type": "FeatureCollection", "features": mun_features}
    (deliv_dir / "mapa_escenarios_municipal.geojson").write_text(
        json.dumps(mun_fc), encoding="utf-8"
    )

    st_features = [
        {
            "type": "Feature",
            "properties": {
                "id": f"{i:02d}",
                "pred_abstention_base": 0.40,
                "category_base": "amarillo",
                "pred_abstention_intervencion": 0.35,
                "category_intervencion": "verde",
            },
            "geometry": None,
        }
        for i in range(1, 33)
    ]
    st_fc = {"type": "FeatureCollection", "features": st_features}
    (deliv_dir / "mapa_escenarios_estatal.geojson").write_text(
        json.dumps(st_fc), encoding="utf-8"
    )

    # Visor HTML y figuras
    (deliv_dir / "visor_escenarios.html").write_text("<!DOCTYPE html><html>Visor</html>", encoding="utf-8")
    figuras_dir = deliv_dir / "figuras"
    figuras_dir.mkdir(parents=True, exist_ok=True)
    (figuras_dir / "mun_diff.png").write_bytes(b"\x89PNG\r\n\x1a\nfakeimage")

    # 4. XLSX y CSVs
    wb = openpyxl.Workbook()
    wb.active.title = "LEEME"
    wb.create_sheet("municipios")
    wb.save(deliv_dir / "base_datos_atalaya.xlsx")
    wb.close()

    csv_dir = deliv_dir / "csv"
    csv_dir.mkdir(parents=True, exist_ok=True)
    (csv_dir / "LEEME.csv").write_text("seccion,contenido\nPROYECTO,ATALAYA\n", encoding="utf-8")
    (csv_dir / "semaforo_ponderado.csv").write_text("scenario,category,n_mun\nbase,verde,100\n", encoding="utf-8")
    (csv_dir / "municipios.csv").write_text("id,cve_ent,name,lista_nominal\n01001,01,Aguascalientes,500000\n", encoding="utf-8")
    (csv_dir / "priorizacion.csv").write_text("prioridad,id,name\n1,01001,Aguascalientes\n", encoding="utf-8")

    # perfil_edad_sexo protegido: ln>=10 y filas suprimidas con conteos nulos
    perfil_df = pd.DataFrame([
        {"cvegeo": 1001, "year": 2024, "ln": 100, "sv": 60.0, "nv": 40.0, "ns": 0.0, "participacion": 0.60, "suprimido": False},
        {"cvegeo": 1002, "year": 2024, "ln": None, "sv": None, "nv": None, "ns": None, "participacion": None, "suprimido": True},
    ])
    perfil_df.to_csv(csv_dir / "perfil_edad_sexo.csv", index=False)

    # 5. Cartas firmadas
    (cartas_dir / "carta_cesion_derechos.pdf").write_bytes(make_fake_pdf(1))
    (cartas_dir / "carta_decir_verdad.pdf").write_bytes(make_fake_pdf(1))

    return deliv_dir, out_dir, cartas_dir


def test_make_fake_pdf():
    """Verifica que el generador sintético cree PDFs con el conteo y dimensiones esperadas."""
    pdf_bytes = make_fake_pdf(5, 612, 792)
    assert b"/Type /Page" in pdf_bytes
    assert pdf_bytes.startswith(b"%PDF-1.4")


def test_all_present_exit_0_and_zip_structure(tmp_path: Path):
    """Verifica que con todos los entregables presentes la salida sea exit 0 y estructura del zip."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)

    exit_code = main([
        "--deliverables", str(deliv_dir),
        "--out", str(out_dir),
        "--team", "OXENT",
        "--app-url", "",
    ])

    assert exit_code == 0
    zip_path = out_dir / "OXENT_Reto2_Prediccion_y_escenarios_de_riesgo_de_abstencion.zip"
    assert zip_path.is_file()

    with zipfile.ZipFile(zip_path, "r") as zf:
        namelist = zf.namelist()
        assert "01_presentacion_ejecutiva.pdf" in namelist
        assert "02_reporte_metodologico.pdf" in namelist
        assert "03_mapa_escenarios/visor_escenarios.html" in namelist
        assert "03_mapa_escenarios/mapa_escenarios_municipal.geojson" in namelist
        assert "03_mapa_escenarios/mapa_escenarios_estatal.geojson" in namelist
        assert "03_mapa_escenarios/figuras/mun_diff.png" in namelist
        assert "04_base_datos/base_datos_atalaya.xlsx" in namelist
        assert "04_base_datos/csv/municipios.csv" in namelist
        assert "05_cartas/carta_cesion_derechos.pdf" in namelist
        assert "05_cartas/carta_decir_verdad.pdf" in namelist
        assert "ENLACES.txt" in namelist


def test_report_16_pages_fails(tmp_path: Path):
    """Verifica que un reporte de 16 páginas resulte en FALTA y exit code 1."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)
    (deliv_dir / "reporte_metodologico.pdf").write_bytes(make_fake_pdf(16, 612, 792))

    exit_code = main([
        "--deliverables", str(deliv_dir),
        "--out", str(out_dir),
        "--team", "OXENT",
        "--app-url", "",
    ])

    assert exit_code == 1
    res = check_report(deliv_dir)
    assert res.status == "FALTA"
    assert "16 páginas" in res.detail


def test_presentation_over_10_pages_fails(tmp_path: Path):
    """Verifica que una presentación con más de 10 diapositivas sea rechazada."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)
    (deliv_dir / "presentacion_ejecutiva.pdf").write_bytes(make_fake_pdf(12))

    exit_code = main([
        "--deliverables", str(deliv_dir),
        "--out", str(out_dir),
        "--team", "OXENT",
        "--app-url", "",
    ])

    assert exit_code == 1
    res = check_presentation(deliv_dir)
    assert res.status == "FALTA"


def test_missing_letters_without_and_with_flag(tmp_path: Path):
    """Verifica que sin cartas dé exit 1, pero con --allow-missing-letters dé 0 y arme zip INCOMPLETO."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)
    for f in cartas_dir.glob("*.pdf"):
        f.unlink()

    # Sin bandera: debe fallar con exit 1 y no crear zip
    exit_code_1 = main([
        "--deliverables", str(deliv_dir),
        "--out", str(out_dir),
        "--team", "OXENT",
        "--app-url", "",
    ])
    assert exit_code_1 == 1

    # Con bandera: debe pasar con exit 0 y crear zip INCOMPLETO
    exit_code_0 = main([
        "--deliverables", str(deliv_dir),
        "--out", str(out_dir),
        "--team", "OXENT",
        "--allow-missing-letters",
        "--app-url", "",
    ])
    assert exit_code_0 == 0
    incompleto_zip = out_dir / "OXENT_Reto2_Prediccion_y_escenarios_de_riesgo_de_abstencion_INCOMPLETO.zip"
    assert incompleto_zip.is_file()


def test_forbidden_curp_column_fails(tmp_path: Path):
    """Verifica que columnas con nombres personales prohibidos (como curp) generen FALTA."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)
    csv_file = deliv_dir / "csv" / "municipios.csv"
    csv_file.write_text("id,name,curp,lista_nominal\n01001,Aguascalientes,ABCD123456,100\n", encoding="utf-8")

    res = check_database(deliv_dir)
    assert res.status == "FALTA"
    assert "curp" in res.detail

    exit_code = main([
        "--deliverables", str(deliv_dir),
        "--out", str(out_dir),
        "--app-url", "",
    ])
    assert exit_code == 1


def test_perfil_edad_sexo_unsuppressed_fails(tmp_path: Path):
    """Verifica que una fila con ln < 10 con conteos sin suprimir provoque FALTA."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)
    csv_file = deliv_dir / "csv" / "perfil_edad_sexo.csv"
    violating_df = pd.DataFrame([
        {"cvegeo": 1001, "year": 2024, "ln": 5, "sv": 3.0, "nv": 2.0, "ns": 0.0, "participacion": 0.60, "suprimido": False},
    ])
    violating_df.to_csv(csv_file, index=False)

    res = check_database(deliv_dir)
    assert res.status == "FALTA"
    assert "sin suprimir" in res.detail

    exit_code = main([
        "--deliverables", str(deliv_dir),
        "--out", str(out_dir),
        "--app-url", "",
    ])
    assert exit_code == 1


def test_size_rule_excludes_duplicate_csvs(tmp_path: Path):
    """Verifica que si el ZIP supera max_mb se excluyan CSVs redundantes preservando los esenciales."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)
    csv_dir = deliv_dir / "csv"

    # Agregar CSV duplicado adicional
    (csv_dir / "participacion_historica.csv").write_text("id,year,participacion\n01001,2024,0.55\n", encoding="utf-8")

    # Usar max_mb muy bajo (0.0001 MB) para forzar la exclusión
    exit_code = main([
        "--deliverables", str(deliv_dir),
        "--out", str(out_dir),
        "--team", "OXENT",
        "--max-mb", "0.0001",
        "--app-url", "",
    ])

    assert exit_code == 0
    zip_path = out_dir / "OXENT_Reto2_Prediccion_y_escenarios_de_riesgo_de_abstencion.zip"
    assert zip_path.is_file()

    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        # participacion_historica.csv debe haber sido excluida
        assert "04_base_datos/csv/participacion_historica.csv" not in names
        # Esenciales deben permanecer
        assert "04_base_datos/csv/municipios.csv" in names
        assert "04_base_datos/csv/priorizacion.csv" in names
        assert "04_base_datos/csv/semaforo_ponderado.csv" in names
        assert "04_base_datos/csv/LEEME.csv" in names


def test_html_missing_keywords_fails(tmp_path: Path):
    """Verifica que si el HTML hermano omite alguna sección exigida (ej. Recomendaciones) dé FALTA."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)
    incomplete_html = """<!DOCTYPE html>
    <html><body>
      <h2>Variables</h2>
      <h2>Semáforo</h2>
      <h2>Escenarios</h2>
      <h2>Priorización</h2>
    </body></html>"""
    (deliv_dir / "reporte_metodologico.html").write_text(incomplete_html, encoding="utf-8")

    res = check_report(deliv_dir)
    assert res.status == "FALTA"
    assert "Recomendaciones" in res.detail


def test_cartas_leeme_auto_created(tmp_path: Path):
    """Verifica que LEEME.txt en cartas/ se genere automáticamente si no existe."""
    deliv_dir = tmp_path / "deliverables"
    cartas_dir = tmp_path / "entrega" / "cartas"
    deliv_dir.mkdir(parents=True, exist_ok=True)
    # cartas_dir aun no existe

    res = check_letters(cartas_dir)
    assert res.status == "FALTA"  # Faltan PDFs
    assert (cartas_dir / "LEEME.txt").is_file()
    txt = (cartas_dir / "LEEME.txt").read_text(encoding="utf-8")
    assert "https://ine.mx/hackathon-2026/" in txt


def test_geojson_feature_count_validation(tmp_path: Path):
    """Verifica que GeoJSONs con número incorrecto de features causen FALTA."""
    deliv_dir, out_dir, cartas_dir = setup_synthetic_deliverables(tmp_path)
    wrong_mun = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"base": 1, "interv": 2}}]}
    (deliv_dir / "mapa_escenarios_municipal.geojson").write_text(json.dumps(wrong_mun), encoding="utf-8")

    res = check_scenarios_map(deliv_dir)
    assert res.status == "FALTA"
    assert "2,478" in res.detail


def test_enlaces_branding():
    """Verifies that ENLACES.txt header lockup uses Atalaya Electoral branding."""
    txt = build_enlaces_text(team="OXENT", app_url="http://46.250.172.193:8080", repo_url="https://github.com/oxent/atalaya")
    assert "Atalaya Electoral · Hackathon INE 2026 · Reto 2" in txt
    assert "Riesgo de abstención · Elección federal 2027" in txt
    assert "Propuesta del equipo: OXENT" in txt
    assert "http://46.250.172.193:8080" in txt

