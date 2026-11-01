# Atalaya Electoral — Riesgo de abstención en México

> **Hackathon INE 2026 «Hackea la participación: Datos que construyen democracia» · Reto 2: Predicción y escenarios de riesgo de abstención** · equipo OXENT
> **Tablero público:** [http://46.250.172.193:8080](http://46.250.172.193:8080) (requiere usuario y contraseña)
> **Documento técnico y fuente de verdad:** [explanation.md](explanation.md) — qué hace cada funcionalidad y en qué módulo vive.

---

## 1. Qué es

Atalaya Electoral responde la pregunta guía del reto —*¿qué zonas podrían presentar mayor abstención en 2027 si no se interviene?*— con
datos agregados y sin datos personales, para que el INE planee y priorice recursos rumbo a la elección federal del **6 de junio de 2027**.

| Funcionalidad | Qué hace |
|---|---|
| **Pronóstico y semáforo** | Pronostica la abstención de los **2,478 municipios** y 32 estados y los clasifica en 🟢 🟡 🟠 🔴 combinando abstención esperada, vulnerabilidad sociodemográfica, tendencia y volatilidad. Modelo transparente elegido por *backtest* honesto (2021 y 2024). |
| **Mapa navegable** | País → estado → municipio con MapLibre GL (teselas vectoriales oficiales INEGI), modos Semáforo, Cambio Δ, Comparar (cortina) y 3D. Funciona en celular, tablet y PC. |
| **Escenarios** | Base (sin intervención), **Intervención** con hasta 4 campañas combinadas (voto joven, casillas rurales, lenguas indígenas, campaña general; país o estados) y Pesimista. Votos ganados o perdidos frente a la base. |
| **Priorización y recomendaciones** | Abstención esperada en personas, ranking de zonas prioritarias y recomendaciones preventivas por zona. |
| **«¿Por qué este color?»** | Explicación para quien no es estadístico: componentes del índice, qué grupos votan menos (dato medido), rasgos asociados (relación, no causa) y contexto, cada razón con su **tipo y fuerza de evidencia**. |
| **Asistente** | Preguntas en lenguaje natural sobre los datos (GLM-5.3 en Huawei MaaS) con cifras siempre tomadas de los datos y *guardrails* (solo participación y abstención, sin datos personales ni temas partidistas). |
| **Plan de campaña con IA** | Para un estado o municipio: investigación en fuentes públicas verificables (Gemini), plan redactado por GLM-5.3, impacto calculado por el simulador y 10 diapositivas editables exportables a PPTX y PDF. |
| **Monitor INE** | Detecta noticias desfavorables y rumores sobre el INE, los clasifica, estima su efecto en la participación con un modelo determinista, mide su difusión y propone remediación. Solo enlaza publicaciones en redes **cuya URL aparece en una nota descargada por la app**. |
| **Guías interactivas** | Cada sección (Mapa, Plan de campaña, Monitor INE) tiene su recorrido guiado; además, cada concepto lleva una ayuda ⓘ de un glosario único. |
| **Entregables del reto** | Reporte metodológico (PDF, 15 cuartillas), presentación ejecutiva (10 diapositivas), mapa de escenarios (GeoJSON + visor HTML autónomo), base de datos anonimizada (XLSX/CSV) y paquete de entrega verificado contra la convocatoria. |

**Principios:** solo datos agregados; celdas con menos de 10 personas suprimidas; **la IA nunca escribe cifras** (todo número sale de
modelos deterministas con supuestos explícitos); todo flujo con IA tiene respaldo determinista; los escenarios son hipotéticos, no efectos
causales.

---

## 2. Arquitectura en una mirada

```
data/raw (INE CCPC 2009–2024 + judicial 2025, INEGI ITER 2020, CONAPO IMM 2020, INEGI MG 2024)
   └─► backend/atalaya/ingest ─► model (pronóstico, semáforo, escenarios, recomendaciones) ─► data/build/*.parquet
                                                                   │
        OpenSearch (Huawei CSS) o memoria ◄── store ◄──────────────┘
                     │
FastAPI :8001  (/api: riesgo, escenarios, región, explicador, asistente SSE, inteligencia, sesión)
   ├─ GLM-5.3 (MaaS)  redacta     ├─ Gemini 3.8 → 3.6 → 3.5 Flash  investiga     └─ Google News / Bing RSS + páginas descargadas
Next.js 16 :3000  (mapa MapLibre, panel, asistente, Plan de campaña, Monitor INE, Metodología)
Caddy :8080 (borde público) + supervisor + vigilante
```

| Capa | Tecnología |
|---|---|
| Datos y modelo | Python 3.12, pandas, numpy |
| API | FastAPI + SSE, inicio de sesión propio (scrypt, cookie de sesión, protección contra fuerza bruta) |
| Búsqueda | OpenSearch 3.x en Huawei CSS con respaldo automático a memoria |
| IA | GLM-5.3 (Huawei MaaS) para redactar; Gemini Flash (Google AI Studio) para investigar |
| Frontend | Next.js 16, React 19, Tailwind 4, MapLibre GL 5 |
| Publicación | Caddy 2.11, supervisor en Python, tareas programadas de Windows |

---

## 3. Requisitos

- **Windows** 10/11 o Windows Server, PowerShell 5.1+.
- **Python 3.12** (64 bits), **Node.js 20+** y npm 10+.
- **Google Chrome o Microsoft Edge** (PDF del reporte, presentación y exportación de planes de campaña).
- Opcional: clúster OpenSearch 3.x (Huawei CSS), llave de Huawei MaaS (GLM-5.3) y llave de Google AI Studio (Gemini). Sin ellas la app
  funciona con almacén en memoria y respuestas deterministas.

---

## 4. Datos (descargas oficiales en `data/raw/`)

| Fuente | Archivos | Carpeta |
|---|---|---|
| INE · Conteos Censales de Participación Ciudadana | `DatosAbiertos_DECEyEC_ConteosCensales{2009,2012,2015,2018,2021,2024}.zip` y `…ConteosCensalesPJ2025.zip` ([INE datos abiertos](https://ine.mx/transparencia/datos-abiertos/visualizacion-datos/conteos-censales-participacion/)) | `data/raw/ccpc/` |
| INEGI · Censo 2020, resultados por localidad (ITER) | `iter_00_cpv2020_csv.zip` ([INEGI](https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos)) | `data/raw/inegi/` |
| CONAPO · Índice de marginación municipal 2020 | `IMM_2020.csv` ([datos.gob.mx](https://datos.gob.mx/busca/dataset/indice-de-marginacion-a-nivel-municipio-y-entidad-federativa-2020)) | `data/raw/conapo/` |
| INEGI · Marco Geoestadístico 2024 | `00ent.*`, `00mun.*` ([INEGI](https://www.inegi.org.mx/temas/mg/)) | `data/raw/geo/` |

---

## 5. Instalación

```powershell
python -m venv .venv; .venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
cd frontend; npm ci; cd ..
cd tools/geo; npm ci; cd ..\..
copy backend\.env.example backend\.env     # y completa las llaves que tengas (sección 9)
```

---

## 6. Construir datos, modelo y entregables

```powershell
# Pipeline completo: geografía → CCPC → INEGI/CONAPO → crosswalk → modelo → exportación → reporte y presentación
powershell -ExecutionPolicy Bypass -File scripts\build_all.ps1 [-SkipGeo] [-SkipModel] [-SkipExport] [-SkipReports] [-Load]

# Visor autónomo y paquete de entrega del Reto 2 (verifica la convocatoria)
cd backend; python -m atalaya.viewer; python -m atalaya.submission
```

`-Load` carga el clúster OpenSearch (o usa `python scripts\bootstrap_cluster.py [--reset]` desde `backend`).

---

## 7. Usuarios

Toda la app requiere inicio de sesión. Las cuentas se crean en el servidor con la CLI (la contraseña se imprime una sola vez):

```powershell
cd backend
python -m atalaya.auth create-user <usuario> --generate
python -m atalaya.auth list | unlock <usuario|ip> | reset-password <usuario> --generate | disable <usuario> | enable <usuario>
```

---

## 8. Ejecutar

**Local (demo):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start_demo.ps1     # API :8001 + web :3000 (-Mock: solo frontend con datos de demostración)
powershell -ExecutionPolicy Bypass -File scripts\stop_demo.ps1
```

**Publicación en internet (CMD como administrador, en la raíz del repo):**

```cmd
deploy.cmd                 :: instala servicio "ATALAYA" + vigilante "ATALAYA-Watchdog" y publica en http://<IP>:8080
deploy.cmd rebuild         :: tras actualizar el código
deploy.cmd status | stop | start | restart | logs | uninstall
```

Abre TCP 8080 de entrada en el *security group*. En la ECS del proyecto el puerto 80 pertenece a otra aplicación: no lo uses. Caddy
bloquea `/api/admin*` desde internet y fija la IP real del cliente; el supervisor reinicia cualquier servicio caído y el vigilante
recupera la pila completa.

---

## 9. Configuración (`backend/.env`)

| Variable | Uso |
|---|---|
| `OPENSEARCH_URL`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`, `OPENSEARCH_VERIFY_CERTS`, `OPENSEARCH_CA_CERTS`, `OPENSEARCH_TIMEOUT_S`, `OPENSEARCH_REPLICAS` | Clúster OpenSearch (opcional) |
| `ATALAYA_STORE` | `auto` \| `opensearch` \| `memory` |
| `MAAS_BASE_URL`, `MAAS_API_KEY`, `MAAS_MODEL=glm-5.3`, `MAAS_REASONING_EFFORT=high` | Asistente y redacción (Huawei MaaS) |
| `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.8-flash`, `GEMINI_FALLBACK_MODELS`, `GEMINI_MODEL_TIMEOUTS` | Investigación (Google AI Studio). Sin facturación no hay búsqueda de Google: se usa la búsqueda de respaldo verificada |
| `INTEL_GEMINI_DAILY_LIMIT`, `INTEL_MONITOR_COOLDOWN_MIN`, `INTEL_CAMPAIGN_TTL_H`, `INTEL_MONITOR_TTL_H` | Presupuesto y cachés de Inteligencia |
| `ATALAYA_CHAT_RATE_PER_MIN`, `ATALAYA_CHAT_RATE_PER_DAY` | Límite del asistente por IP |
| `ATALAYA_LLM_ENABLED`, `ATALAYA_TARGET_YEAR=2027`, `ATALAYA_PUBLIC_URL` | Generales |

Nunca subas `backend/.env` al repositorio. Lista completa y valores por omisión en [explanation.md §5](explanation.md).

---

## 10. Pruebas

```powershell
cd backend;  python -m pytest -q -p no:cacheprovider        # sin red: Gemini, MaaS y RSS simulados
cd frontend; npm run typecheck; npm test; npm run build      # Vitest + TypeScript + build de producción (verifica tipos de páginas)
cd tools/geo; npm test
```

---

## 11. Estructura

```text
backend/atalaya/   ingest · model · store · api · chat (guardrails) · explain (explicador y verificación) · intel (campañas, monitor,
                   enlaces a redes) · report · export · viewer · submission · auth · ops (supervisor)
backend/tests/     pruebas offline
frontend/src/      app (mapa, campanas, monitor, metodologia, login) · components (map, panel, explain, guide, intel, layout, ui) · lib
tools/geo/         geografía y teselas vectoriales
data/seed/         catálogos y reglas curadas        data/raw · data/build · data/cache   (no versionados)
scripts/           build_all · start_demo · stop_demo · serve_public · get_caddy        deploy.cmd   despliegue en un comando
deliverables/      entregables generados (no versionados)
```

---

## 12. Privacidad y neutralidad

- Solo información **agregada**: ningún nombre, domicilio, CURP ni clave de elector.
- Celdas edad × sexo con lista nominal < 10 suprimidas; sexo no binario solo a nivel estatal y nacional.
- Sin análisis de partidos, candidaturas ni intención de voto; las campañas se dirigen solo por criterios territoriales y de riesgo.
- De las publicaciones en redes solo se guarda el enlace público y el *handle* que aparece en él, para poder reportarlas.

## 13. Fuentes

Instituto Nacional Electoral (Conteos Censales de Participación Ciudadana 2009–2024 y Elección Judicial 2025), INEGI (Censo 2020 ITER y
Marco Geoestadístico 2024) y CONAPO (Índice de Marginación 2020). Todas públicas y abiertas.

**Hackathon INE 2026** · Propuesta del equipo OXENT.
