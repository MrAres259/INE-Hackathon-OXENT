# ATALAYA — Riesgo y Escenarios de Abstención Electoral en México

> **INE Hackathon · Reto 2: Predicción y escenarios de riesgo de abstención**  
> Documento técnico completo y arquitectura en [explanation.md](explanation.md).

---

## 1. Qué es ATALAYA

**ATALAYA** es una plataforma de analítica predictiva y visualización estratégica diseñada para que el Instituto Nacional Electoral (INE) identifique de manera anticipada los municipios y entidades con mayor propensión a la abstención en las elecciones federales de **2027** (diputaciones federales).

A partir de los microdatos de la **Plataforma de Conteos Censales de Participación Ciudadana (CCPC) 2009–2024** y la **Elección Judicial 2025**, combinados con indicadores sociodemográficos del **INEGI Censo 2020** y del **Índice de Marginación CONAPO 2020**, ATALAYA:

1. **Pronostica** la participación y abstención de los 2,478 municipios del Marco Geoestadístico 2024 mediante un modelo transparente de persistencia relativa con selección honesta entre candidatos y backtest en los cortes electorales 2021 y 2024.
2. **Clasifica** cada zona territorial en un semáforo de riesgo de cuatro niveles (🟢 Verde, 🟡 Amarillo, 🟠 Naranja, 🔴 Rojo) ponderando abstención esperada, vulnerabilidad sociodemográfica estructural, tendencia histórica y volatilidad electoral.
3. **Prioriza recursos** calculando el volumen estimado de personas que no acudirían a las urnas (`abstencion_esperada = pred_abstention × lista_nominal`) y ordenando los municipios de atención prioritaria (rojo/naranja).
4. **Simula escenarios interactivos**: escenario base (*sin intervención*), escenario *con intervención focalizada* (por nivel de riesgo, grupo prioritario e impacto parametrizable) y escenario *pesimista*.
5. **Genera recomendaciones preventivas específicas** basadas en los factores estructurales y demográficos que más empujan el abstencionismo en cada territorio.
6. **Integra un asistente conversacional híbrido**: interpreta preguntas en lenguaje natural, ejecuta consultas deterministas sobre los datos oficiales (vía Elasticsearch / Huawei CSS o almacén en memoria) y redacta respuestas auditables citando fuentes y año, respaldado por un LLM (GLM-5.2) o mediante generación determinista sin conexión.

---

## 2. Requisitos del sistema

- **Python**: 3.12 (64-bit)
- **Node.js**: 20+ LTS y npm 10+
- **Google Chrome** (o **Microsoft Edge**): Instalado en el sistema para la compilación headless de reportes y diapositivas en PDF (`--headless=new`).
- **Sistema Operativo**: Windows Server / Windows 10/11 (PowerShell 5.1 o PowerShell Core).

---

## 3. Cómo obtener los datos (Descargas oficiales)

Para reproducir el pipeline completo desde las fuentes primarias oficiales, descargue los siguientes conjuntos de datos abiertos y colóquelos en sus respectivas carpetas bajo `data/raw/`:

