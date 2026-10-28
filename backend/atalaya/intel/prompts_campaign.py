"""Prompts and prompt builders for Campaign Planning pipeline (Gemini research & GLM plan).

Follows INE institutional neutrality guidelines (§0.13):
- Impartial, objective, non-partisan, no references to political parties or candidacies.
- Aggregated socio-demographic and operational data only.
- Output in strictly formatted JSON.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from atalaya.intel.schemas import DataSnapshot, ResearchBundle

CAMPAIGN_RESEARCH_SYSTEM_PROMPT = """Eres un investigador electoral neutral para el Instituto Nacional Electoral (INE) de México.
Tu objetivo es investigar en fuentes documentadas y verificables por qué el electorado se abstiene de votar en una demarcación territorial específica (municipio o estado).

REGLAS INSTITUCIONALES OBLIGATORIAS:
1. Imparcialidad y neutralidad absoluta: queda estrictamente prohibido mencionar partidos políticos, candidatos, alianzas electorales, nombres de servidores públicos o preferencias partidistas.
2. No perfiles personas ni grupos individuales: enfócate únicamente en factores agregados sociodemográficos, geográficos, logísticos, cívicos y comunitarios.
3. Temporalidad: enfócate en causas documentadas durante los últimos 6 años (2018 a la fecha).
4. Fuentes permitidas: exclusivamente fuentes verificables (INE, OPLEs locales, INEGI, universidades y centros académicos, centros de investigación, medios de comunicación reconocidos nacionales o regionales, y verificadores oficiales).
5. Fuentes prohibidas: no cites redes sociales (X, Facebook, TikTok, Instagram, etc.), blogs anónimos, comunicados partidistas ni foros.
6. Si no existe información a nivel municipal sobre un factor, puedes usar evidencia a nivel estatal o regional especificando el ámbito ('scope').

CATEGORÍAS DE HALLAZGOS PERMITIDAS:
- desconfianza_institucional
- inseguridad_violencia
- acceso_casillas_distancia
- desinformacion
- apatia_desafeccion
- barreras_documentales_credencial
- migracion_movilidad
- exclusion_linguistica_cultural
- condiciones_socioeconomicas
- otra

FORMATO DE RESPUESTA:
Devuelve ÚNICAMENTE un objeto JSON válido con la clave 'findings' (máximo 6 hallazgos), con la siguiente estructura:
{
  "findings": [
    {
      "title": "Título conciso y descriptivo del hallazgo (máx 15 palabras)",
      "summary": "Resumen conciso del hallazgo basado en evidencia documentada (máx 60 palabras, en español formal).",
      "category": "categoria_de_la_lista_permitida",
      "sources": [
        {
          "url": "https://url-de-la-fuente-verificable",
          "title": "Nombre de la publicación o artículo",
          "published": "YYYY-MM-DD"
        }
      ],
      "scope": "municipio" | "estado" | "nacional",
      "confidence": "alta" | "media" | "baja"
    }
  ]
}
No incluyas explicaciones ni texto fuera del bloque JSON.
"""


def build_research_prompt(snapshot: DataSnapshot, focus: str | None = None) -> tuple[str, str]:
    """Builds (system_prompt, user_prompt) for Gemini Grounded Search."""
    if snapshot.level == "mun":
        geo_desc = f"Municipio: {snapshot.name}, Estado: {snapshot.ent_name} (clave geográfica: {snapshot.unit_id})"
    else:
        geo_desc = f"Estado: {snapshot.name} (clave geográfica: {snapshot.unit_id})"

    focus_desc = f"\nEnfoque prioritario solicitado por el operador: {focus}" if focus else ""

    # Prepare data hints as hypotheses to contrast
    hints = []
    if snapshot.pred_abstention is not None:
        hints.append(f"- Abstención estimada en el modelo Atalaya: {snapshot.pred_abstention * 100:.1f}% (categoría de riesgo: {snapshot.category})")
    if snapshot.trend_pp is not None:
        hints.append(f"- Tendencia histórica de participación: {snapshot.trend_pp:+.1f} puntos porcentuales")
    if snapshot.gap_youth_pp_last is not None:
        hints.append(f"- Brecha de participación juvenil (18-34 vs general): {snapshot.gap_youth_pp_last:+.1f} pp")
    if snapshot.pct_rural is not None:
        hints.append(f"- Proporción de población rural: {snapshot.pct_rural:.1f}%")
    if snapshot.pct_hli is not None:
        hints.append(f"- Población hablante de lengua indígena: {snapshot.pct_hli:.1f}%")
    if snapshot.pct_18_24 is not None:
        hints.append(f"- Proporción de jóvenes de 18 a 24 años: {snapshot.pct_18_24:.1f}%")
    if snapshot.drivers:
        top_d = ", ".join(f"{d.label} ({d.contribution_pp:+.1f} pp)" for d in snapshot.drivers[:3])
        hints.append(f"- Factores sociodemográficos clave: {top_d}")

    hints_text = "\n".join(hints) if hints else "No hay indicadores adicionales."

    user_prompt = f"""Investiga en fuentes verificables mexicanas las causas documentadas de abstención y baja participación electoral en la siguiente demarcación:

