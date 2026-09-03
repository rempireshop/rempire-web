/**
 * Prompt builders for POST /api/admin/ai/text — pure functions, no network,
 * no database, so the "no invented facts" rule and the JSON contract each
 * task promises can be tested without mocking OpenAI (tests/ai-prompts.test.ts).
 *
 * Every task shares one house-voice preamble (HOUSE_VOICE) and asks the model
 * for a small, task-specific JSON object — the route parses it with
 * `response_format: {type:"json_object"}`, same as src/app/api/assistant/route.ts.
 *
 * Nothing here calls fetch or touches OPENAI_API_KEY; the route
 * (src/app/api/admin/ai/text/route.ts) owns the actual call.
 */

export const AI_TASKS = ["describe", "translate", "seo", "reply", "blog_outline"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const LANGS3 = ["RU", "ET", "EN"] as const;
export type Lang3 = (typeof LANGS3)[number];

export class AiInputError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export interface PromptResult {
  system: string;
  user: string;
}

const LANG_NAME: Record<Lang3, string> = { RU: "Russian", ET: "Estonian", EN: "English" };

function isLang3(v: unknown): v is Lang3 {
  return typeof v === "string" && (LANGS3 as readonly string[]).includes(v);
}

/** One line, control characters gone, trimmed, capped — never raw into a prompt. */
function line(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A short paragraph — newlines kept, still capped and control-character free. */
function para(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (ch) => (ch === "\n" ? "\n" : " "))
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function listOf(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const t = line(raw, maxLen);
    if (t) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

/* ---------- the shared voice ---------------------------------------------- */

export const HOUSE_VOICE = `You are the in-house copywriter for REMPIRE, a premium men's grooming e-shop run by the Rempire barbershop in Tallinn, Estonia (Mardi 1). The audience is men buying hair, beard, face, body and styling care, and fragrance.

Voice: a good barber's own recommendation — confident, concrete, warm, never hype. No exclamation marks. No invented superlatives ("the best", "revolutionary", "miracle", "guaranteed").

Absolute rules, in order of importance:
1. Use ONLY the facts given to you below under INPUT. Never invent a fact, ingredient, benefit, award, certification, price, size, origin or claim that is not present in INPUT. If INPUT is thin, write a shorter, plainer text — never pad it with an invented specific.
2. Never make a medical, therapeutic or health claim: no "cures", "treats", "heals", "clinically proven", "dermatologist recommended" — unless that exact wording is itself given to you in INPUT.
3. Brand names and product names are copied exactly as given, unchanged, in Latin script, in every language — never translated, transliterated or re-cased.
4. Estonian is written informally, addressing the reader as "sina" (never the formal "teie"), in the register of tradehouse.ee / kaubamaja.ee — plain, direct, never stiff or bureaucratic. Estonian quotation marks are „…" (never «…» or "…"). Money as "12,90 €" (comma decimal, space before €); units as "50 ml", "2 tk" (space before the unit).
5. English is UK/EU e-shop English: "Cart" not "Basket", "Delivery" not "Shipping", British/EU spelling (colour, personalise, litre). Money as "€12.90" (period decimal, € prefix, no space); units as "50 ml", "2 pcs".
6. Russian is the shop's own plain, warm, informal retail Russian — never corporate or bureaucratic ("Уважаемый клиент" does not belong here).
7. Output ONLY the JSON object described for this task. No markdown code fences, no commentary before or after it.`;

/* ---------- describe -------------------------------------------------------
 * product name, brand, category, size list, optional bullet facts
 * → 80–140-word description + 3 bullets, in `lang`. */

export interface DescribeInput {
  name: string;
  brand?: string;
  category?: string;
  sizes?: string[];
  facts?: string[];
}

function cleanDescribeInput(raw: unknown): Required<Omit<DescribeInput, "sizes" | "facts">> & {
  sizes: string[];
  facts: string[];
} {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = line(src.name, 140);
  if (!name) throw new AiInputError("missing_name");
  return {
    name,
    brand: line(src.brand, 60),
    category: line(src.category, 60),
    sizes: listOf(src.sizes, 12, 30),
    facts: listOf(src.facts, 10, 200),
  };
}

export function buildDescribePrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanDescribeInput(rawInput);
  const facts = [
    `Product name: ${input.name}`,
    input.brand ? `Brand: ${input.brand}` : "",
    input.category ? `Category: ${input.category}` : "",
    input.sizes.length ? `Sizes available: ${input.sizes.join(", ")}` : "",
    input.facts.length ? `Facts to work from, use only these, do not add more:\n- ${input.facts.join("\n- ")}` : "",
  ].filter(Boolean).join("\n");

  const system = `${HOUSE_VOICE}

TASK: write a product-page description from the facts under INPUT, in ${LANG_NAME[lang]}.
- "description": 80–140 words, one to three short paragraphs, no headings, no bullet points inside it.
- "bullets": exactly 3 short bullet phrases (each under 12 words), the three most useful facts from INPUT for someone deciding whether to buy — not a repeat of the description sentence by sentence.
Respond with exactly this JSON shape and nothing else: {"description": "...", "bullets": ["...", "...", "..."]}`;

  return { system, user: `INPUT:\n${facts}` };
}

/* ---------- translate ------------------------------------------------------
 * source text (in `sourceLang`, default `lang`) → the requested target
 * languages, keeping brand/product names and the ml/tk/€ formatting rules
 * from docs/proofread-report.md (folded into HOUSE_VOICE above). */

export interface TranslateInput {
  text: string;
  targetLangs: Lang3[];
  sourceLang?: Lang3;
  /** Product/brand names that must survive untranslated even mid-sentence. */
  keepNames?: string[];
}

function cleanTranslateInput(
  raw: unknown,
  fallbackSourceLang: Lang3,
): { text: string; targetLangs: Lang3[]; sourceLang: Lang3; keepNames: string[] } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = para(src.text, 6000);
  if (!text) throw new AiInputError("missing_text");
  const targets = Array.isArray(src.targetLangs) ? src.targetLangs.filter(isLang3) : [];
  const sourceLang = isLang3(src.sourceLang) ? src.sourceLang : fallbackSourceLang;
  const targetLangs = [...new Set(targets)].filter((l) => l !== sourceLang);
  if (!targetLangs.length) throw new AiInputError("missing_target_langs");
  return { text, targetLangs, sourceLang, keepNames: listOf(src.keepNames, 20, 80) };
}

export function buildTranslatePrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanTranslateInput(rawInput, lang);
  const keep = input.keepNames.length
    ? `\nNames that must appear unchanged in every language: ${input.keepNames.join(", ")}.`
    : "";

  const system = `${HOUSE_VOICE}

TASK: translate the SOURCE TEXT below from ${LANG_NAME[input.sourceLang]} into ${input.targetLangs.map((l) => LANG_NAME[l]).join(" and ")}. Translate meaning, not word for word — it must read as if it had been written natively in each target language, following the voice and formatting rules above. Do not shorten, summarise, expand or add anything the source does not say.${keep}
Respond with exactly this JSON shape, one key per requested target language, nothing else: {${input.targetLangs.map((l) => `"${l}": "..."`).join(", ")}}`;

  return { system, user: `SOURCE TEXT (${LANG_NAME[input.sourceLang]}):\n${input.text}` };
}

