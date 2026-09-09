/**
 * POST /api/admin/ai/text — the admin's general-purpose AI text generator.
 * Behind requireAdmin, rate-limited 30/hour per admin (same per-IP bucket
 * idiom as POST /api/admin/mail/test — this shop has exactly one admin
 * session at a time, so per-IP is per-session here).
 *
 *   { task: "describe"|"translate"|"seo"|"reply"|"blog_outline"|"post_full"|"post_translate"|"copy",
 *     lang: "RU"|"ET"|"EN", input: {...} }
 *   → { ok: true, text: ... }              (describe, seo, reply, blog_outline, post_full, post_translate, copy)
 *   → { ok: true, texts: { RU?, ET?, EN? } } (translate)
 *
 * "seo" takes two input shapes — `{kind:"product", name, brand, category}`
 * from the goods editor and `{kind:"post", title, excerpt, body, tags,
 * products}` from the blog editor (the article's own text, see SeoInput in
 * src/lib/ai-prompts.ts) — and answers the same `{title, description}` for
 * both, in `lang`, capped here at what the two editors store (70/170).
 *
 * "post_full" writes a whole article for a topic — title, excerpt, 600–900
 * words of HTML, tags, the Google pair, the products it mentions — offered
 * the slice of the catalogue that fits the topic (src/lib/catalogue-slice.ts)
 * and allowed to name nothing else; the body comes back through the blog's
 * own sanitizeHtml(), so what is stored is what the shop can show. The
 * article also places its own product cards in the body, as the editor's
 * «Товар» marker — and both the ids it lists and the ids it placed are
 * filtered here against the slice it was offered (keepKnownCards below), so
 * no card can point at a product that does not exist.
 * "post_translate" carries that article (or the owner's own) into another
 * language, tags kept in place. "copy" is the short text behind every «✨»
 * button in the panel (banner slide, announcement strip, contact page,
 * letter footer, promo note, product name) — one task, one `kind`.
 *
 * Same model/env as src/app/api/assistant/route.ts (OPENAI_MODEL, a plain
 * fetch to the chat-completions endpoint, `response_format: json_object`),
 * temperature 0.4. max_tokens is per task (MAX_TOKENS below): 900 for the
 * short ones, enough for a whole article for post_full/post_translate. The
 * answer is read through src/lib/ai-json.ts, so a fenced or a cut document
 * is still an answer — a cut article, though, is refused as `truncated`
 * rather than saved half-written. The prompt itself (house voice, the
 * "never invent a fact" rule, per-task JSON contract) lives in
 * src/lib/ai-prompts.ts and is unit-tested there without touching the
 * network.
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
import { AiInputError, buildPrompt, isAiTask, LANGS3, POST_PRODUCTS_MAX, type AiTask, type Lang3 } from "@/lib/ai-prompts";
import { extractJsonObject } from "@/lib/ai-json";
import { relevantProducts } from "@/lib/catalogue-slice";
import { sanitizeHtml } from "@/lib/blog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
/* Per task: 900 was the one number every task shared, and it is still what
   the short ones get. A whole article is 600–900 words of HTML in Russian —
   about 2 500 tokens as gpt-4.1-mini counts them — so post_full and its
   translation get room for that plus the fields around it, and are refused
   as `truncated` (never saved half-written) if they still run out. */
const MAX_TOKENS: Record<AiTask, number> = {
  describe: 900, translate: 900, seo: 900, reply: 900, blog_outline: 900,
  post_full: 4500, post_translate: 4500, copy: 400,
};
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
  if (task === "post_full" || task === "post_translate") {
    const tags = Array.isArray(p.tags)
      ? p.tags.map((t) => str(t, 30).toLowerCase()).filter(Boolean).slice(0, 5)
      : [];
    const out: Record<string, unknown> = {
      title: str(p.title, 200),
      excerpt: str(p.excerpt, 500),
      // the blog's own allowlist (p h2 h3 strong em ul ol li …) — the model
      // was told the tags it may use, and this is what makes that true
      body: sanitizeHtml(str(p.body, 20_000)),
      tags,
      seo: { title: str(p.seoTitle, 70), description: str(p.seoDescription ?? p.seoDesc, 170) },
    };
    if (task === "post_full") {
      out.products = Array.isArray(p.products)
        ? p.products.map((id) => str(id, 80)).filter((id) => /^[a-z0-9][a-z0-9-]*$/.test(id)).slice(0, POST_PRODUCTS_MAX)
        : [];
    }
    return { text: out };
  }
  if (task === "copy") {
    return {
      text: {
        text: str(p.text, 1200),
        short: str(p.short, 120),
        eyebrow: str(p.eyebrow, 40),
        title: str(p.title, 40),
        sub: str(p.sub, 90),
        cta: str(p.cta, 24),
        name: str(p.name, 120),
      },
    };
  }
  void lang;
  return {};
}

