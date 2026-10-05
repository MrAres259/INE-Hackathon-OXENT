"""Create static fixtures for INE results ingest tests."""

from pathlib import Path

fixtures_dir = Path(__file__).resolve().parent

# 1. DIP_FED_2021.csv: UTF-8 with BOM, comma, casilla level, 2 header/title lines before table header
content_2021 = (
    "PROCESO ELECTORAL FEDERAL 2020-2021\n"
    "CÓMPUTOS DISTRITALES DE DIPUTACIONES FEDERALES MR\n"
    "ID_ESTADO,NOMBRE_ESTADO,ID_DISTRITO,ID_MUNICIPIO,MUNICIPIO,SECCION,CASILLA,PAN,PRI,PRD,TOTAL_VOTOS,LISTA_NOMINAL\n"
    "7,CHIAPAS,1,101,TUXTLA GUTIERREZ,1001,B,100,100,50,300,500\n"
    "7,CHIAPAS,1,101,TUXTLA GUTIERREZ,1001,C1,80,90,30,220,500\n"
    "7,CHIAPAS,1,101,TUXTLA GUTIERREZ,1001,S1,20,10,10,50,0\n"
    "7,CHIAPAS,5,102,SAN CRISTOBAL DE LAS CASAS,1100,B,150,150,50,400,600\n"
    "7,CHIAPAS,5,102,SAN CRISTOBAL DE LAS CASAS,1100,C1,100,100,20,250,500\n"
    "7,CHIAPAS,2,103,TAPACHULA,1200,B,300,300,200,850,700\n"
    "0,EXTRANJERO,0,0,EXTRANJERO,0,EXT,50,30,10,100,200\n"
    "7,CHIAPAS,1,101,TOTAL MUNICIPIO,0,TOTAL,200,200,90,570,1000\n"
)
path_2021 = fixtures_dir / "DIP_FED_2021.csv"
path_2021.write_bytes(b"\xef\xbb\xbf" + content_2021.encode("utf-8"))

# 2. DIP_FED_2018.txt: CP1252, pipe delimiter, municipality level, MUNICIPIO numeric
content_2018 = (
    "ESTADO|MUNICIPIO|NOMBRE_MUNICIPIO|LISTA_NOMINAL|TOTAL_VOTOS\n"
    "15|10|AMECAMECA|40000|25000\n"
    "15|20|ATLACOMULCO|60000|39000\n"
    "15|30|TOLUCA|120000|75000\n"
    "15|999|TOTAL ESTADO|220000|139000\n"
)
path_2018 = fixtures_dir / "DIP_FED_2018.txt"
path_2018.write_bytes(content_2018.encode("cp1252"))

if __name__ == "__main__":
    print("INE test fixtures generated.")