/* ---------- seo -------------------------------------------------------------
 * title ≤ 60, description ≤ 155, for a product or a blog post, in `lang`. */

export interface SeoInput {
  kind?: "product" | "blog";
  name: string;
  brand?: string;
  category?: string;
  summary?: string;
}

function cleanSeoInput(raw: unknown): Required<Pick<SeoInput, "name">> & Omit<SeoInput, "name"> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = line(src.name, 140);
  if (!name) throw new AiInputError("missing_name");
  const kind = src.kind === "blog" ? "blog" : "product";
  return {
    kind,
    name,
    brand: line(src.brand, 60),
    category: line(src.category, 60),
    summary: para(src.summary, 800),
  };
}

export function buildSeoPrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanSeoInput(rawInput);
  const what = input.kind === "blog" ? "blog article" : "product";
  const facts = [
    `${what === "blog article" ? "Article title" : "Product name"}: ${input.name}`,
    input.brand ? `Brand: ${input.brand}` : "",
    input.category ? `Category: ${input.category}` : "",
    input.summary ? `Summary to work from, use only this, do not add more:\n${input.summary}` : "",
  ].filter(Boolean).join("\n");

  const system = `${HOUSE_VOICE}

TASK: write a Google search snippet for this ${what}, in ${LANG_NAME[lang]}.
- "title": an SEO title, at most 60 characters INCLUDING spaces — count them. Include the ${what === "blog article" ? "article topic" : "product type and brand"} naturally, no keyword stuffing, no trailing "| Rempire" (the site appends that itself).
- "description": an SEO meta description, at most 155 characters INCLUDING spaces — count them. A concrete, specific reason to click, not a repeat of the title.
Respond with exactly this JSON shape and nothing else: {"title": "...", "description": "..."}`;

  return { system, user: `INPUT:\n${facts}` };
}

/* ---------- reply -----------------------------------------------------------
 * customer e-mail/question + order summary → reply draft in the customer's
 * language. The shop signature is appended by the route from the content
 * layer (settings.content), deterministically — never by the model, so it
 * can never be invented. */