Demarcación: {geo_desc}{focus_desc}

Indicios y contexto de datos de Atalaya Electoral (utilízalos como hipótesis a contrastar con evidencia documental, nunca como hechos consumados a citar):
{hints_text}

Instrucciones:
1. Realiza búsquedas de reportes, diagnósticos del INE/OPLE, notas periodísticas de medios reconocidos, estudios académicos (INEGI, COLMEX, UNAM, CIDE, UAM, etc.).
2. Identifica entre 2 y 6 hallazgos concretos con sus respectivas fuentes de enlace directo.
3. Si existe un enfoque temático solicitado, prioriza hallazgos relacionados a dicho enfoque sin omitir otros factores críticos si la evidencia los respalda.
4. Devuelve únicamente el objeto JSON solicitado sin texto adicional.
"""
    return CAMPAIGN_RESEARCH_SYSTEM_PROMPT, user_prompt


CAMPAIGN_PLANNER_SYSTEM_PROMPT = """Eres un especialista en diseño de estrategias de participación ciudadana y educación cívica para el Instituto Nacional Electoral (INE) de México.
Tu tarea es formular un Plan de Campaña de Participación Ciudadana institucional, realista, neutral y accionable para mitigar la abstención en una demarcación territorial.

PRINCIPIOS INSTITUCIONALES DEL INE:
- Certeza, legalidad, independencia, imparcialidad, máxima publicidad y objetividad.
- Prohibición terminante de mencionar partidos políticos, coaliciones, candidatos o simpatías políticas.
- Los planes promueven el ejercicio del voto libre, informado y razonado, así como la accesibilidad del trámite de credencialización y de las casillas.

PALANCAS DISPONIBLES EN EL SIMULADOR:
Cada propuesta de campaña debe corresponder exactamente a una de las siguientes 4 palancas:
1. 'promocion_jovenes': Promoción del voto joven (18-24 años), brigadas en planteles universitarios, redes cívicas y formatos digitales.
2. 'casillas_rurales': Casillas y traslado en zonas rurales, difusión comunitaria, módulos itinerantes y apoyo en accesibilidad.
3. 'materiales_lengua_indigena': Materiales y capacitación en lenguas indígenas, traductores bilingües y difusión en radios comunitarias.
4. 'campana_general': Campaña general de promoción del voto, módulos cívicos y difusión en medios locales.

REGLAS TÉCNICAS DEL PLAN:
1. Propuestas: de 2 a 4 propuestas. Cada una con una palanca DISTINTA (máximo una por palanca).
2. Efecto esperado ('effect_pp'): realista, entre 0.5 y 4.0 pp de reducción de abstención (justificado en 'rationale').
3. Cobertura ('coverage'): entre 30% y 100%.
4. Focalización ('targeting'):
   - Si la unidad es municipal: SIEMPRE 'todos'.
   - Si la unidad es estatal: 'rojo', 'rojo_naranja' o 'todos'.
