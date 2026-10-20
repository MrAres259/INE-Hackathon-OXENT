"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAtalaya } from "@/lib/state";
import { streamChat } from "@/lib/api";
import type { ChatPlan, ChatData, ChatDone } from "@/lib/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  plan?: ChatPlan;
  data?: ChatData;
  degraded?: boolean;
  error?: string;
}

const SUGGESTIONS = [
  "¿Qué municipios de Chiapas tienen mayor riesgo en 2027?",
  "¿Cómo se relaciona la escolaridad con la participación en Oaxaca?",
  "¿Cuál fue la participación en Jalisco en 2021?",
  "¿Qué pasa si hacemos promoción del voto juvenil en zonas rojas?",
];

export function ChatPanel() {
  const { selectedRegionId, selectedDetail } = useAtalaya();
  const [activeChatRegionId, setActiveChatRegionId] = useState<string | null>(selectedRegionId);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hola. Soy el asistente de análisis electoral de **ATALAYA**. Puedo consultar datos históricos del INE (2009–2024), variables sociodemográficas (INEGI / CONAPO) y predicciones para 2027. ¿Qué información deseas consultar?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync selectedRegionId when user selects a new region in the map
  useEffect(() => {
    if (selectedRegionId) {
      setActiveChatRegionId(selectedRegionId);
    }
  }, [selectedRegionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleSend = async (textToSend?: string) => {
    const queryText = (textToSend ?? input).trim();
    if (!queryText || isStreaming) return;

    setInput("");
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
                  ? { ...m, degraded: done.degraded }
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
    <div className="flex flex-col h-[580px]">
      {/* Region Context Pill if selected and removable */}
      {activeChatRegionId && (
        <div className="bg-emerald-950/60 border border-emerald-800/80 rounded-lg px-3 py-1.5 mb-3 flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-1.5 truncate">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Contexto:</span>
            <span className="font-semibold text-white truncate">
              {selectedDetail?.id === activeChatRegionId
                ? selectedDetail.name
                : activeChatRegionId}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveChatRegionId(null)}
            className="text-emerald-400 hover:text-white ml-2 text-xs font-bold p-0.5 rounded hover:bg-emerald-900/60 transition-colors"
            title="Quitar contexto territorial"
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
        {messages.map((msg) => {
          const queryObj =
            typeof msg.plan?.query === "object" && msg.plan?.query !== null
              ? (msg.plan.query as Record<string, unknown>)
              : null;
          const intentVal =
            (queryObj?.intent as string | undefined) ?? msg.plan?.intent;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-[92%] rounded-2xl p-3.5 space-y-2.5 ${
                  msg.role === "user"
                    ? "bg-emerald-600 text-white rounded-br-xs"
                    : "bg-slate-800/90 border border-slate-700/80 text-slate-200 rounded-bl-xs shadow-md"
                }`}
              >
                {/* Plan: "Cómo lo calculé" */}
                {msg.plan && (
                  <details className="bg-slate-900/80 border border-slate-700/80 rounded-lg p-2 text-[11px] group">
                    <summary className="cursor-pointer font-semibold text-slate-300 flex items-center justify-between select-none">
                      <span className="flex items-center gap-1.5">
                        <svg
                          className="w-3.5 h-3.5 text-emerald-400"
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
                            <span className="font-mono text-emerald-400 font-normal ml-1">
                              ({intentVal})
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="text-slate-500 group-open:rotate-180 transition-transform">
                        ▼
                      </span>
                    </summary>
                    <div className="mt-2 pt-2 border-t border-slate-800 text-slate-300 space-y-1">
                      <div>
                        <span className="text-slate-400">Intención:</span>{" "}
                        <span className="font-mono text-emerald-300">
                          {intentVal}
                        </span>
                      </div>
                      <pre className="bg-slate-950 p-2 rounded text-[10px] text-slate-300 overflow-x-auto font-mono">
                        {typeof msg.plan.query === "string"
                          ? msg.plan.query
                          : JSON.stringify(msg.plan.query, null, 2)}
                      </pre>
                    </div>
                  </details>
                )}

                {/* Data table (assistant) with source */}
                {msg.data && msg.data.columns && (
                  <div className="bg-slate-900/90 border border-slate-700/80 rounded-lg p-2 text-[11px] overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] uppercase font-semibold text-slate-400">
                            {msg.data.columns.map((col, idx) => (
                              <th key={idx} className="py-1 px-1.5">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {msg.data.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  className="py-1 px-1.5 font-mono text-[10px] text-slate-200"
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
                      <div className="text-[9px] text-slate-400 mt-1.5 pt-1 border-t border-slate-800">
                        Fuente: {msg.data.source}
                      </div>
                    )}
                  </div>
                )}

                {/* Message text with Markdown */}
                {msg.content && (
                  <div className="prose prose-invert prose-xs max-w-none leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                )}

                {/* Degraded fallback note */}
                {msg.degraded && (
                  <div className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/80 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                    <span className="text-amber-400">⚠️</span>
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
                        ? "text-amber-200 bg-amber-950/70 border border-amber-800/80"
                        : "text-rose-300 bg-rose-950/60 border border-rose-800/80"
                    }`}
                  >
                    <span
                      className={
                        msg.error.includes("Demasiadas") || msg.error.includes("demasiado larga")
                          ? "text-amber-400"
                          : "text-rose-400 font-bold"
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
            </div>
          );
        })}
        {isStreaming && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400 pl-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Generando análisis...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Query Chips */}
      <div className="mt-3 pt-2 border-t border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
            Sugerencias de consulta
          </span>
          {messages.length > 2 && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[10px] text-slate-400 hover:text-white"
            >
              Limpiar chat
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((q, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSend(q)}
              disabled={isStreaming}
              className="text-[11px] text-left px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Input box & Stop Button */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregunta sobre participación, factores o escenarios..."
          disabled={isStreaming}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 shadow-inner"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={handleStop}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 font-bold text-white text-xs rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
          >
            <span className="w-2 h-2 rounded-xs bg-white"></span>
            <span>Detener</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 font-bold text-white text-xs rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
          >
            <span>Enviar</span>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
