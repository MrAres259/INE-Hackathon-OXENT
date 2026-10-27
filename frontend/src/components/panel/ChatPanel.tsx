"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAtalaya } from "@/lib/state";
import { streamChat } from "@/lib/api";
import type { ChatPlan, ChatData, ChatDone } from "@/lib/types";
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

export function ChatPanel() {
  const { selectedRegionId, selectedDetail } = useAtalaya();
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync selectedRegionId when user selects a new region in the map
  useEffect(() => {
    if (selectedRegionId) {
      setActiveChatRegionId(selectedRegionId);
    }
  }, [selectedRegionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 144)}px`;
    }
  };

  const handleSend = async (textToSend?: string) => {
    const queryText = (textToSend ?? input).trim();
    if (!queryText || isStreaming) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
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
    abortControllerRef.current = new AbortController();

    try {
      const history = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      await streamChat(
        {
          message: queryText,
          history,
          region_id: activeChatRegionId,
        },
        {
          onPlan: (plan) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, plan } : m))
            );
          },
          onData: (data) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, data } : m))
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
                  ? { ...m, degraded: done.degraded, guardrail: done.guardrail }
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
        abortControllerRef.current.signal
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

  const handleClear = () => {
    handleStop();
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
                      : "max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-card text-card-foreground p-3.5 shadow-sm"
                  }`}
                >
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
                            {intentVal ? (
                              <span className="font-mono text-primary font-normal ml-1">
                                ({intentVal})
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="text-muted-foreground group-open:rotate-180 transition-transform">
                          ▼
                        </span>
                      </summary>
                      <div className="mt-2 pt-2 border-t border-border text-foreground space-y-1">
                        <div>
                          <span className="text-muted-foreground">Intención:</span>{" "}
                          <span className="font-mono text-primary">
                            {intentVal}
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

                  {/* Data table (assistant) with source */}
                  {msg.data && msg.data.columns && (
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}

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
              placeholder="Pregunta sobre participación o escenarios…"
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

          <div className="flex items-center justify-between px-1">
            {messages.length > 2 ? (
              <button
                type="button"
                onClick={handleClear}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Limpiar chat
              </button>
            ) : (
              <span />
            )}
            <span
              className={`text-[10px] font-mono ${
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
