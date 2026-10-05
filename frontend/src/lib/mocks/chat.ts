// MOCK DATA: Deterministic mock chat assistant streaming implementation
import type { ChatRequest, ChatStreamHandlers, ChatPlan, ChatData, ChatDone } from "../types";

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
};

export async function streamMockChat(
  req: ChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const regionLabel = req.region_id ? `Región ID: ${req.region_id}` : "Nivel Nacional";
  const userMsg = req.message.toLowerCase();

  // 1. Emit Plan
  const plan: ChatPlan = {
    intent: "Consulta analítica sobre proyección electoral y factores de riesgo",
    query: {
      scope: regionLabel,
      question: req.message,
      variables: ["participacion", "pred_abstention", "risk_score", "pct_18_24"],
      filters: req.region_id ? { cvegeo: req.region_id } : {},
    },
  };
  handlers.onPlan?.(plan);
  await sleep(150, signal);

  // 2. Emit Data (3 rows)
  const data: ChatData = {
    columns: ["Zona / Entidad", "Part. 2021 (%)", "Part. 2024 (%)", "Pred. Abstención 2027 (%)", "Semáforo 2027"],
    rows: [
      [req.region_id ? `Zona ${req.region_id}` : "Chiapas", "51.4%", "53.2%", "50.8%", "Naranja"],
      [req.region_id ? "Referencia Estatal" : "Oaxaca", "54.8%", "56.1%", "47.2%", "Amarillo"],
      ["Mediana Nacional", "52.7%", "60.9%", "46.5%", "Verde"],
    ],
    source: "INE Cómputos Distritales 2009-2024 & Modelo ATALAYA Ridge 2027",
  };
  handlers.onData?.(data);
  await sleep(200, signal);

  // 3. Emit Tokens
  let responseText = "";
  if (userMsg.includes("chiapas") || userMsg.includes("07")) {
    responseText =
      "En **Chiapas**, la abstención pronosticada para la elección federal intermedia de 2027 se estima en **50.8%** en el escenario inercial. " +
      "Los municipios con mayor vulnerabilidad electoral son **Ocosingo** (riesgo crítico, 78 pts) y **Cintalapa** (76 pts), empujados por la dispersión rural y una caída histórica de participación en intermedias. " +
      "Se sugiere priorizar la instalación anticipada de casillas extraordinarias y materiales en lenguas originarias.";
  } else if (userMsg.includes("joven") || userMsg.includes("intervenci")) {
    responseText =
      "La simulación de **promoción focalizada en jóvenes (18-24 años)** en zonas con semáforo naranja y rojo estima un incremento promedio de participación de **+2.8 puntos porcentuales**, " +
      "lo que representaría recuperar aproximadamente **340,000 votos ciudadanos** a nivel nacional y reducir la categoría de riesgo en 84 municipios prioritarios.";
  } else {
    responseText =
      `Para **${regionLabel}**, el análisis predictivo indica una tendencia de moderada recuperación hacia 2027 respecto al ciclo 2021. ` +
      "Las principales palancas identificadas para mitigar el riesgo de abstención son el fortalecimiento de la infraestructura de casillas en áreas de alta dispersión y campañas dirigidas al primer voto universitario.";
  }

  // Stream in small words
  const words = responseText.split(" ");
  for (const word of words) {
    await sleep(40, signal);
    handlers.onToken?.({ text: word + " " });
  }

  // 4. Emit Done
  const done: ChatDone = {
    sources: ["INE Estadísticas Electorales 2009-2024", "INEGI Censo de Población 2020", "CONAPO Marginación 2020"],
    degraded: false,
  };
  await sleep(100, signal);
  handlers.onDone?.(done);
}
