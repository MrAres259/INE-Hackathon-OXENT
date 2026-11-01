// Recorridos guiados de Atalaya Electoral: un recorrido por sección, con su propia clave de primera visita.
// Contrato de la ola UX-Redsign 1 (temp/ux-redesign/00-CONTEXT.md §5.1). Copiar literal a frontend/src/lib/tours.ts.

export type TourId = "mapa" | "campanas" | "monitor";

export interface TourStep {
  /** Valor(es) de `data-tour` del control a señalar; se usa el primero visible y no tapado. */
  sel: string | string[];
  title: string;
  text: string;
}

export interface TourDef {
  id: TourId;
  storageKey: string;
  steps: TourStep[];
}

export const GUIDE_EVENTS = {
  /** Petición de abrir la guía de la sección actual (botones "?"). */
  open: "atalaya:open-guide",
  /** La guía se abrió: cerrar popovers, menús, desplegables y acomodar hojas. */
  opened: "atalaya:guide-open",
  /** La guía se cerró. */
  closed: "atalaya:guide-close",
} as const;

const MAP_STEPS: TourStep[] = [
  {
    sel: "escenario",
    title: "Elige un escenario",
    text: "Base es el pronóstico 2027 si no se hace nada. Intervención simula campañas del INE y Pesimista una caída de la participación. El mapa y el panel cambian con el escenario.",
  },
  {
    sel: ["ajustar", "intervencion"],
    title: "Diseña campañas de intervención",
    text: "En Intervención, pulsa Ajustar para armar hasta 4 campañas (voto joven, casillas rurales, lenguas indígenas o campaña general), elegir en qué estados se aplican y ver cuántos votos se ganarían. Es un escenario hipotético para comparar, no una promesa.",
  },
  {
    sel: "capas",
    title: "Cambia la vista del mapa",
    text: "Semáforo muestra el riesgo 2027; Cambio Δ, cuánto mejora o empeora cada zona frente a la base; Comparar, los dos mapas lado a lado con una cortina.",
  },
  {
    sel: "panel",
    title: "Diagnóstico, Ranking y Asistente",
    text: "Elige una zona en el mapa para ver su diagnóstico y por qué tiene ese color. Ranking ordena las zonas por riesgo y el Asistente responde preguntas con los datos.",
  },
  {
    sel: "buscar",
    title: "Encuentra cualquier zona",
    text: "Escribe el nombre de un estado o municipio (o presiona / en el teclado) para ir directo a él.",
  },
  {
    sel: "herramientas",
    title: "Herramientas y vista 3D",
    text: "Levanta el mapa en 3D (la altura es el riesgo), cambia el ángulo, descarga una imagen PNG o vuelve a abrir esta guía.",
  },
  {
    sel: "leyenda",
    title: "Lee la leyenda",
    text: "Los cuatro colores del semáforo, cuántas zonas hay en cada uno y qué parte de la lista nominal vive en ellas.",
  },
  {
    sel: "secciones",
    title: "Plan de campaña y Monitor INE",
    text: "Plan de campaña: la IA investiga por qué una zona no vota y arma una presentación editable con propuestas medidas por el simulador. Monitor INE: vigila noticias y rumores sobre el INE y su efecto en la participación. Cada sección tiene su propia guía.",
  },
];