| Fuente | Conjunto de datos / Archivos | URL oficial de descarga | Carpeta destino |
|---|---|---|---|
| **INE CCPC** | Conteos Censales de Participación Ciudadana 2009–2024 (6 archivos zip, uno por elección federal): `DatosAbiertos_DECEyEC_ConteosCensales{2009,2012,2015,2018,2021,2024}.zip` | [INE CCPC Datos Abiertos](https://ine.mx/transparencia/datos-abiertos/visualizacion-datos/conteos-censales-participacion/) | `data/raw/ccpc/` |
| **INE CCPC** | Conteos Censales Elección Judicial Extraordinaria 2025: `DatosAbiertos_DECEyEC_ConteosCensalesPJ2025.zip` | [INE CCPC Datos Abiertos](https://ine.mx/transparencia/datos-abiertos/visualizacion-datos/conteos-censales-participacion/) | `data/raw/ccpc/` |
| **INEGI Censo 2020** | Censo de Población y Vivienda 2020, Principales resultados por localidad (ITER): `iter_00_cpv2020_csv.zip` | [INEGI Censo 2020 Datos Abiertos](https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos) | `data/raw/inegi/` |
| **CONAPO** | Índice de Marginación a nivel municipal 2020: `IMM_2020.csv` | [Datos Abiertos México (datos.gob.mx)](https://datos.gob.mx/busca/dataset/indice-de-marginacion-a-nivel-municipio-y-entidad-federativa-2020) | `data/raw/conapo/` |
| **INEGI Marco Geo** | Marco Geoestadístico 2024: capas vectoriales nacionales `00ent.*` y `00mun.*` (`.shp, .shx, .dbf, .prj, .cpg`) | [INEGI Marco Geoestadístico](https://www.inegi.org.mx/temas/mg/) | `data/raw/geo/` |

---

## 4. Estructura del repositorio

```text
├── backend/
│   ├── atalaya/
│   │   ├── api/          # Endpoints FastAPI, esquemas Pydantic y dependencias
│   │   ├── chat/         # Asistente conversacional (guard, planner, executor, writer)
│   │   ├── ingest/       # Ingesta y normalización (CCPC, ITER, CONAPO, crosswalk)
│   │   ├── model/        # Modelado predictivo, semáforo de riesgo, escenarios y recomendaciones
│   │   ├── report/       # Generación de gráficas SVG y renderizado de PDF
│   │   ├── privacy.py    # Control estadístico de revelación y supresión de celdas pequeñas
│   │   └── store.py      # Almacén de datos (PandasStore offline y EsStore clúster CSS)
│   ├── tests/            # Batería de pruebas unitarias y de integración
│   └── requirements.txt  # Dependencias de Python
├── frontend/
│   ├── src/              # Aplicación web Next.js 16 + React 19 + Tailwind CSS 4
│   └── package.json
├── tools/geo/            # Pipeline de simplificación cartográfica con mapshaper
├── scripts/
│   ├── build_all.ps1     # Orquestador del pipeline completo de datos y modelos
│   ├── start_demo.ps1    # Lanzador de la demo local (backend :8001 + frontend :3000)
│   └── stop_demo.ps1     # Detención de procesos de la demo
├── data/
│   ├── raw/              # Descargas oficiales primarias
│   ├── seed/             # Catálogos curados (estados, variables, recomendaciones)
│   └── build/            # Tablas intermedias Parquet, índices y métricas compiladas
├── deliverables/         # Entregables oficiales del Reto 2 (PDF, CSV, XLSX, GeoJSON)
├── explanation.md        # Documentación metodológica y técnica detallada
└── README.md             # Esta guía rápida de instalación y ejecución
```

---

## 5. Instalación

1. **Entorno Python**:
   ```powershell
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r backend/requirements.txt
   ```

2. **Entorno Frontend**:
   ```powershell
   cd frontend
   npm ci
   cd ..
   ```

3. **Entorno Cartográfico**:
   ```powershell
   cd tools/geo
   npm ci
   cd ..\..
   ```

---

## 6. Pipeline de datos y modelos

Para compilar todo el conocimiento, capas geográficas, perfiles sociodemográficos, entrenamiento del modelo predictivo y generación de entregables, ejecute:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build_all.ps1
```

Opciones disponibles en el script:
- `-SkipGeo`: Omite el procesamiento de capas cartográficas si ya están simplificadas en `frontend/public/geo/`.
- `-SkipModel`: Omite el re-entrenamiento del modelo estadístico.
- `-SkipExport`: Omite la exportación de bases de datos finales y archivos shapefile.
- `-Load`: Si se dispone de conectividad al clúster Huawei CSS / Elasticsearch, valida y carga los índices.

---

## 7. Ejecución de la demo

Inicie la aplicación completa (backend FastAPI en puerto `8001` y frontend Next.js en puerto `3000`):

```powershell
# Iniciar con los datos compilados reales:
powershell -ExecutionPolicy Bypass -File scripts\start_demo.ps1

# O iniciar en modo demostración con datos sintéticos:
powershell -ExecutionPolicy Bypass -File scripts\start_demo.ps1 -Mock
```

- **Frontend (Tablero interactivo)**: [http://localhost:3000](http://localhost:3000)
- **Backend API (Documentación Swagger/OpenAPI)**: [http://localhost:8001/docs](http://localhost:8001/docs)

Para detener los servidores en segundo plano al terminar:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop_demo.ps1
```

---

## 8. Pruebas automatizadas

Ejecución de la suite completa de pruebas unitarias y de integración del backend:

```powershell
cd backend
python -m pytest tests/ -q -p no:cacheprovider
```

Verificación del frontend:
```powershell
cd frontend
npm test            # Pruebas con Vitest
npm run typecheck   # Comprobación de tipos con TypeScript
```

---

## 9. Entregables generados (`deliverables/`)

La carpeta `deliverables/` contiene los artefactos oficiales requeridos por el Reto 2:

1. **Reporte Metodológico y Preventivo (PDF)**: Documento de 10 a 15 cuartillas con fundamentación estadística, auditoría del modelo, análisis del semáforo territorial 2027 y plan de intervención focalizada.
2. **Presentación Ejecutiva (PDF)**: Síntesis de alto nivel en 10 diapositivas para toma de decisiones y planeación estratégica institucional.
3. **Base de Datos Territorial Anonimizada**: Archivos `atalaya_riesgo_2027.csv` y `atalaya_riesgo_2027.xlsx` con los 2,478 municipios y 32 entidades federativas, conteniendo pronóstico, semáforo, componentes de riesgo, factores estructurales y priorización de recursos.
4. **Capas Cartográficas**: Archivos GeoJSON y Shapefile con la cartografía nacional y los escenarios de riesgo asociados a cada polígono territorial.

---

## 10. Configuración (`.env`)

Las variables de configuración se gestionan mediante el archivo `backend/.env` (tome como referencia `backend/.env.example`):

| Variable | Descripción |
|---|---|
| `ES_URL` | URL del clúster Elasticsearch / Huawei Cloud CSS. |
| `ES_USERNAME` | Usuario para autenticación básica en el clúster. |
| `ES_PASSWORD` | Contraseña del clúster Elasticsearch. |
| `ES_INSECURE` | Permite deshabilitar la verificación estricta SSL en entornos de prueba. |
| `ES_TIMEOUT_S` | Tiempo límite de espera para consultas al clúster (segundos). |
| `MAAS_BASE_URL` | Endpoint del servicio ModelArts MaaS (Huawei Cloud). |
| `MAAS_API_KEY` | Clave de acceso a la API del modelo de lenguaje. |
| `MAAS_MODEL` | Modelo LLM configurado (ej. `glm-5.2`). |
| `MAAS_EXTRA_BODY` | Parámetros adicionales en formato JSON para el proveedor LLM. |
| `ATALAYA_INDEX_PREFIX` | Prefijo para los índices creados en Elasticsearch (default `atalaya-`). |
| `ATALAYA_STORE` | Modo del almacén de datos: `auto`, `memory` o `es`. |
| `ATALAYA_LLM_ENABLED` | Habilita (`1`) o deshabilita (`0`) la consulta al LLM en el asistente. |
| `ATALAYA_TARGET_YEAR` | Año electoral federal objetivo de planeación (`2027`). |

---

## 11. Política de privacidad y control estadístico de revelación

ATALAYA está diseñado bajo principios estrictos de **confidencialidad estadística y privacidad por diseño**:

- **Cero datos personales nominativos**: No se recopila, almacena ni procesa ningún dato de identificación individual, nombres, domicilios, CURP ni claves de elector.
- **Supresión de celdas pequeñas (k-anonimato / thresholding)**: Para evitar cualquier riesgo de re-identificación indirecta en municipios de baja densidad demográfica, toda celda demográfica (edad × sexo × municipio) con una Lista Nominal menor a 10 personas (`LN < 10`) tiene sus conteos y tasas suprimidos (retornando `null` en API y `N/D` en interfaz/chat, con marca explícita `suprimido: true`).
- **Protección de género no binario**: Los registros de género no binario (`sexo = "X"`), incorporados en el CCPC 2024, se publican exclusivamente a nivel agregado estatal y nacional. Para salvaguardar la privacidad individual, se descartan a nivel municipal.
- **Agregación territorial canónica**: Toda la información analítica se consolida exclusivamente a nivel de sección, municipio o entidad federativa.

---

## 12. Licencia de datos públicos y créditos

El desarrollo de ATALAYA utiliza exclusivamente fuentes abiertas de carácter público gubernamental:
- **Instituto Nacional Electoral (INE)**: Plataforma de Conteos Censales de Participación Ciudadana (CCPC 2009–2024), Elección Judicial Extraordinaria 2025 y Sistema de Consulta de la Estadística de las Elecciones (SICEE).
- **Instituto Nacional de Estadística y Geografía (INEGI)**: Censo de Población y Vivienda 2020 (ITER) y Marco Geoestadístico Nacional 2024.
- **Consejo Nacional de Población (CONAPO)**: Índice de Marginación por Municipio 2020.

**INE Hackathon 2026** · Proyecto de analítica predictiva para la participación ciudadana y fortalecimiento democrático.
