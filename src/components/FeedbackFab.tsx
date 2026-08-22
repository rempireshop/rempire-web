"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Floating comment button for Next pages (the /demo hub) — React twin of
 * public/feedback.js. Renat taps 💬, optionally rates + picks a section
 * (sections are any elements with a data-fb="Название" attribute on the
 * page), writes a note, sends. Lands in Telegram/email/Blob via
 * POST /api/feedback/ (trailing slash — next.config uses trailingSlash).
 */

type Mood = "good" | "bad" | "change";

const MOODS: Array<{ id: Mood; label: string }> = [
  { id: "good", label: "Нравится" },
  { id: "bad", label: "Не нравится" },
  { id: "change", label: "Изменить" },
];

export interface FeedbackFabProps {
  /** что подставить в поле page (обычно pathname страницы) */
  page: string;
}

export default function FeedbackFab({ page }: FeedbackFabProps) {
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState<Mood | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [section, setSection] = useState("");
  const [text, setText] = useState("");
  const [sendState, setSendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // собрать секции страницы один раз при монтировании
  useEffect(() => {
    try {
      const found: string[] = [];
      document.querySelectorAll("[data-fb]").forEach((el) => {
        const v = el.getAttribute("data-fb")?.trim();
        if (v && !found.includes(v)) found.push(v);
      });
      setSections(found);
    } catch {
      // страница без секций — работаем без селекта
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const reset = () => {
    setMood(null);
    setSection("");
    setText("");
    setSendState("idle");
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sendState === "sending") return;
    setSendState("sending");
    try {
      // trailing slash matches next.config trailingSlash — avoids a 308 hop
      const res = await fetch("/api/feedback/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page,
          section: section || undefined,
          mood: mood ?? undefined,
          text: trimmed,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSendState("sent");
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
        setOpen(false);
        reset();
      }, 1800);
    } catch {
      setSendState("error");
    }
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-20 left-3.5 z-[99999] w-[min(340px,calc(100vw-28px))] rounded border-2 border-ink bg-paper p-4 text-ink">
          {sendState === "sent" ? (
            <p className="py-4 text-center font-display text-base font-bold uppercase tracking-[0.1em]">
              Отправлено ✓ Спасибо!
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">
                  Комментарий
                </h2>
                <button
                  type="button"
                  aria-label="Закрыть"
                  onClick={() => setOpen(false)}
                  className="p-1 leading-none hover:text-fog focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {MOODS.map((m) => {
                  const on = mood === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setMood(on ? null : m.id)}
                      className={`rounded border-2 border-ink px-3 py-1.5 text-sm leading-snug transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                        on ? "bg-ink text-paper" : "bg-transparent hover:bg-mist"
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {sections.length > 0 && (
                <select
                  aria-label="Указать место"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="mt-2.5 w-full rounded border-2 border-ink bg-transparent p-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <option value="">Указать место — вся страница</option>
                  {sections.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Что думаешь? Можно коротко."
                rows={3}
                className="mt-2.5 min-h-[84px] w-full rounded border-2 border-ink bg-transparent p-3 text-base leading-relaxed placeholder:text-fog/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              />

              {sendState === "error" && (
                <p className="mt-1 text-xs text-[#8c1a0f]">
                  Не отправилось — попробуй ещё раз
                </p>
              )}

              <button
                type="button"
                onClick={handleSend}
                disabled={sendState === "sending" || !text.trim()}
                className="mt-2.5 min-h-12 w-full rounded bg-ink px-4 py-2.5 font-display text-base font-bold uppercase tracking-[0.15em] text-paper transition-opacity hover:opacity-85 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {sendState === "sending" ? "Отправляю…" : "Отправить"}
              </button>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        title="Оставить комментарий"
        aria-label="Оставить комментарий"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            if (sendState === "sent") reset();
            setOpen(true);
          }
        }}
        className="fixed bottom-3.5 left-3.5 z-[99999] flex h-13 w-13 items-center justify-center rounded-full bg-ink text-[22px] leading-none text-paper shadow-[0_6px_20px_rgba(28,26,0,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        💬
      </button>
    </>
  );
}
