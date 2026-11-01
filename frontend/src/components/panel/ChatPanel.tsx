"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAtalaya } from "@/lib/state";
import { streamChat } from "@/lib/api";
import type { ChatPlan, ChatData, ChatDone } from "@/lib/types";
import type {
  Explanation,
  ContextResult,
  SuggestedQuestion,
  ChatAction,
  EvidenceType,
  Strength,
} from "@/lib/explain/types";
import { requestContext } from "@/lib/explain/api";
import { pollJob } from "@/lib/intel/api";
import type { Job } from "@/lib/intel/types";
import { ExplainCard } from "@/components/explain/ExplainCard";
import { ContextCard } from "@/components/explain/ContextCard";
import { SuggestedQuestions } from "@/components/explain/SuggestedQuestions";
import { EvidenceBadge } from "@/components/explain/EvidenceBadge";
import { JobProgress } from "@/components/intel/JobProgress";
import { InfoTip } from "@/components/ui/InfoTip";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  plan?: ChatPlan;
  data?: ChatData;
  degraded?: boolean;
  guardrail?: {
    stage: "entrada" | "tema" | "salida";
    category: string;
    ref: string;
  } | null;
  error?: string;
  explanation?: Explanation | null;
  context?: ContextResult | null;
  suggestions?: SuggestedQuestion[];
  action?: ChatAction | null;
}

const SUGGESTIONS = [
  "¿Qué municipios de Chiapas tienen mayor riesgo en 2027?",
  "¿Cómo se relaciona la escolaridad con la participación en Oaxaca?",
  "¿Cuál fue la participación en Jalisco en 2021?",
  "¿Qué pasa si hacemos promoción del voto juvenil en zonas rojas?",
];

function getGuardrailTitle(category?: string | null): string {
  if (!category) return "Solicitud bloqueada";
  if (category === "codigo") return "No genero código";
  if (category === "datos_personales") return "Protección de datos personales";
  if (category === "partidista") return "Sin análisis partidista";
  if (category.startsWith("danino:autolesion") || category === "autolesion") return "Estamos contigo";
  if (category === "fuera_de_alcance") return "Fuera del alcance de Atalaya Electoral";
  return "Solicitud bloqueada";
}

export const INTENT_LABELS: Record<string, string> = {
  explain_unit: "Explicación de la zona",
  context_news: "Noticias y contexto",
  profile: "Quién vota por edad y sexo",
  trend: "Evolución histórica",
  compare: "Comparación",
  ranking: "Ranking",
  lookup: "Consulta de datos",
  correlation: "Relación entre variables",
  scenario: "Simulación de escenarios",
  catalog: "Catálogo de variables",
  help: "Ayuda",
};

export function getIntentLabel(intent?: string | null): string {
  if (!intent) return "Consulta";
  return INTENT_LABELS[intent] || "Consulta";
}

