export interface NewsImpactParam {
  topic: string;
  s_topic_pp: number;
  harm: number;
  susc_var: string;
  label_es: string;
  rationale_es: string;
}

export const NEWS_IMPACT_PARAMS: NewsImpactParam[] = [
  {
    topic: "seguridad_violencia",
    s_topic_pp: 2.5,
    harm: 0.7,
    susc_var: "r_vuln",
    label_es: "Seguridad y violencia",
    rationale_es: "Eventos de inseguridad en zonas específicas pueden inhibir directamente la afluencia a casillas",
  },
  {
    topic: "resultados_fraude",
    s_topic_pp: 1.5,
    harm: 0.8,
    susc_var: "pct_internet",
    label_es: "Resultados y fraude",
    rationale_es: "Cuestionamientos a la certeza de los resultados debilitan la motivación cívica para emitir el voto",
  },
  {
    topic: "organizacion_casillas",
    s_topic_pp: 1.5,
    harm: 0.8,
    susc_var: "pct_rural",
    label_es: "Organización y casillas",
    rationale_es: "Problemas logísticos o reubicación de casillas impactan la accesibilidad física del electorado",
  },
  {
    topic: "confianza_institucional",
    s_topic_pp: 1.0,
    harm: 0.6,
    susc_var: "pct_internet",
    label_es: "Confianza institucional",
    rationale_es: "Los choques de confianza suelen mover la participación electoral en el orden de décimas de punto",
  },
  {
    topic: "presupuesto_recortes",
    s_topic_pp: 1.0,
    harm: 0.5,
    susc_var: "pct_rural",
    label_es: "Presupuesto y recortes",
    rationale_es: "Limitaciones presupuestales pueden mermar capacidades operativas y de despliegue territorial",
  },
  {
    topic: "credencial_padron",
    s_topic_pp: 1.0,
    harm: 1.0,
    susc_var: "pct_18_24",
    label_es: "Credencial y padrón",
    rationale_es: "Incertidumbre sobre vigencia de credencial desmoviliza especialmente a primeros votantes",
  },
  {
    topic: "procedimiento_votacion",
    s_topic_pp: 1.0,
    harm: 1.0,
    susc_var: "pct_internet",
    label_es: "Procedimiento de votación",
    rationale_es: "Confusión sobre requisitos u horarios de votación induce desinformación operativa directa",
  },
  {
    topic: "conducta_funcionarios",
    s_topic_pp: 0.5,
    harm: 0.4,
    susc_var: "vulnerability_pp",
    label_es: "Conducta de funcionarios",
    rationale_es: "Señalamientos a funcionarios individuales tienen impacto moderado en la conducta agregada",
  },
  {
    topic: "otra",
    s_topic_pp: 0.5,
    harm: 0.4,
    susc_var: "vulnerability_pp",
    label_es: "Otra temática",
    rationale_es: "Noticias no clasificadas presentan efectos acotados sobre la participación global",
  },
];

export interface SeverityActionRule {
  news_kind: string;
  threshold: string;
  action_label: string;
  secondary_actions?: string;
  deadline_hours: number;
  description: string;
}

export const SEVERITY_ACTIONS_RULES: SeverityActionRule[] = [
  {
    news_kind: "Falsa / Engañosa / Rumor",
    threshold: "Crítica (score ≥ 75 pts)",
    action_label: "Desmentido oficial (#INEdesmiente)",
    secondary_actions: "Reportar a plataforma + Responder y corregir",
    deadline_hours: 12,
    description: "Falsedades sobre requisitos de votación, fechas, anulación de credenciales o fraude viral.",
  },
  {
    news_kind: "Falsa / Engañosa / Rumor",
    threshold: "Alta (50 ≤ score < 75 pts)",
    action_label: "Reportar a plataforma",
    secondary_actions: "Responder y corregir con fuente verificada",
    deadline_hours: 24,
    description: "Rumores virales con alcance significativo en redes sociales.",
  },
  {
    news_kind: "Falsa / Engañosa / Rumor",
    threshold: "Media (25 ≤ score < 50 pts)",
    action_label: "Responder y corregir",
    secondary_actions: "Monitoreo de viralidad",
    deadline_hours: 48,
    description: "Afirmaciones engañosas o imprecisas en medios o redes sin viralidad extrema.",
  },
  {
    news_kind: "Falsa / Engañosa / Rumor",
    threshold: "Baja (score < 25 pts)",
    action_label: "Registrar en bitácora",
    secondary_actions: "Sin acción pública requerida",
    deadline_hours: 168,
    description: "Rumores incipientes o comentarios aislados con bajo enganche.",
  },
  {
    news_kind: "Verdadera / Crítica",
    threshold: "Impacto severo (Δ_max ≥ 1.0 pp o > 50k votos)",
    action_label: "Campaña de intervención",
    secondary_actions: "Comunicado oficial aclaratorio",
    deadline_hours: 48,
    description: "Eventos reales de alto impacto territorial que amenazan la afluencia en municipios prioritarios.",
  },
  {
    news_kind: "Verdadera / Crítica",
    threshold: "Impacto moderado (0.3 pp ≤ Δ_max < 1.0 pp)",
    action_label: "Comunicado oficial",
    secondary_actions: "Medidas operativas locales",
    deadline_hours: 72,
    description: "Dificultades operativas o presupuestales con impacto acotado a ciertas zonas.",
  },
  {
    news_kind: "Verdadera / Crítica",
    threshold: "Impacto leve (Δ_max < 0.3 pp y < 50k votos)",
    action_label: "Registrar en bitácora",
    secondary_actions: "Seguimiento en comisiones",
    deadline_hours: 168,
    description: "Controversias menores o de impacto marginal en el electorado.",
  },
];
