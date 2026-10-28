// ATALAYA Intel - Labels and visual styling tokens (Mexican Spanish)
import type {
  Verdict,
  SeverityLevel,
  ActionType,
  RegistryState,
  SourceTier,
  Platform,
  NewsTopic,
  FindingCategory,
  Lever,
} from "./types";

export interface LabelMeta {
  label: string;
  color: string;
  bgClass?: string;
  textClass?: string;
  borderClass?: string;
  description?: string;
}

export const VERDICT_LABELS: Record<Verdict, LabelMeta> = {
  verdadera: {
    label: "Verdadera",
    color: "#3f9a5b",
    bgClass: "bg-[#3f9a5b]/10",
    textClass: "text-[#2e7444] dark:text-[#52b972]",
    borderClass: "border-[#3f9a5b]/30",
    description: "Hecho documentado y verificado en fuentes institucionales o reconocidas.",
  },
  falsa: {
    label: "Falsa",
    color: "#c8352f",
    bgClass: "bg-[#c8352f]/10",
    textClass: "text-[#a62520] dark:text-[#e0524d]",
    borderClass: "border-[#c8352f]/30",
    description: "Afirmación carente de sustento o desmentida explícitamente por verificadores.",
  },
  enganosa: {
    label: "Engañosa",
    color: "#ec7a2c",
    bgClass: "bg-[#ec7a2c]/10",
    textClass: "text-[#c25a13] dark:text-[#f3954f]",
    borderClass: "border-[#ec7a2c]/30",
    description: "Contiene elementos ciertos pero sacados de contexto o con conclusiones distorsionadas.",
  },
  sin_verificar: {
    label: "Sin verificar",
    color: "#8a8290",
    bgClass: "bg-[#8a8290]/10",
    textClass: "text-[#6b6470] dark:text-[#a8a1ad]",
    borderClass: "border-[#8a8290]/30",
    description: "Aún en proceso de contraste o sin pronunciamiento de verificadores acreditados.",
  },
};

export const SEVERITY_LABELS: Record<SeverityLevel, LabelMeta> = {
  critica: {
    label: "Crítica",
    color: "#b5186b",
    bgClass: "bg-[#b5186b]/15",
    textClass: "text-[#8e1053] dark:text-[#e04596]",
    borderClass: "border-[#b5186b]/40",
    description: "Riesgo alto de desmovilización o impacto profundo en la certeza del proceso.",
  },
  alta: {
    label: "Alta",
    color: "#ea580c",
    bgClass: "bg-[#ea580c]/15",
    textClass: "text-[#c2410c] dark:text-[#fb923c]",
    borderClass: "border-[#ea580c]/40",
    description: "Alcance relevante o impacto territorial que requiere atención prioritaria.",
  },
  media: {
    label: "Media",
    color: "#d97706",
    bgClass: "bg-[#d97706]/15",
    textClass: "text-[#b45309] dark:text-[#fbbf24]",
    borderClass: "border-[#d97706]/40",
    description: "Difusión moderada con efectos locales o temporales acotados.",
  },
  baja: {
    label: "Baja",
    color: "#16a34a",
    bgClass: "bg-[#16a34a]/15",
    textClass: "text-[#15803d] dark:text-[#4ade80]",
    borderClass: "border-[#16a34a]/40",
    description: "Impacto mínimo o difusión circunscrita sin tracción relevante.",
  },
};

export const ACTION_LABELS: Record<ActionType, { label: string; deadlineHint: string }> = {
  registrar: {
    label: "Registrar para seguimiento",
    deadlineHint: "Monitoreo preventivo ordinario",
  },
  comunicado: {
    label: "Emitir comunicado institucional",
    deadlineHint: "Publicación en canales oficiales",
  },
  campana_intervencion: {
    label: "Planear campaña de intervención",
    deadlineHint: "Acción territorial focalizada",
  },
  responder_corregir: {
    label: "Responder y corregir en redes",
    deadlineHint: "Atención directa en la plataforma",
  },
  reportar_plataforma: {
    label: "Reportar ante la plataforma",
    deadlineHint: "Denuncia por desinformación",
  },
  desmentido_oficial: {
    label: "Desmentido oficial (#INEdesmiente)",
    deadlineHint: "Campaña de certeza urgente",
  },
};

export const REGISTRY_STATE_LABELS: Record<RegistryState, { label: string; color: string }> = {
  pendiente: { label: "Pendiente de atención", color: "#8a8290" },
  enterado: { label: "Enterado / En revisión", color: "#2563eb" },
  comunicado_emitido: { label: "Comunicado emitido", color: "#0891b2" },
  campana_planeada: { label: "Campaña planeada", color: "#7c3aed" },
  respondida: { label: "Respuesta enviada", color: "#16a34a" },
  reportada: { label: "Reportada a plataforma", color: "#ea580c" },
  descartada: { label: "Descartada", color: "#64748b" },
};

export interface TierMeta {
  label: string;
  style: "solid" | "outline" | "gray";
  alertIcon: boolean;
  color: string;
}

export const SOURCE_TIER_LABELS: Record<SourceTier, TierMeta> = {
  oficial: {
    label: "Oficial",
    style: "solid",
    alertIcon: false,
    color: "#166534",
  },
  verificador: {
    label: "Verificador",
    style: "solid",
    alertIcon: false,
    color: "#0e7490",
  },
  academico: {
    label: "Académico",
    style: "outline",
    alertIcon: false,
    color: "#4338ca",
  },
  medio_reconocido: {
    label: "Medio reconocido",
    style: "outline",
    alertIcon: false,
    color: "#374151",
  },
  medio_regional: {
    label: "Medio regional",
    style: "outline",
    alertIcon: false,
    color: "#4b5563",
  },
  no_reconocido: {
    label: "No reconocido",
    style: "gray",
    alertIcon: true,
    color: "#6b7280",
  },
  red_social: {
    label: "Red social",
    style: "gray",
    alertIcon: true,
    color: "#6b7280",
  },
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X (Twitter)",
  facebook: "Facebook",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  sitio_web: "Sitio web",
  otro: "Otra plataforma",
};

export const NEWS_TOPIC_LABELS: Record<NewsTopic, string> = {
  confianza_institucional: "Confianza institucional",
  presupuesto_recortes: "Presupuesto y recortes",
  organizacion_casillas: "Organización y casillas",
  credencial_padron: "Credencial y padrón electoral",
  seguridad_violencia: "Seguridad y violencia",
  conducta_funcionarios: "Conducta de funcionarios",
  resultados_fraude: "Cuestionamiento a resultados",
  procedimiento_votacion: "Procedimiento de votación",
  otra: "Otra temática",
};

export const FINDING_CATEGORY_LABELS: Record<FindingCategory, string> = {
  desconfianza_institucional: "Desconfianza institucional",
  inseguridad_violencia: "Inseguridad y violencia",
  acceso_casillas_distancia: "Distancia y acceso a casillas",
  desinformacion: "Desinformación",
  apatia_desafeccion: "Apatía y desafección",
  barreras_documentales_credencial: "Barreras de credencialización",
  migracion_movilidad: "Migración y movilidad",
  exclusion_linguistica_cultural: "Exclusión lingüística o cultural",
  condiciones_socioeconomicas: "Condiciones socioeconómicas",
  otra: "Otra causa documentada",
};

export const LEVER_LABELS: Record<Lever, string> = {
  promocion_jovenes: "Promoción del voto joven",
  casillas_rurales: "Casillas y traslado en zonas rurales",
  materiales_lengua_indigena: "Materiales y capacitación en lenguas indígenas",
  campana_general: "Campaña general de promoción",
};