function normalizeEvidenceText(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses an evidence tag inside brackets, e.g. "Cálculo del modelo · Fuerte".
 * Mappings:
 * - "Dato medido" -> "dato_medido"
 * - "Cálculo del modelo" / "Calculo del modelo" -> "calculo_del_modelo"
 * - "Relación, no prueba causa" / "Relación (no prueba causa)" -> "asociacion"
 * - "Dato de contexto" -> "contexto_descriptivo"
 * Strengths:
 * - "Fuerte" -> "fuerte"
 * - "Moderada" -> "moderada"
 * - "Débil" / "Debil" -> "debil"
 * - If strength is omitted, defaults to "moderada" (documented per task spec)
 * Returns null if the tag is not recognized or invalid.
 */
export function parseEvidenceTag(raw: string): { type: EvidenceType; strength: Strength } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let typePart = trimmed;
  let strength: Strength = "moderada"; // default when omitted

  // Look for strength suffix: e.g. "· Fuerte", "- Moderada", "· Débil", ": Fuerte"
  const strengthMatch = trimmed.match(
    /^(.*?)(?:[\s·•–—\-|:]+)(fuerte|moderada|débil|debil)$/i
  );
  if (strengthMatch) {
    typePart = strengthMatch[1].trim();
    const stNorm = normalizeEvidenceText(strengthMatch[2]);
    if (stNorm === "fuerte" || stNorm === "moderada" || stNorm === "debil") {
      strength = stNorm as Strength;
    }
  }

  const normType = normalizeEvidenceText(typePart);

  let type: EvidenceType | null = null;
  if (normType === "dato medido" || normType === "dato_medido") {
    type = "dato_medido";
  } else if (
    normType === "calculo del modelo" ||
    normType === "calculo_del_modelo" ||
    normType === "calculo de modelo" ||
    normType === "calculo modelo"
  ) {
    type = "calculo_del_modelo";
  } else if (
    normType === "relacion, no prueba causa" ||
    normType === "relacion (no prueba causa)" ||
    normType === "relacion no prueba causa" ||
    normType === "relacion, no prueba causalidad" ||
    normType === "asociacion"
  ) {
    type = "asociacion";
  } else if (
    normType === "dato de contexto" ||
    normType === "contexto descriptivo" ||
    normType === "contexto_descriptivo" ||
    normType === "contexto"
  ) {
    type = "contexto_descriptivo";
  }

  if (!type) {
    return null;
  }

  return { type, strength };
}

/**
 * Scans a plain string for evidence tags like `[Cálculo del modelo · Fuerte]`,
 * replacing recognized tags with `<EvidenceBadge />` components.
 * Incomplete tags during streaming (e.g. `[Dato me`) and unknown tags remain plain text.
 */
