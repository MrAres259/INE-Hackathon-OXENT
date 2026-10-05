"""Helper to create binary encoded fixtures for test_ingest_common."""

from pathlib import Path

fixtures_dir = Path(__file__).resolve().parent

# 1. UTF-8 with BOM
bom_path = fixtures_dir / "sample_utf8_bom.csv"
content_bom = "CVE_ENT,NOM_ENT,POB_TOT\n07,Chiapas,5543828\n09,Ciudad de México,9209944\n"
bom_path.write_bytes(b"\xef\xbb\xbf" + content_bom.encode("utf-8"))

# 2. CP1252 with | delimiter and 3 header/title lines before table header
cp1252_path = fixtures_dir / "sample_cp1252_pipe.csv"
content_cp1252 = (
    "INSTITUTO NACIONAL ELECTORAL\n"
    "REPORTE GENERAL DE VOTACIÓN\n"
    "FECHA DE CORTE: 2024-06-02\n"
    "CVE_ENT|MUN_NAME|VOTOS\n"
    "07|Tuxtla Gutiérrez|12345\n"
    "09|Benito Juárez|67890\n"
)
cp1252_path.write_bytes(content_cp1252.encode("cp1252"))

print("Fixtures created successfully.")