export interface ReplyOrderSummary {
  number: string;
  status?: string;
  items?: Array<{ title: string; qty?: number }>;
  name?: string;
}

export interface ReplyInput {
  customerMessage: string;
  order: ReplyOrderSummary;
}

const ORDER_STATUS_WORD: Record<string, string> = {
  new: "placed, awaiting payment",
  paid: "paid, being prepared",
  failed: "payment failed",
  shipped: "shipped",
  cancelled: "cancelled",
  refunded: "refunded",
};

function cleanReplyInput(raw: unknown): { customerMessage: string; order: ReplyOrderSummary } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const customerMessage = para(src.customerMessage, 3000);
  if (!customerMessage) throw new AiInputError("missing_customer_message");
  const o = (src.order && typeof src.order === "object" ? src.order : {}) as Record<string, unknown>;
  const number = line(o.number, 20);
  if (!number) throw new AiInputError("missing_order_number");
  const items = Array.isArray(o.items)
    ? (o.items as unknown[]).slice(0, 20).map((it) => {
        const row = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
        return { title: line(row.title, 120), qty: Number.isFinite(Number(row.qty)) ? Number(row.qty) : 1 };
      }).filter((it) => it.title)
    : undefined;
  return {
    customerMessage,
    order: { number, status: line(o.status, 20), items, name: line(o.name, 120) },
  };
}

export function buildReplyPrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanReplyInput(rawInput);
  const o = input.order;
  const facts = [
    `Order number: ${o.number}`,
    o.status ? `Order status: ${ORDER_STATUS_WORD[o.status] || o.status}` : "",
    o.name ? `Customer name: ${o.name}` : "",
    o.items && o.items.length ? `Items in the order: ${o.items.map((it) => `${it.title}${it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const system = `${HOUSE_VOICE}

TASK: write a reply to the customer's message below, in ${LANG_NAME[lang]}, using only the order facts under INPUT — never guess a delivery date, a reason for a delay, a refund amount or a policy detail that is not given to you.
- Address what the customer actually asked. If INPUT does not contain the answer (e.g. they ask something only a human can check), say plainly that the shop will confirm this and get back to them — never invent the missing fact.
- Polite, brief, human — 2 to 6 sentences. No greeting line naming the shop and no sign-off: both are added automatically after your text, so start straight with the reply and end straight after your last sentence, no "Best regards" or similar.
- Do not repeat the order number more than once.
Respond with exactly this JSON shape and nothing else: {"reply": "..."}`;

  return {
    system,
    user: `ORDER INPUT:\n${facts}\n\nCUSTOMER MESSAGE:\n${input.customerMessage}`,
  };
}

/* ---------- blog_outline -----------------------------------------------------
 * topic → title, 6 H2s, meta title/description, in `lang`. */

export interface BlogOutlineInput {
  topic: string;
}

function cleanBlogOutlineInput(raw: unknown): { topic: string } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const topic = line(src.topic, 200);
  if (!topic) throw new AiInputError("missing_topic");
  return { topic };
}

export function buildBlogOutlinePrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanBlogOutlineInput(rawInput);

  const system = `${HOUSE_VOICE}

TASK: plan a grooming-advice blog article for the shop's own blog, in ${LANG_NAME[lang]}, on the topic given under INPUT. This is a skeleton for the owner to write into, not a finished article — do not invent product names, brand claims or statistics; keep every heading generic enough that no fact-check is needed.
- "title": an article title, plain and specific to the topic, under 70 characters.
- "h2": exactly 6 section headings (H2s) that would structure a genuinely useful article on this topic, in a sensible reading order, each under 60 characters, no numbering.
- "metaTitle": SEO title for this article, at most 60 characters including spaces.
- "metaDescription": SEO meta description, at most 155 characters including spaces.
Respond with exactly this JSON shape and nothing else: {"title": "...", "h2": ["...","...","...","...","...","..."], "metaTitle": "...", "metaDescription": "..."}`;

  return { system, user: `INPUT:\nTopic: ${input.topic}` };
}

/* ---------- dispatch --------------------------------------------------------- */

export function buildPrompt(task: AiTask, lang: Lang3, input: unknown): PromptResult {
  if (task === "describe") return buildDescribePrompt(lang, input);
  if (task === "translate") return buildTranslatePrompt(lang, input);
  if (task === "seo") return buildSeoPrompt(lang, input);
  if (task === "reply") return buildReplyPrompt(lang, input);
  if (task === "blog_outline") return buildBlogOutlinePrompt(lang, input);
  throw new AiInputError("unknown_task");
}

export function isAiTask(v: unknown): v is AiTask {
  return typeof v === "string" && (AI_TASKS as readonly string[]).includes(v);
}