export function replaceEvidenceTagsInText(text: string): React.ReactNode[] {
  const TAG_REGEX = /\[([^\]\n]+)\]/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchCount = 0;

  while ((match = TAG_REGEX.exec(text)) !== null) {
    const inner = match[1];
    const parsed = parseEvidenceTag(inner);

    if (parsed) {
      if (match.index > lastIndex) {
        elements.push(text.slice(lastIndex, match.index));
      }
      elements.push(
        <EvidenceBadge
          key={`evidence-badge-${match.index}-${matchCount++}`}
          type={parsed.type}
          strength={parsed.strength}
          size="compact"
          className="mr-1.5 align-middle"
        />
      );
      lastIndex = TAG_REGEX.lastIndex;
      // Consume a single space immediately after the bracket so spacing is consistent
      if (text[lastIndex] === " ") {
        lastIndex++;
      }
    }
  }

  if (matchCount === 0) {
    return [text];
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

/**
 * Recursively traverses React nodes to replace evidence tags inside strings.
 */
export function replaceEvidenceTags(nodes: React.ReactNode): React.ReactNode {
  if (typeof nodes === "string") {
    const replaced = replaceEvidenceTagsInText(nodes);
    if (replaced.length === 1 && typeof replaced[0] === "string") {
      return replaced[0];
    }
    return replaced;
  }
  if (Array.isArray(nodes)) {
    return React.Children.map(nodes, (child) => replaceEvidenceTags(child));
  }
  if (React.isValidElement(nodes)) {
    if (nodes.type === EvidenceBadge || !nodes.props || !(nodes.props as any).children) {
      return nodes;
    }
    if (typeof nodes.type === "string") {
      return React.cloneElement(nodes, {
        ...(nodes.props as any),
        children: replaceEvidenceTags((nodes.props as any).children),
      });
    }
    return nodes;
  }
  return nodes;
}

export const assistantMarkdownComponents = {
  ul: ({ node, ...props }: any) => (
    <ul className="list-disc pl-5 my-2 space-y-1 text-inherit" {...props} />
  ),
  ol: ({ node, ...props }: any) => (
    <ol className="list-decimal pl-5 my-2 space-y-1 text-inherit" {...props} />
  ),
  li: ({ node, children, ...props }: any) => (
    <li className="my-0.5 leading-relaxed pl-0.5" {...props}>
      {replaceEvidenceTags(children)}
    </li>
  ),
  p: ({ node, children, ...props }: any) => {
    const firstChild = React.Children.toArray(children)[0];
    const isFirstStrong =
      React.isValidElement(firstChild) &&
      (firstChild.type === "strong" || (firstChild.props as any)?.node?.tagName === "strong");
    return (
      <p className={`my-2 leading-relaxed ${isFirstStrong ? "mt-3" : ""}`} {...props}>
        {replaceEvidenceTags(children)}
      </p>
    );
  },
  strong: ({ node, ...props }: any) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
};

export function ChatPanel() {
  const atalaya = useAtalaya();
  const { selectedRegionId, selectedDetail } = atalaya;
  const explainRequest = (atalaya as { explainRequest?: { unitId: string; name: string; level: "state" | "mun"; nonce: number } | null }).explainRequest;
  const clearExplainRequest = (atalaya as { clearExplainRequest?: () => void }).clearExplainRequest;

  const [activeChatRegionId, setActiveChatRegionId] = useState<string | null>(selectedRegionId);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hola. Soy el asistente de análisis electoral de **Atalaya Electoral**. Puedo consultar datos históricos del INE (2009–2024), variables sociodemográficas (INEGI / CONAPO) y predicciones para 2027. ¿Qué información deseas consultar?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeResearch, setActiveResearch] = useState<{
    messageId: string;
    unitId: string;
    job?: Job<ContextResult>;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const researchAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastHandledNonceRef = useRef<number | null>(null);

  // Sync selectedRegionId when user selects a new region in the map
  useEffect(() => {
    if (selectedRegionId) {
      setActiveChatRegionId(selectedRegionId);
    }
  }, [selectedRegionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, activeResearch]);

  // Handle explainRequest from state (triggered by map tooltip or panel)
  useEffect(() => {
    if (explainRequest && explainRequest.nonce !== lastHandledNonceRef.current) {
      lastHandledNonceRef.current = explainRequest.nonce;
      const { unitId, name } = explainRequest;

      // Abort ongoing stream or research if any
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (researchAbortRef.current) {
        researchAbortRef.current.abort();
        setActiveResearch(null);
      }
      setIsStreaming(false);

      setActiveChatRegionId(unitId);
      clearExplainRequest?.();

      handleSend(
        `¿Por qué ${name} tiene este nivel de riesgo? Explícamelo en palabras sencillas.`,
        { mode: "explain", regionId: unitId }
      );
    }
  }, [explainRequest, clearExplainRequest]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (researchAbortRef.current) {
        researchAbortRef.current.abort();
      }
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 144)}px`;
    }
  };

  const handleSend = async (
    textToSend?: string,
    options?: { mode?: "explain"; regionId?: string }
  ) => {
    const queryText = (textToSend ?? input).trim();
    if (!queryText) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const targetRegionId = options?.regionId !== undefined ? options.regionId : activeChatRegionId;
    const targetMode = options?.mode;

    if (options?.regionId) {
      setActiveChatRegionId(options.regionId);
    }

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    const newMessages: Message[] = [
      ...messages,
      { id: userMsgId, role: "user", content: queryText },
    ];
    setMessages(newMessages);

    // Initial assistant empty placeholder
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: "assistant", content: "" },
    ]);

    setIsStreaming(true);
    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      const history = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      await streamChat(
        {
          message: queryText,
          history,
          region_id: targetRegionId,
          ...(targetMode ? { mode: targetMode } : {}),
        },
        {
          onPlan: (plan) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, plan } : m))
            );
          },
          onData: (data) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      data,
                      explanation: data.explanation ?? m.explanation,
                      context: data.context ?? m.context,
                    }
                  : m
              )
            );
          },
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + token.text }
                  : m
              )
            );
          },
          onDone: (done: ChatDone) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      degraded: done.degraded,
                      guardrail: done.guardrail,
                      suggestions: done.suggestions ?? m.suggestions,
                      action: done.action ?? m.action,
                    }
                  : m
              )
            );
            setIsStreaming(false);
          },
          onError: (err) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      error: err.message,
                    }
                  : m
              )
            );
            setIsStreaming(false);
          },
        },
        ac.signal
      );
    } catch {
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsStreaming(false);
  };

  const handleStartResearch = async (msgId: string, unitId: string, regionName: string) => {
    if (researchAbortRef.current) {
      researchAbortRef.current.abort();
    }
    const ac = new AbortController();
    researchAbortRef.current = ac;
    setActiveResearch({ messageId: msgId, unitId });

    try {
      const res = await requestContext(unitId);
      if (ac.signal.aborted) return;

      if (res.kind === "done") {
        setActiveResearch(null);
        const ctxMsgId = `context-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: ctxMsgId,
            role: "assistant",
            content: "",
            context: res.context,
          },
        ]);

        const finalName = res.context.name || regionName;
        setTimeout(() => {
          handleSend(`Resume las noticias encontradas sobre ${finalName}`, {
            regionId: unitId,
          });
        }, 50);
        return;
      }

      if (res.kind === "job") {
        setActiveResearch({ messageId: msgId, unitId, job: res.job });
        const completedJob = await pollJob<ContextResult>(res.job.id, {
          signal: ac.signal,
          onUpdate: (updatedJob) => {
            setActiveResearch((prev) =>
              prev && prev.messageId === msgId ? { ...prev, job: updatedJob } : prev
            );
          },
        });

        if (ac.signal.aborted) return;

        if (completedJob.status === "done" && completedJob.result) {
          setActiveResearch(null);
          const ctxMsgId = `context-${Date.now()}`;
          setMessages((prev) => [
            ...prev,
            {
              id: ctxMsgId,
              role: "assistant",
              content: "",
              context: completedJob.result,
            },
          ]);

          const finalName = completedJob.result.name || regionName;
          setTimeout(() => {
            handleSend(`Resume las noticias encontradas sobre ${finalName}`, {
              regionId: unitId,
            });
          }, 50);
        } else if (completedJob.status === "error") {
          setActiveResearch(null);
          const errorMsg = completedJob.error || "Error al investigar contexto reciente de noticias.";
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "assistant",
              content: "",
              error: errorMsg,
            },
          ]);
        }
      }
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      setActiveResearch(null);
      const errText = err instanceof Error ? err.message : "Ocurrió un error al buscar noticias recientes.";
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "",
          error: errText,
        },
      ]);
    }
  };

  const handleCancelResearch = () => {
    if (researchAbortRef.current) {
      researchAbortRef.current.abort();
    }
    setActiveResearch(null);
  };

  const handleClear = () => {
    handleStop();
    handleCancelResearch();
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content:
          "Conversación reiniciada. ¿En qué otra consulta puedo apoyarte?",
      },
    ]);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Region Context Pill if selected and removable */}
      {activeChatRegionId && (
        <div className="bg-primary-soft border border-primary/20 rounded-lg px-3 py-1.5 mx-3 mt-3 flex items-center justify-between text-xs text-primary shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <span className="w-2 h-2 rounded-full bg-primary shrink-0"></span>
            <span className="text-muted-foreground">Contexto:</span>
            <span className="font-semibold text-foreground truncate">
              {selectedDetail?.id === activeChatRegionId
                ? selectedDetail.name
                : activeChatRegionId}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveChatRegionId(null)}
            className="text-muted-foreground hover:text-foreground ml-2 text-xs font-bold p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
            title="Quitar contexto territorial"
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-3 p-3 text-xs">
        {messages.length <= 1 && (
          <div className="py-4 text-center">
            <div className="mx-auto grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            </div>
            <h3 className="mt-3 font-display font-bold text-foreground text-sm">Asistente de participación</h3>
            <p className="mx-auto mt-1 max-w-72 text-xs text-muted-foreground">
              Consulta datos del INE (2009–2024), INEGI y CONAPO y los pronósticos 2027. Nunca inventa cifras.
            </p>

            {selectedDetail && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setActiveChatRegionId(selectedDetail.id);
                    handleSend(
                      `¿Por qué ${selectedDetail.name} tiene este nivel de riesgo? Explícamelo en palabras sencillas.`,
                      { mode: "explain", regionId: selectedDetail.id }
                    );
                  }}
                  disabled={isStreaming}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer shadow-2xs"
                >
                  <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>¿Por qué {selectedDetail.name} tiene este riesgo?</span>
                </button>
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => {
          const queryObj =
            typeof msg.plan?.query === "object" && msg.plan?.query !== null
              ? (msg.plan.query as Record<string, unknown>)
              : null;
          const intentVal =
            (queryObj?.intent as string | undefined) ?? msg.plan?.intent;

          const isRejection =
            msg.guardrail &&
            (msg.guardrail.stage === "entrada" || msg.guardrail.stage === "tema");
          const isAutolesion =
            msg.guardrail?.category?.includes("autolesion") ?? false;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === "user" ? "items-end" : "items-start"
              }`}
            >
              {isRejection ? (
                // Rejection Notice Box
                <div
                  className={`max-w-[92%] rounded-2xl p-3.5 space-y-2.5 rounded-bl-sm border shadow-sm ${
                    isAutolesion
                      ? "bg-primary-soft border-primary/20 text-foreground"
                      : "bg-muted border-border text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isAutolesion ? (
                      <svg
                        className="w-4 h-4 text-primary shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4 text-muted-foreground shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    )}
                    <span className="font-semibold text-xs text-foreground">
                      {getGuardrailTitle(msg.guardrail?.category)}
                    </span>
                  </div>

                  {msg.content && (
                    <div className="prose prose-xs max-w-none leading-relaxed text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-a:text-primary">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
                        {msg.content.replace(/\n*Referencia:\s*gr-[0-9a-fA-F]+/i, "").trim()}
                      </ReactMarkdown>
                    </div>
                  )}

                  {msg.guardrail?.ref && (
                    <div className="text-[10px] text-muted-foreground font-mono">
                      Referencia: {msg.guardrail.ref}
                    </div>
                  )}

                  {/* 2 Domain suggestions below rejection */}
                  <div className="mt-2.5 pt-2 border-t border-border space-y-1">
                    <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                      Consultas sugeridas:
                    </div>
                    <div className="flex flex-col gap-1">
                      {SUGGESTIONS.slice(0, 2).map((sug, sIdx) => (
                        <button
                          key={sIdx}
                          type="button"
                          onClick={() => handleSend(sug)}
                          disabled={isStreaming}
                          className="text-[11px] text-left px-2.5 py-1.5 rounded-lg bg-card hover:bg-accent text-foreground hover:text-accent-foreground border border-border transition-colors cursor-pointer"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className={`space-y-2.5 ${
                    msg.role === "user"
                      ? "max-w-[88%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3.5 py-2.5 text-xs leading-relaxed"
                      : "max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-card text-card-foreground p-3.5 shadow-sm space-y-3"
                  }`}
                >
                  {/* ExplainCard: shown at the top when explanation is present */}
                  {msg.explanation && (
                    <ExplainCard
                      explanation={msg.explanation}
                      variant="chat"
                      hideSuggestions={true}
                      className="border-0 shadow-none p-0 bg-transparent"
                    />
                  )}

                  {/* Plan: "Cómo lo calculé" */}
                  {msg.plan && (
                    <details className="bg-muted/50 border border-border rounded-lg p-2 text-[11px] group">
                      <summary className="cursor-pointer font-semibold text-foreground flex items-center justify-between select-none">
                        <span className="flex items-center gap-1.5">
                          <svg
                            className="w-3.5 h-3.5 text-primary"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                            />
                          </svg>
                          <span>
                            Cómo lo calculé
                            <span className="text-primary font-normal ml-1">
                              ({getIntentLabel(intentVal)})
                            </span>
                          </span>
                        </span>
                        <span className="text-muted-foreground group-open:rotate-180 transition-transform">
                          ▼
                        </span>
                      </summary>
                      <div className="mt-2 pt-2 border-t border-border text-foreground space-y-1">
                        <div>
                          <span className="text-muted-foreground">Tipo de consulta:</span>{" "}
                          <span className="text-primary font-medium">
                            {getIntentLabel(intentVal)}
                          </span>
                        </div>
                        <pre className="bg-muted p-2 rounded text-[10px] text-foreground overflow-x-auto font-mono">
                          {typeof msg.plan.query === "string"
                            ? msg.plan.query
                            : JSON.stringify(msg.plan.query, null, 2)}
                        </pre>
                      </div>
                    </details>
                  )}

                  {/* Data table: hidden if explanation is present */}
                  {!msg.explanation && msg.data && msg.data.columns && (
                    <div className="bg-background border border-border rounded-lg p-2 text-[11px] overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-muted border-b border-border text-[10px] uppercase font-semibold text-muted-foreground">
                              {msg.data.columns.map((col, idx) => (
                                <th key={idx} className="py-1 px-1.5">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {msg.data.rows.map((row, rIdx) => (
                              <tr key={rIdx}>
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className="py-1 px-1.5 font-mono text-[10px] text-foreground"
                                  >
                                    {cell ?? "—"}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {msg.data.source && (
                        <div className="text-[9px] text-muted-foreground mt-1.5 pt-1 border-t border-border">
                          Fuente: {msg.data.source}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message text with Markdown */}
                  {msg.content && (
                    <div
                      className={`leading-relaxed ${
                        msg.role === "user"
                          ? "text-primary-foreground"
                          : "prose prose-xs max-w-none text-card-foreground prose-headings:text-foreground prose-p:text-card-foreground prose-strong:text-foreground prose-a:text-primary"
                      }`}
                    >
                      {msg.explanation && (
                        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-1 not-prose">
                          En palabras sencillas
                        </h4>
                      )}
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={msg.role === "assistant" ? assistantMarkdownComponents : undefined}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* ContextCard: shown if context is present */}
                  {msg.context && (
                    <ContextCard
                      result={msg.context}
                      className="border-0 shadow-none p-0 bg-transparent"
                    />
                  )}

                  {/* Context research action */}
                  {msg.action && msg.action.type === "context_research" && (
                    <div className="pt-1 border-t border-border/60">
                      {activeResearch && activeResearch.messageId === msg.id ? (
                        <div className="space-y-2">
                          <JobProgress
                            job={activeResearch.job}
                            stage={activeResearch.job?.stage || "Iniciando investigación de fuentes..."}
                            progress={activeResearch.job?.progress || 10}
                          />
                          <button
                            type="button"
                            onClick={handleCancelResearch}
                            className="text-xs text-muted-foreground hover:text-foreground px-2.5 py-1 rounded border border-border bg-card cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            handleStartResearch(
                              msg.id,
                              msg.action!.unit_id,
                              msg.explanation?.name || selectedDetail?.name || msg.action!.unit_id
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-soft hover:bg-primary/20 text-primary border border-primary/30 text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                        >
                          <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                            />
                          </svg>
                          <span>{msg.action.label || "Buscar noticias y hechos recientes (≈ 1–3 min)"}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Suggested questions at the end */}
                  {(() => {
                    const questionsToDisplay =
                      msg.suggestions && msg.suggestions.length > 0
                        ? msg.suggestions
                        : msg.explanation?.suggested_questions;

                    if (questionsToDisplay && questionsToDisplay.length > 0) {
                      return (
                        <SuggestedQuestions
                          questions={questionsToDisplay}
                          onAsk={(q) => handleSend(q.text)}
                          disabled={isStreaming}
                        />
                      );
                    }
                    return null;
                  })()}

                  {/* Guardrail stage salida note */}
                  {msg.guardrail?.stage === "salida" && (
                    <div className="mt-2 text-[10px] text-muted-foreground bg-muted border border-border px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-primary text-xs">ℹ</span>
                        <span>Parte de la respuesta se reemplazó por datos verificados</span>
                        <InfoTip
                          title="Datos verificados"
                          text="Por política de precisión analítica, las cifras o afirmaciones no respaldadas directamente por las fuentes oficiales fueron sustituidas por datos y hechos verificados de Atalaya Electoral."
                          side="top"
                          size="xs"
                        />
                      </div>
                      {msg.guardrail.ref && (
                        <span className="text-[9px] text-muted-foreground font-mono">
                          Referencia: {msg.guardrail.ref}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Degraded fallback note */}
                  {msg.degraded && !msg.guardrail && (
                    <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>
                        Aviso: Respuesta generada sin modelo de lenguaje (modo
                        determinista / fallback de datos).
                      </span>
                    </div>
                  )}

                  {/* Error event / system note */}
                  {msg.error && (
                    <div
                      className={`text-[11px] px-3 py-2 rounded-lg flex items-center gap-2 ${
                        msg.error.includes("Demasiadas") || msg.error.includes("demasiado larga")
                          ? "text-amber-800 bg-amber-50 border border-amber-200"
                          : "text-destructive bg-destructive/10 border border-destructive/20"
                      }`}
                    >
                      <span
                        className={
                          msg.error.includes("Demasiadas") || msg.error.includes("demasiado larga")
                            ? "text-amber-600"
                            : "text-destructive font-bold"
                        }
                      >
                        {msg.error.includes("Demasiadas") || msg.error.includes("demasiado larga") ? "⚠️" : "✕"}
                      </span>
                      <span>
                        {msg.error.includes("Demasiadas") || msg.error.includes("demasiado larga")
                          ? msg.error
                          : `Error en la consulta: ${msg.error}`}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {isStreaming && (
          <div className="flex items-center gap-1.5 px-3 py-1">
            <div className="flex gap-1 items-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                  style={{ animationDelay: `${i * 140}ms` }}
                />
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground ml-1">Generando análisis...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input box & Stop Button */}
      <div className="border-t border-border p-3 bg-card shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        {messages.length < 2 && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 shrink-0">
            {selectedDetail && (
              <button
                type="button"
                onClick={() => {
                  setActiveChatRegionId(selectedDetail.id);
                  handleSend(
                    `¿Por qué ${selectedDetail.name} tiene este nivel de riesgo? Explícamelo en palabras sencillas.`,
                    { mode: "explain", regionId: selectedDetail.id }
                  );
                }}
                disabled={isStreaming}
                className="shrink-0 rounded-full border border-primary/30 bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer disabled:opacity-50"
              >
                ¿Por qué {selectedDetail.name} tiene este riesgo?
              </button>
            )}
            {SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(s)}
                disabled={isStreaming}
                className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex flex-col gap-1"
        >
          <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-1.5 focus-within:border-primary transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              maxLength={1000}
              rows={1}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Escribe tu pregunta…"
              disabled={isStreaming}
              className="max-h-36 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none [@media(pointer:coarse)]:text-base leading-normal disabled:opacity-50"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive text-destructive-foreground transition-colors cursor-pointer"
                aria-label="Detener"
                title="Detener generación"
              >
                <span className="w-2.5 h-2.5 rounded-xs bg-current"></span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 transition-colors cursor-pointer"
                aria-label="Enviar"
                title="Enviar mensaje"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0l-6.75 6.75M12 4.5l6.75 6.75" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-1 text-[10px] min-w-0">
            {messages.length > 2 ? (
              <button
                type="button"
                onClick={handleClear}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
              >
                Limpiar chat
              </button>
            ) : (
              <span className="shrink-0" />
            )}
            <span
              className={`text-[10px] font-mono shrink-0 ${
                input.length >= 900 ? "text-destructive font-semibold" : "text-muted-foreground"
              }`}
            >
              {input.length}/1000
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