/* The product cards the article placed in its own body, held to the same
   list its `products` is held to.
 *
 * The card is an `<a data-product="ID">` — the editor's own «Товар» marker,
 * which the storefront swaps for a real card by looking the id up in the
 * catalogue. So an id the model invented is not a wrong card, it is no card
 * at all plus a dead link in a published article, and the owner would have
 * to find it by reading. It never leaves this route: the attribute goes and
 * the sanitiser is run again, which unwraps the now-bare `<a>` and keeps
 * whatever words were inside it.
 *
 * Runs over the already-sanitised body, where every `<a>` is exactly what
 * openTag() in src/lib/blog.ts wrote — `data-product` first, one space, one
 * pair of double quotes — so this pattern cannot match anything but a tag,
 * text having lost its `<` to escapeText() long before. */
function keepKnownCards(html: string, allowed: Set<string>): string {
  if (!html.includes("data-product")) return html;
  const kept = html.replace(/<a data-product="([^"]*)"/g, (m, id: string) => (allowed.has(id) ? m : "<a"));
  return kept === html ? html : sanitizeHtml(kept);
}

/* post_full: the products the article may mention. The panel may name a
   few itself (the editor's own «Товары в статье»); the rest of the slice
   comes from the catalogue file by topic, so the model always has a short,
   relevant list — and its answer's `products` is filtered against exactly
   that list, never anything it made up. */
function postFullInput(raw: unknown): { input: Record<string, unknown>; allowed: Set<string> } {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const topic = typeof src.topic === "string" ? src.topic : "";
  const given = Array.isArray(src.products) ? src.products : [];
  const refs: Array<{ id: string; brand: string; name: string; category: string }> = [];
  const seen = new Set<string>();
  for (const item of given) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    refs.push({ id, brand: str(o.brand, 60), name: str(o.name, 140), category: str(o.category, 40) });
    if (refs.length >= POST_PRODUCTS_MAX) break;
  }
  for (const p of relevantProducts(topic, { limit: POST_PRODUCTS_MAX, fill: 8 })) {
    if (refs.length >= POST_PRODUCTS_MAX) break;
    if (seen.has(p.id) || p.s === "out") continue;
    seen.add(p.id);
    refs.push({ id: p.id, brand: p.b, name: p.n, category: p.c });
  }
  return { input: { ...src, products: refs }, allowed: seen };
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

  // post_full: the catalogue slice rides in with the topic — see postFullInput()
  const post = task === "post_full" ? postFullInput(body.input) : null;
  const input = post ? post.input : body.input;

  let prompt: { system: string; user: string };
  try {
    prompt = buildPrompt(task, lang, input);
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
        max_tokens: MAX_TOKENS[task],
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

  /* A 200 whose body is not JSON — a proxy's HTML error page, a truncated
     stream — used to throw out of the handler and leave Next to answer with
     an opaque 500 that the panel could only call «не получилось». Same door
     as the !r.ok branch above: an upstream that did not answer properly. */
  const data = await r.json().catch(() => null);
  if (!data || typeof data !== "object") {
    console.error("[admin/ai/text] openai returned a body that is not JSON", task);
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502 });
  }
  const choice = data.choices?.[0] ?? {};
  const extracted = extractJsonObject(choice.message?.content, { finishReason: choice.finish_reason });
  const parsed: unknown = extracted.value ?? {};
  if (!extracted.value) console.error("[admin/ai/text] model did not return valid JSON", task);
  /* A cut article is not an article: the editor would show a piece that
     stops mid-sentence and the owner would publish it. Refused here, with
     its own code, so the panel can say «попробуйте ещё раз» and mean it. */
  if ((task === "post_full" || task === "post_translate") && (extracted.truncated || !extracted.value)) {
    console.error("[admin/ai/text] article cut or unreadable", task, choice.finish_reason);
    return NextResponse.json({ ok: false, error: "truncated" }, { status: 502 });
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
    if (post && result.text && typeof result.text === "object") {
      const t = result.text as Record<string, unknown>;
      t.products = (t.products as string[]).filter((id) => post.allowed.has(id));
      t.body = keepKnownCards(String(t.body ?? ""), post.allowed);
    }
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