const CAMPAIGN_STEPS: TourStep[] = [
  {
    sel: "camp-intro",
    title: "Plan de campaña con IA",
    text: "Prepara una propuesta de campaña para un estado o municipio: la IA busca en fuentes públicas verificables, redacta el plan y el simulador calcula su impacto. Es un borrador para revisión del INE. La etiqueta indica cómo se está buscando y cuántas consultas quedan hoy.",
  },
  {
    sel: "camp-zona",
    title: "Elige la zona y el enfoque",
    text: "Busca el estado o municipio. Si quieres, escribe un enfoque (por ejemplo, «jóvenes» o «zonas rurales») para orientar la investigación.",
  },
  {
    sel: "camp-generar",
    title: "Genera el plan",
    text: "Si la zona ya tiene un plan reciente se abre al momento; si no, verás las etapas: investigar, planear, calcular el impacto y armar las diapositivas. Puede tardar de 1 a 3 minutos y puedes regenerarlo cuando quieras.",
  },
  {
    sel: "camp-diapositivas",
    title: "Revisa y edita las diapositivas",
    text: "Diagnóstico, problemáticas, grupo objetivo, propuestas, impacto, implementación y riesgos. Puedes editar títulos, viñetas y notas; tus cambios se guardan en este equipo.",
  },
  {
    sel: "camp-investigacion",
    title: "Fuentes de la investigación",
    text: "Cada hallazgo muestra su fuente y qué tan verificable es. Las marcas [s1], [s2]… de las diapositivas apuntan aquí.",
  },
  {
    sel: "camp-exportar",
    title: "Descarga la presentación",
    text: "Descarga el plan en PowerPoint (editable) o en PDF, con tus ediciones incluidas.",
  },
  {
    sel: "camp-simular",
    title: "Llévalo al mapa",
    text: "Simular en el mapa carga las propuestas como campañas del escenario Intervención, para ajustarlas y compararlas contra la base.",
  },
];

const MONITOR_STEPS: TourStep[] = [
  {
    sel: "mon-intro",
    title: "Monitor INE",
    text: "Vigila noticias desfavorables y rumores sobre el INE, los clasifica (verdadera, falsa, engañosa o sin verificar) y estima su efecto en la participación. La IA lee y redacta; las cifras salen de modelos con supuestos explícitos.",
  },
  {
    sel: "mon-escanear",
    title: "Busca noticias nuevas",
    text: "Elige el periodo (7, 14 o 30 días) y escanea. Entre un escaneo y otro hay que esperar 15 minutos; mientras, ves el último resultado guardado.",
  },
  {
    sel: "mon-kpis",
    title: "Resumen del escaneo",
    text: "Cuántas noticias resultaron verdaderas, falsas, engañosas o sin verificar, y cuántas piden una acción.",
  },
  {
    sel: "mon-filtros",
    title: "Verificadas y rumores",
    text: "Cambia entre noticias verificadas y rumores, busca por palabra y filtra por veredicto, severidad, acción sugerida, tema o estado de atención.",
  },
  {
    sel: "mon-lista",
    title: "Elige una noticia",
    text: "Toca una noticia para ver su diagnóstico completo: por qué se clasificó así, a quién afecta y qué conviene hacer.",
  },
  {
    sel: ["mon-impacto", "mon-viralidad"],
    title: "Impacto y difusión",
    text: "En noticias verdaderas, el mapa muestra cuánto podría bajar la participación por estado (y por municipio a pedido). En rumores, qué tan rápido se difunden y el riesgo de ignorarlos.",
  },
  {
    sel: "mon-remediacion",
    title: "Qué hacer",
    text: "La acción sugerida depende de la severidad: registrar, emitir un comunicado, responder, reportar a la plataforma o planear una campaña de intervención. Incluye un borrador para copiar.",
  },
  {
    sel: "mon-registro",
    title: "Registra la decisión",
    text: "Deja constancia de lo que decidió el INE (enterado, comunicado emitido, campaña planeada, respondida, reportada o descartada).",
  },
];

export const TOURS: Record<TourId, TourDef> = {
  mapa: { id: "mapa", storageKey: "atalaya.guide.mapa.v2", steps: MAP_STEPS },
  campanas: { id: "campanas", storageKey: "atalaya.guide.campanas.v1", steps: CAMPAIGN_STEPS },
  monitor: { id: "monitor", storageKey: "atalaya.guide.monitor.v1", steps: MONITOR_STEPS },
};

export function tourForPath(pathname: string | null | undefined): TourDef | null {
  if (!pathname) return null;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/") return TOURS.mapa;
  if (path === "/campanas" || path.startsWith("/campanas/")) return TOURS.campanas;
  if (path === "/monitor" || path.startsWith("/monitor/")) return TOURS.monitor;
  return null;
}

export function isGuideOpen(doc?: Document): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  try {
    return d?.body?.dataset?.guide === "open";
  } catch {
    return false;
  }
}