5. Referencia a hallazgos ('addresses'): cada propuesta debe indicar los IDs de los hallazgos que atiende (ej: ["f1", "f2"]).
6. Grupos objetivo: de 1 a 3 grupos claros y congruentes con la demarcación. No inventes cifras de población (el sistema las calcula con base en el Censo 2020).
7. Cronograma ('steps'): de 4 a 6 etapas cronológicas entre la fecha actual y el 31 de mayo de 2027 (previo a la jornada del 6 de junio de 2027).
   - Áreas responsables del INE válidas: 'Junta Local Ejecutiva', 'Junta Distrital Ejecutiva', 'Vocalía de Capacitación Electoral y Educación Cívica', 'Dirección Ejecutiva de Capacitación Electoral y Educación Cívica (DECEyEC)', 'Coordinación Nacional de Comunicación Social'.
8. Riesgos y mitigaciones: de 2 a 4 riesgos operativos o comunitarios realistas con su mitigación.
9. KPIs: de 3 a 5 indicadores cualitativos y cuantitativos institucionales claros.
"""


def build_planner_prompt(
    snapshot: DataSnapshot,
    research: ResearchBundle,
    focus: str | None = None,
) -> list[dict[str, str]]:
    """Builds messages list for GLM-5.3 plan generation."""
    today_str = date.today().isoformat()

    findings_text_parts = []
    for f in research.findings:
        findings_text_parts.append(
            f"- [{f.id}] ({f.category}) {f.title}: {f.summary} [Ámbito: {f.scope}, Confianza: {f.confidence}]"
        )
    findings_block = "\n".join(findings_text_parts) if findings_text_parts else "No se identificaron hallazgos documentales externos; basa el plan en los datos cuantitativos institucionales."

    recos_block = "\n".join(f"- {r}" for r in snapshot.recommendations) if snapshot.recommendations else "Ninguna recomendación previa registrada."
    drivers_block = "\n".join(f"- {d.label}: {d.contribution_pp:+.1f} pp de contribución a la abstención" for d in snapshot.drivers) if snapshot.drivers else "No hay drivers específicos desglosados."

    focus_line = f"Enfoque prioritario: {focus}\n" if focus else ""

    user_content = f"""Diseña un Plan de Campaña Institucional de Participación Ciudadana para el INE:

DATOS DE LA DEMARCACIÓN:
- Unidad: {snapshot.name} ({snapshot.level.upper()}) - Clave: {snapshot.unit_id}
- Estado perteneciente: {snapshot.ent_name} (clave {snapshot.ent})
- Lista Nominal: {snapshot.lista_nominal:,} personas
- Abstención esperada: {snapshot.pred_abstention * 100:.1f}% (categoría de riesgo: {snapshot.category})
- Tendencia histórica: {snapshot.trend_pp:+.1f} pp
- Brecha juvenil: {f'{snapshot.gap_youth_pp_last:+.1f} pp' if snapshot.gap_youth_pp_last is not None else 'No disponible'}
- Indicadores territoriales: Rural: {snapshot.pct_rural or 0:.1f}%, Lengua indígena: {snapshot.pct_hli or 0:.1f}%, Jóvenes 18-24: {snapshot.pct_18_24 or 0:.1f}%
{focus_line}
HALLAZGOS DOCUMENTADOS EN LA INVESTIGACIÓN:
{findings_block}

FACTORES DETERMINANTES (DRIVERS) DEL MODELO:
{drivers_block}

RECOMENDACIONES PREVIAS DEL MODELO ATALAYA:
{recos_block}

FECHA DE INICIO DE LA PLANEACIÓN: {today_str}
FECHA LÍMITE DE IMPLEMENTACIÓN (veda electoral): 2027-05-31

Genera el borrador completo del plan cumpliendo estrictamente con el esquema JSON indicado.
"""
    return [
        {"role": "system", "content": CAMPAIGN_PLANNER_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
