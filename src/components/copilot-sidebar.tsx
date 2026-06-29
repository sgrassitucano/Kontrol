"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, X, Loader2, Bot, User, Sparkles } from "lucide-react";

type Message = {
  role: "user" | "model";
  content: string;
};

type CopilotSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function CopilotSidebar({ isOpen, onClose }: CopilotSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "model",
      content: "Ciao! Sono l'assistente virtuale di KONTROL. Posso aiutarti a cercare lavoratori, verificare scadenze dei corsi, turni o lo stato di assegnazione dei mezzi. Chiedimi pure!",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Forza lo scroll automatico all'ultimo messaggio
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  if (!isOpen) return null;

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || isLoading) return;

    const userMessage: Message = { role: "user", content: text };
    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Inviamo gli ultimi 10 messaggi della conversazione per mantenere il contesto
          messages: [...messages.slice(-10), userMessage],
        }),
      });

      if (!response.ok) {
        throw new Error("Impossibile connettersi all'assistente.");
      }

      const body = await response.json();
      if (body.error) {
        throw new Error(body.error);
      }

      setMessages(prev => [...prev, { role: "model", content: body.text }]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: "model",
          content: err instanceof Error ? err.message : "Errore temporaneo. Riprova tra qualche istante.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-xs">
      {/* Sfondo cliccabile per chiudere */}
      <div className="flex-1" onClick={onClose} />

      {/* Pannello Chat */}
      <aside className="flex h-full w-full flex-col border-l border-[var(--brand-line)] bg-white shadow-2xl transition-all sm:max-w-md">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--brand-line)] bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--brand-ink)]">KONTROL Copilot</h3>
              <p className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Assistente AI (Free Tier)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Zona Messaggi */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, idx) => {
            const isBot = msg.role === "model";
            return (
              <div
                key={idx}
                className={["flex gap-2.5 max-w-[85%]", isBot ? "self-start" : "ml-auto flex-row-reverse"].join(" ")}
              >
                {/* Icona Profilo */}
                <div
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                    isBot ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200" : "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
                  ].join(" ")}
                >
                  {isBot ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>

                {/* Testo Messaggio */}
                <div
                  className={[
                    "rounded-xl px-3.5 py-2.5 text-xs leading-relaxed shadow-xs border",
                    isBot 
                      ? "bg-slate-50 border-slate-200 text-slate-800" 
                      : "bg-[var(--brand-primary)] border-[var(--brand-primary)] text-white",
                  ].join(" ")}
                >
                  {/* Rendering semplice del Markdown per elenchi puntati e grassetti */}
                  <div className="space-y-1.5 whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Animazione Caricamento */}
          {isLoading && (
            <div className="flex gap-2.5 max-w-[85%] self-start">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500 italic flex items-center gap-1.5 shadow-xs">
                Sta analizzando il database...
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Invio */}
        <form
          onSubmit={handleSendMessage}
          className="border-t border-[var(--brand-line)] bg-slate-50 p-3 flex items-center gap-2"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
            placeholder="Chiedi al Copilot (es. chi ha corsi scaduti?)..."
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-[var(--brand-ink)] focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </aside>
    </div>
  );
}
