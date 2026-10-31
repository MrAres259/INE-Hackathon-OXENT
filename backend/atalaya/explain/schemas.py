"""CONTRATO — ola "Cambios mayores" (explicación de zonas). Copiar TAL CUAL a backend/atalaya/explain/schemas.py.

Nadie lo modifica salvo el arquitecto. Espejo TS: temp/cambios-mayores/contract/explain_types.ts.
Todo texto (title, body, headline, ...) en español de México, lenguaje llano, sin jerga estadística.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Level = Literal["state", "mun"]

# Qué tan sólida es la evidencia (se muestra como etiqueta al usuario).
Strength = Literal["fuerte", "moderada", "debil"]

# Tipo de evidencia (jerarquía científica, de más a menos sólida):
#   dato_medido          -> conteos oficiales INE CCPC (quién votó y quién no). No es modelo.
#   calculo_del_modelo   -> sale del pronóstico/semáforo de Atalaya (persistencia histórica, tendencia, volatilidad).
#   asociacion           -> correlación nacional entre una característica y la abstención. NO prueba causa.
#   contexto_descriptivo -> dato del Censo 2020 que ayuda a entender (p. ej. migración); no está en el índice.
EvidenceType = Literal["dato_medido", "calculo_del_modelo", "asociacion", "contexto_descriptivo"]

ReasonKind = Literal[
    "semaforo",          # por qué tiene ese color (descomposición exacta del índice)
    "historial",         # cuántas elecciones votó menos que el promedio (persistencia; base del pronóstico)
    "quien_no_vota",     # grupos de edad/sexo que concentran la abstención (CCPC)
    "urbano_rural",      # participación en secciones urbanas vs rurales (CCPC por sección)
    "tendencia",         # viene bajando o subiendo
    "volatilidad",       # cambia mucho entre elecciones (difícil de anticipar)
    "perfil_territorial",# asociación de una característica sociodemográfica (solo si pasa umbrales, ver 00-CONTEXT §5.6)
    "contexto",          # migración / movilidad (Censo 2020), descriptivo
    "confiabilidad",     # advertencia: datos incompletos (NS alto, pocos años confiables, municipio nuevo)
]

Direction = Literal["sube_abstencion", "baja_abstencion", "neutral"]


class ExplainNumber(BaseModel):
    key: str                      # "pred_abstention", "years_below", ...
    label: str                    # "Abstención esperada 2027"
    value: float | None
    unit: Literal["pct", "pp", "personas", "elecciones", "indice", "ratio"]
    display: str                  # ya formateado es-MX: "52.1 %", "5 de 6", "−3.2 puntos"


class ExplainReason(BaseModel):
    id: str                       # "r1", "r2", ... en orden de importancia
    kind: ReasonKind
    title: str = Field(max_length=110)   # frase corta y llana: "Aquí casi siempre se vota menos que en el resto del país"
    body: str = Field(max_length=420)    # 1–2 frases con las cifras (las mismas de `numbers`)
    strength: Strength
    evidence_type: EvidenceType
    direction: Direction = "neutral"
    numbers: list[ExplainNumber] = []
    source: str                   # "INE · Conteos Censales de Participación 2009–2024"


class ScoreComponent(BaseModel):
    key: Literal["abs", "vuln", "trend", "vol"]
    label: str                    # "Abstención esperada", "Perfil de la zona", "Tendencia", "Volatilidad"
    weight: float                 # 0.50 / 0.20 / 0.15 / 0.15 (de model/risk.py)
    rank_pct: float               # r_* · 100 (0–100): "más alto que el X % de las zonas"
    points: float                 # weight · r_* · 100 ; la suma de los 4 = risk_score (± 0.2)
    plain: str                    # "Pesa 39 de los 59.5 puntos: se espera más abstención que en el 78 % de los estados"


class GroupGap(BaseModel):
    group: str                    # "18–24 años", "Mujeres", "Hombres", "Secciones rurales"
    participation_pct: float | None   # votó el X % (SV/(SV+NV)·100)
    share_ln_pct: float | None        # % de la lista nominal de la zona
    share_abstainers_pct: float | None# % de quienes no votaron
    suppressed: bool = False          # celda protegida (LN < 10) -> cifras None


class Recommendation(BaseModel):
    title: str
    rationale: str
    priority: Literal["alta", "media", "baja"] = "media"


SuggestedIntent = Literal["explain_unit", "profile", "trend", "compare", "context_news", "recommend"]


class SuggestedQuestion(BaseModel):
    id: str                       # "q1"...
    text: str                     # pregunta lista para mandarse al asistente (incluye el nombre de la zona)
    intent_hint: SuggestedIntent


class Explanation(BaseModel):
    unit_id: str
    level: Level
    name: str
    state_name: str | None = None         # solo municipios
    category: str                          # rojo|naranja|amarillo|verde|sin_dato (escenario base)
    risk_score: float | None
    pred_abstention_pct: float | None      # abstención esperada 2027 sin intervención, 0–100
    headline: str = Field(max_length=260)  # 1 frase: "Quintana Roo está en naranja sobre todo porque ..."
    in_short: list[str] = []               # 2–3 viñetas "En pocas palabras"
    reasons: list[ExplainReason] = []      # 3–7, ordenadas por importancia; la primera siempre kind="semaforo"
    score_breakdown: list[ScoreComponent] = []   # exactamente 4 cuando hay risk_score
    groups: list[GroupGap] = []            # hasta 4 grupos (edad y sexo) del último año federal confiable
    what_we_dont_know: list[str] = []      # 2–4 límites honestos (asociación ≠ causa, error típico, datos faltantes)
    confidence: Literal["alta", "media", "baja"] = "media"
    confidence_note: str = ""              # por qué esa confianza, en lenguaje llano
    recommendations: list[Recommendation] = []   # máx. 3, de model/recommend.py
    suggested_questions: list[SuggestedQuestion] = []  # 4–6
    sources: list[str] = []
    data_year: int | None = None           # último año federal usado (2024)
    scenario_note: str = "La explicación describe el escenario sin intervención (base)."
    generated_at: str                      # ISO datetime


# ------------------------------------------------------------------ contexto público (Gemini)

Verification = Literal["cita_verificada", "fuente_verificada", "sin_verificar"]


class ContextSource(BaseModel):
    url: str
    title: str = ""
    domain: str = ""
    outlet: str | None = None
    tier: str = "no_reconocido"            # mismo vocabulario que intel.schemas.SourceTier
    published: str | None = None


class ContextFinding(BaseModel):
    id: str                                # "f1"...
    title: str
    summary: str                           # <= 60 palabras
    category: str                          # intel.schemas.FindingCategory
    category_label: str                    # "Inseguridad y violencia", ...
    scope: Literal["municipio", "estado", "nacional"] = "estado"
    verification: Verification
    quote: str | None = None               # cita textual (<= 40 palabras) hallada en la página de la fuente
    sources: list[ContextSource] = []


class ContextResult(BaseModel):
    unit_id: str
    name: str
    level: Level
    findings: list[ContextFinding] = []
    search_mode: Literal["grounding", "respaldo", "sin_internet"] = "respaldo"
    model: str = ""
    generated_at: str
    from_cache: bool = False
    degraded: bool = False
    note: str | None = None                # en español cuando degraded o sin hallazgos
    disclaimer: str = (
        "Contexto público reciente: ayuda a entender la zona, pero el modelo no lo mide "
        "y una noticia no prueba que sea la causa de la abstención."
    )
