"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Tower from "@/components/Tower";
import { SECTIONS, TOTAL_QUESTIONS, type Question } from "@/data/questions";

interface Answer {
  sel: string[];
  text: string;
}

type Answers = Record<string, Answer>;

const STORAGE_KEY = "rempire-qa-v1";
const MAIL_TO = "dim.novare@gmail.com";

const EMPTY: Answer = { sel: [], text: "" };

function isAnswered(q: Question, a: Answer | undefined): boolean {
  if (!a) return false;
  if (q.type === "text") return a.text.trim().length > 0;
  return a.sel.length > 0 || a.text.trim().length > 0;
}

export default function QaForm() {
  const [answers, setAnswers] = useState<Answers>({});
  const [hydrated, setHydrated] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setAnswers(JSON.parse(raw) as Answers);
    } catch {
      // приватный режим / отключённое хранилище — работаем без сохранения
    }
    setCanShare(typeof navigator !== "undefined" && !!navigator.share);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
    } catch {
      // ignore
    }
  }, [answers, hydrated]);

  const numbered = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const s of SECTIONS) for (const q of s.questions) map.set(q.id, ++n);
    return map;
  }, []);

  const answeredCount = useMemo(() => {
    let n = 0;
    for (const s of SECTIONS)
      for (const q of s.questions) if (isAnswered(q, answers[q.id])) n++;
    return n;
  }, [answers]);

  const get = (id: string): Answer => answers[id] ?? EMPTY;

  const toggle = (q: Question, opt: string) => {
    setAnswers((prev) => {
      const a = prev[q.id] ?? EMPTY;
      let sel: string[];
      if (q.type === "single") {
        sel = a.sel[0] === opt ? [] : [opt];
      } else {
        sel = a.sel.includes(opt)
          ? a.sel.filter((o) => o !== opt)
          : [...a.sel, opt];
      }
      return { ...prev, [q.id]: { ...a, sel } };
    });
  };

  const setText = (id: string, text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY), text },
    }));
  };

  const buildSummary = (): string => {
    const lines: string[] = ["REMPIRE — ответы на вопросы", ""];
    for (const s of SECTIONS) {
      lines.push(`${s.letter}. ${s.title.toUpperCase()}`);
      for (const q of s.questions) {
        const a = get(q.id);
        lines.push(`${numbered.get(q.id)}. ${q.title}`);
        const parts: string[] = [];
        if (a.sel.length) parts.push(a.sel.join("; "));
        if (a.text.trim()) parts.push(a.text.trim());
        lines.push(`→ ${parts.length ? parts.join(" · ") : "—"}`);
        lines.push("");
      }
    }
    lines.push(`Отвечено: ${answeredCount} из ${TOTAL_QUESTIONS}`);
    return lines.join("\n");
  };

  const handleShare = async () => {
    try {
      await navigator.share({
        title: "REMPIRE — ответы",
        text: buildSummary(),
      });
    } catch {
      // пользователь закрыл шэринг — не ошибка
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildSummary());
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard заблокирован — предложим email
    }
  };

  const handleMail = () => {
    const subject = encodeURIComponent("REMPIRE — ответы на вопросы");
    const body = encodeURIComponent(buildSummary());
    window.location.href = `mailto:${MAIL_TO}?subject=${subject}&body=${body}`;
  };

  const handleReset = () => {
    if (!window.confirm("Точно стереть все ответы и начать заново?")) return;
    setAnswers({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    window.scrollTo({ top: 0 });
  };

  const progress = (answeredCount / TOTAL_QUESTIONS) * 100;

  return (
    <div className="min-h-svh">
      {/* progress */}
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-30 h-[3px] bg-mist"
      >
        <div
          className="h-full bg-ink transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* sticky header */}
      <header className="sticky top-[3px] z-20 border-b border-mist bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <a href="#top" className="flex items-center gap-2.5">
            <Tower className="h-7 w-auto" />
            <span className="font-display text-lg uppercase tracking-[0.22em]">
              Rempire
            </span>
          </a>
          <span
            className="text-sm tabular-nums text-fog"
            aria-label={`Отвечено ${answeredCount} из ${TOTAL_QUESTIONS}`}
          >
            {answeredCount} / {TOTAL_QUESTIONS}
          </span>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-2xl px-5 pb-24">
        {/* intro */}
        <section className="pb-4 pt-12 sm:pt-16">
          <Tower className="h-20 w-auto" />
          <h1 className="mt-6 font-display text-4xl uppercase leading-none tracking-[0.18em] sm:text-5xl">
            Rempire
          </h1>
          <p className="mt-2 font-display text-base uppercase tracking-[0.3em] text-fog">
            Новый интернет-магазин
          </p>
          <p className="mt-6 text-lg leading-relaxed">
            Мы переносим rempireshop.com со Shopify на собственную платформу —
            быстрее, без ежемесячной аренды и с админкой, собранной под то, как
            ты реально работаешь. Чтобы построить правильно, ответь на вопросы
            ниже.
          </p>
          <p className="mt-3 text-base leading-relaxed text-fog">
            Отвечай коротко и своими словами, можно пропускать. Ответы
            сохраняются сами — можно закрыть и вернуться позже. В конце одна
            кнопка «Поделиться» — и всё улетит Диме.
          </p>
          <p className="mt-5 border-l-2 border-ink pl-4 text-sm uppercase tracking-widest text-fog">
            22 вопроса · ≈10 минут
          </p>
        </section>

        {/* sections */}
        {SECTIONS.map((s) => (
          <section key={s.id} aria-labelledby={`s-${s.id}`} className="mt-14">
            <div className="border-t-2 border-ink pt-4">
              <h2
                id={`s-${s.id}`}
                className="font-display text-xl font-bold uppercase tracking-[0.2em]"
              >
                {s.letter} — {s.title}
              </h2>
            </div>

            {s.questions.map((q) => {
              const a = get(q.id);
              const done = isAnswered(q, a);
              return (
                <div key={q.id} className="mt-10">
                  <h3
                    id={`${q.id}-label`}
                    className="flex items-baseline gap-3 text-lg font-semibold leading-snug"
                  >
                    <span
                      className={`font-display text-base tabular-nums tracking-wider ${done ? "text-ink" : "text-fog"}`}
                    >
                      {String(numbered.get(q.id)).padStart(2, "0")}
                    </span>
                    <span>{q.title}</span>
                  </h3>
                  {q.hint && (
                    <p className="mt-1.5 pl-9 text-sm leading-relaxed text-fog">
                      {q.hint}
                    </p>
                  )}

                  <div className="mt-4 pl-9">
                    {q.options && (
                      <div
                        role="group"
                        aria-labelledby={`${q.id}-label`}
                        className="flex flex-wrap gap-2"
                      >
                        {q.options.map((opt) => {
                          const on = a.sel.includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggle(q, opt)}
                              className={`min-h-12 rounded border-2 border-ink px-4 py-2.5 text-left text-base leading-snug transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                                on
                                  ? "bg-ink text-paper"
                                  : "bg-transparent hover:bg-mist"
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {(q.type === "text" || q.extraLabel) && (
                      <div className={q.options ? "mt-3" : ""}>
                        {q.extraLabel && (
                          <label
                            htmlFor={`${q.id}-text`}
                            className="mb-1.5 block text-sm text-fog"
                          >
                            {q.extraLabel}
                          </label>
                        )}
                        <textarea
                          id={`${q.id}-text`}
                          aria-labelledby={
                            q.extraLabel ? undefined : `${q.id}-label`
                          }
                          value={a.text}
                          onChange={(e) => setText(q.id, e.target.value)}
                          placeholder={q.placeholder}
                          rows={q.type === "text" ? 3 : 2}
                          className="w-full rounded border-2 border-ink bg-transparent p-3 text-base leading-relaxed placeholder:text-fog/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}

        {/* send */}
        <section className="mt-16 rounded-lg bg-ink p-6 text-paper sm:p-8">
          <h2 className="font-display text-2xl font-bold uppercase tracking-[0.2em]">
            Готово?
          </h2>
          <p className="mt-3 leading-relaxed">
            Нажми «Поделиться» и выбери WhatsApp или Telegram — ответы улетят
            Диме одним сообщением. Неотвеченные вопросы уйдут с прочерком, это
            нормально.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {canShare && (
              <button
                type="button"
                onClick={handleShare}
                className="min-h-12 rounded bg-paper px-6 py-3 font-display text-base font-bold uppercase tracking-[0.15em] text-ink transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
              >
                Поделиться
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="min-h-12 rounded border-2 border-paper px-6 py-3 font-display text-base font-bold uppercase tracking-[0.15em] transition-colors hover:bg-paper/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            >
              {copied ? "Скопировано ✓" : "Скопировать"}
            </button>
            <button
              type="button"
              onClick={handleMail}
              className="min-h-12 rounded border-2 border-paper px-6 py-3 font-display text-base font-bold uppercase tracking-[0.15em] transition-colors hover:bg-paper/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            >
              Email
            </button>
          </div>
          <p className="mt-4 text-sm text-paper/70">
            Отвечено {answeredCount} из {TOTAL_QUESTIONS}. Можно отправить и
            частично — остальное обсудим голосом.
          </p>
        </section>

        {/* footer */}
        <footer className="mt-16 flex items-center justify-between border-t border-mist pt-6 text-sm text-fog">
          <span className="flex items-center gap-2">
            <Tower className="h-5 w-auto" />
            REMPIRE · rempireshop.com
          </span>
          <button
            type="button"
            onClick={handleReset}
            className="underline underline-offset-4 hover:text-ink"
          >
            Начать заново
          </button>
        </footer>
      </main>
    </div>
  );
}
