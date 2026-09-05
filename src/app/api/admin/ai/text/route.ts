/**
 * POST /api/admin/ai/text — the admin's general-purpose AI text generator.
 * Behind requireAdmin, rate-limited 30/hour per admin (same per-IP bucket
 * idiom as POST /api/admin/mail/test — this shop has exactly one admin
 * session at a time, so per-IP is per-session here).
 *
 *   { task: "describe"|"translate"|"seo"|"reply"|"blog_outline",
 *     lang: "RU"|"ET"|"EN", input: {...} }
 *   → { ok: true, text: ... }              (describe, seo, reply, blog_outline)
 *   → { ok: true, texts: { RU?, ET?, EN? } } (translate)
 *
 * "seo" takes two input shapes — `{kind:"product", name, brand, category}`
 * from the goods editor and `{kind:"post", title, excerpt, body, tags,
 * products}` from the blog editor (the article's own text, see SeoInput in
 * src/lib/ai-prompts.ts) — and answers the same `{title, description}` for
 * both, in `lang`, capped here at what the two editors store (70/170).
 *
 * Same model/env as src/app/api/assistant/route.ts (OPENAI_MODEL, a plain
 * fetch to the chat-completions endpoint, `response_format: json_object`),
 * temperature 0.4, max_tokens 900 — fixed by the task brief, not per-task.
 * The prompt itself (house voice, the "never invent a fact" rule, per-task
 * JSON contract) lives in src/lib/ai-prompts.ts and is unit-tested there
 * without touching the network.
 *
 * "reply" is the one task whose output is not purely the model's own words:
 * the shop signature is appended here, deterministically, from
 * settings.content (src/lib/content.ts) — never written by the model, so it
 * can never be a fact the model invented.
 *
 * Every call is logged to admin_audit as "ai.text" with the task and the
 * token usage OpenAI reports, so cost is auditable from the same journal
 * every other admin action lands in.
 */
import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { getSettings, writeAuditSafe } from "@/lib/orders";
import { mergeContent, pickLang, type ShopContent } from "@/lib/content";
import { AiInputError, buildPrompt, isAiTask, LANGS3, type Lang3 } from "@/lib/ai-prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const MAX_TOKENS = 900;
const TEMPERATURE = 0.4;
const RATE_MAX = 30;
const RATE_WINDOW_MS = 3_600_000;
/* The biggest honest body is a "translate" of 6 000 characters or a blog
   article of which only the first 1 500 reach the model (src/lib/ai-prompts.ts
   caps every field). Anything past this is read as text and refused before
   it is parsed — the same door src/app/api/orders/route.ts uses. */
const MAX_BYTES = 128_000;

function isLang3(v: unknown): v is Lang3 {
  return typeof v === "string" && (LANGS3 as readonly string[]).includes(v);
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

const SIGNOFF: Record<Lang3, string> = {
  RU: "— Команда Rempire",
  ET: "— Rempire meeskond",
  EN: "— The Rempire team",
};

/** Appended to every "reply" draft — company contact + the owner's own footer line, never model text. */
function buildSignature(content: ShopContent, lang: Lang3): string {
  const lines = [SIGNOFF[lang] || SIGNOFF.RU];
  const contact = [content.company.phone, content.company.email].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);
  const footer = pickLang(content.emailFooter, lang);
  if (footer) lines.push(footer);
  return lines.join("\n");
}

/** Model JSON → the shape this task promises, nothing the model wrote left unbounded. */
function shapeNonReply(task: string, lang: Lang3, parsed: unknown): { text?: unknown; texts?: unknown } {
  const p = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  if (task === "describe") {
    const bullets = Array.isArray(p.bullets)
      ? p.bullets.map((b) => str(b, 160)).filter(Boolean).slice(0, 3)
      : [];
    return { text: { description: str(p.description, 1400), bullets } };
  }
  if (task === "seo") {
    return { text: { title: str(p.title, 70), description: str(p.description, 170) } };
  }
  if (task === "blog_outline") {
    const h2 = Array.isArray(p.h2) ? p.h2.map((h) => str(h, 80)).filter(Boolean).slice(0, 8) : [];
    return {
      text: {
        title: str(p.title, 90),
        h2,
        meta: { title: str(p.metaTitle, 70), description: str(p.metaDescription, 170) },
      },
    };
  }
  if (task === "translate") {
    const texts: Partial<Record<Lang3, string>> = {};
    for (const l of LANGS3) if (typeof p[l] === "string") texts[l] = str(p[l], 6000);
    return { texts };
  }
  void lang;
  return {};
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  if (rateLimit("ai-text", clientIp(req), RATE_MAX, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  }
  let body: { task?: unknown; lang?: unknown; input?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  if (!isAiTask(body.task)) {
    return NextResponse.json({ ok: false, error: "bad_task" }, { status: 400 });
  }
  const task = body.task;
  const lang: Lang3 = isLang3(body.lang) ? body.lang : "RU";

  let prompt: { system: string; user: string };
  try {
    prompt = buildPrompt(task, lang, body.input);
  } catch (err) {
    const code = err instanceof AiInputError ? err.code : "bad_input";
    return NextResponse.json({ ok: false, error: code }, { status: 400 });
  }

  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    });
  } catch (err) {
    console.error("[admin/ai/text] openai fetch failed", err);
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502 });
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error("[admin/ai/text] openai error", task, r.status, detail.slice(0, 300));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502 });
  }

  const data = await r.json();
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  } catch {
    console.error("[admin/ai/text] model did not return valid JSON", task);
  }

  let result: { text?: unknown; texts?: unknown };
  if (task === "reply") {
    const p = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const replyText = str(p.reply, 4000);
    let signature = "";
    try {
      const settings = await getSettings();
      signature = buildSignature(mergeContent(settings.content), lang);
    } catch (err) {
      console.error("[admin/ai/text] signature lookup failed", err);
    }
    result = { text: signature ? `${replyText}\n\n${signature}` : replyText };
  } else {
    result = shapeNonReply(task, lang, parsed);
  }

  const usage = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  await writeAuditSafe("admin", "ai.text", {
    task,
    lang,
    model: data.model ?? MODEL,
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  });

  return NextResponse.json({ ok: true, ...result, model: data.model ?? MODEL });
}

export function GET(): Response {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
