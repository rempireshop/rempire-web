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

export const AI_TASKS = ["describe", "translate", "seo", "reply", "blog_outline", "post_full", "post_translate", "copy"] as const;
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
 * title ≤ 60, description ≤ 155, for a product or a blog post, in `lang`.
 *
 * Two input shapes, told apart by `kind`:
 *   product (default) — name, brand, category, an optional summary;
 *   post — the article itself: title, excerpt, the beginning of its text
 *          (plain, the first SEO_POST_BODY_MAX characters), tags and the
 *          names of the products it links. That is what the blog editor's
 *          «Заполнить автоматически» sends (admBlogSeoFill() in
 *          public/shop2/app.js). "blog" is the older spelling of "post" and
 *          still means the same thing; `name`/`summary` are read there as
 *          the title/excerpt when `title`/`excerpt` are not given. */

export interface SeoInput {
  kind?: "product" | "post" | "blog";
  /** Product name — or, for a post, its title (`title` is the key the editor sends). */
  name?: string;
  brand?: string;
  category?: string;
  /** A product's free summary; for a post the excerpt (`excerpt` is the key the editor sends). */
  summary?: string;
  /* kind: "post" */
  title?: string;
  excerpt?: string;
  /** The article's own text, plain — only the first SEO_POST_BODY_MAX characters are used. */
  body?: string;
  tags?: string[];
  /** Names of the products the article links, so the snippet can name one if it fits. */
  products?: string[];
}

/** How much of the article text goes to the model — enough for its topic, not the whole piece. */
export const SEO_POST_BODY_MAX = 1500;

interface SeoClean {
  kind: "product" | "post";
  name: string;
  brand: string;
  category: string;
  summary: string;
  body: string;
  tags: string[];
  products: string[];
}

function cleanSeoInput(raw: unknown): SeoClean {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = src.kind === "post" || src.kind === "blog" ? "post" : "product";
  if (kind === "post") {
    const name = line(src.title, 200) || line(src.name, 200);
    if (!name) throw new AiInputError("missing_title");
    return {
      kind,
      name,
      brand: "",
      category: "",
      summary: line(src.excerpt, 500) || line(src.summary, 500),
      body: para(src.body, SEO_POST_BODY_MAX),
      tags: listOf(src.tags, 12, 30),
      products: listOf(src.products, 12, 120),
    };
  }
  const name = line(src.name, 140);
  if (!name) throw new AiInputError("missing_name");
  return {
    kind,
    name,
    brand: line(src.brand, 60),
    category: line(src.category, 60),
    summary: para(src.summary, 800),
    body: "",
    tags: [],
    products: [],
  };
}

export function buildSeoPrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanSeoInput(rawInput);
  if (input.kind === "post") return buildPostSeoPrompt(lang, input);

  const facts = [
    `Product name: ${input.name}`,
    input.brand ? `Brand: ${input.brand}` : "",
    input.category ? `Category: ${input.category}` : "",
    input.summary ? `Summary to work from, use only this, do not add more:\n${input.summary}` : "",
  ].filter(Boolean).join("\n");

  const system = `${HOUSE_VOICE}

TASK: write a Google search snippet for this product, in ${LANG_NAME[lang]}.
- "title": an SEO title, at most 60 characters INCLUDING spaces — count them. Include the product type and brand naturally, no keyword stuffing, no trailing "| Rempire" (the site appends that itself).
- "description": an SEO meta description, at most 155 characters INCLUDING spaces — count them. A concrete, specific reason to click, not a repeat of the title.
Respond with exactly this JSON shape and nothing else: {"title": "...", "description": "..."}`;

  return { system, user: `INPUT:\n${facts}` };
}

/* A post is trilingual, and the editor asks for the snippet of one language
   at a time — with the article text in that language when the owner has
   written it, and in Russian otherwise. So the model is told plainly that
   the text under INPUT may be in another language than the one asked for:
   the snippet is for that language's page of the same article. */
function buildPostSeoPrompt(lang: Lang3, input: SeoClean): PromptResult {
  const facts = [
    `Article title: ${input.name}`,
    input.summary ? `Excerpt: ${input.summary}` : "",
    input.tags.length ? `Tags: ${input.tags.join(", ")}` : "",
    input.products.length ? `Products the article recommends: ${input.products.join(", ")}` : "",
    input.body ? `Article text (the beginning), use only this, do not add more:\n${input.body}` : "",
  ].filter(Boolean).join("\n");

  const system = `${HOUSE_VOICE}

TASK: write a Google search snippet for this blog article, in ${LANG_NAME[lang]}. The article under INPUT may be written in another language — write the snippet in ${LANG_NAME[lang]} regardless: it is for the ${LANG_NAME[lang]} page of the same article.
- "title": an SEO title, at most 60 characters INCLUDING spaces — count them. Name the article's topic the way a reader would search for it, no keyword stuffing, no trailing "| Rempire" (the site appends that itself).
- "description": an SEO meta description, at most 155 characters INCLUDING spaces — count them. Say concretely what the reader will learn — a reason to click, not a repeat of the title.
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
  delivered: "delivered",
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

/* ---------- post_full ---------------------------------------------------------
 * topic (+ the catalogue slice that fits it) → a whole article in `lang`:
 * title, excerpt, 600–900 words of clean HTML, tags, the Google pair and the
 * ids of the products it actually mentions. What the blog editor's «Написать
 * статью целиком» and the assistant's «напиши статью…» both run first (in
 * Russian); post_translate below carries the result into the other two
 * languages. The products list is the route's to build (src/lib/
 * catalogue-slice.ts) — this only writes it into the prompt and tells the
 * model it may mention nothing else. */

export interface PostProductRef {
  id: string;
  brand?: string;
  name?: string;
  category?: string;
}

export interface PostFullInput {
  topic: string;
  /** The products the article may mention — id, brand, name; nothing outside this list. */
  products?: PostProductRef[];
  /** A sentence or two from the owner — the angle, who it is for. */
  hint?: string;
}

export const POST_WORDS = [600, 900] as const;
export const POST_PRODUCTS_MAX = 12;

function cleanProductRefs(raw: unknown): PostProductRef[] {
  if (!Array.isArray(raw)) return [];
  const out: PostProductRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = line(o.id, 80);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, brand: line(o.brand, 60), name: line(o.name, 140), category: line(o.category, 40) });
    if (out.length >= POST_PRODUCTS_MAX) break;
  }
  return out;
}

function cleanPostFullInput(raw: unknown): { topic: string; products: PostProductRef[]; hint: string } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const topic = line(src.topic, 200);
  if (!topic) throw new AiInputError("missing_topic");
  return { topic, products: cleanProductRefs(src.products), hint: para(src.hint, 600) };
}

export function buildPostFullPrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanPostFullInput(rawInput);
  const products = input.products.length
    ? `PRODUCTS from the shop you may mention (id | brand | name | category) — these and no others, by their exact names, and only where they genuinely fit the advice:\n${input.products
        .map((p) => `${p.id} | ${p.brand || "-"} | ${p.name || "-"} | ${p.category || "-"}`)
        .join("\n")}`
    : "PRODUCTS: none listed — do not name any product or brand.";

  const system = `${HOUSE_VOICE}

TASK: write a complete grooming-advice article for the shop's own blog, in ${LANG_NAME[lang]}, on the topic under INPUT. This is the finished piece the owner will read once and publish — not an outline, not a stub. Practical, specific, honest; general grooming knowledge is fine, invented facts about products, ingredients or studies are not.
- "title": the article title, plain and specific, under 80 characters, no trailing punctuation.
- "excerpt": two sentences (under 300 characters) that say what the reader will learn — shown in the list and in search.
- "body": ${POST_WORDS[0]}–${POST_WORDS[1]} words of clean HTML. Use ONLY these tags: <h2> for section headings (4 to 6 sections, in a sensible reading order), <p> for paragraphs (2–4 sentences each), <ul><li> for one or two lists where a list genuinely helps (steps, a short checklist), <strong> for a key phrase now and then. No <h1>, no <h3>, no images, no links, no inline styles, no markdown, no comments. Start with an opening paragraph before the first <h2>. Mention 1–3 of the PRODUCTS by their exact name inside the advice where they fit, at most once each, and never as a sales pitch — a recommendation a barber would make out loud. End with one short closing paragraph that invites the reader to ask at the Rempire barbershop (Mardi 1, Tallinn) or in the shop — no prices, no discounts, no promises.
- "tags": 3 to 5 short lowercase tags in ${LANG_NAME[lang]} (single words or two-word phrases), the reader's own search words.
- "seoTitle": a Google title, at most 60 characters INCLUDING spaces — count them, no trailing "| Rempire".
- "seoDescription": a Google meta description, at most 155 characters INCLUDING spaces — count them; concrete, what the reader will learn.
- "products": the ids (from PRODUCTS) of the products the body actually mentions, in the order they appear — an empty list if none.
Respond with exactly this JSON shape and nothing else: {"title": "...", "excerpt": "...", "body": "<p>...</p><h2>...</h2><p>...</p>", "tags": ["...", "...", "..."], "seoTitle": "...", "seoDescription": "...", "products": ["id"]}`;

  const user = [`INPUT:\nTopic: ${input.topic}`, input.hint ? `The owner's note: ${input.hint}` : "", products]
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}

/* ---------- post_translate ----------------------------------------------------
 * the article post_full wrote (or the owner's own) → the same article in
 * `lang`, HTML tags kept exactly, product names untouched, the Google pair
 * re-fitted to its limits. One call per target language. */

export interface PostTranslateInput {
  sourceLang?: Lang3;
  title: string;
  excerpt?: string;
  /** The article as HTML — tags survive unchanged, only the text between them is translated. */
  body: string;
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
  /** Product/brand names that must appear unchanged. */
  keepNames?: string[];
}

export const POST_BODY_MAX = 20_000;

function cleanPostTranslateInput(raw: unknown, lang: Lang3) {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sourceLang = isLang3(src.sourceLang) ? src.sourceLang : "RU";
  if (sourceLang === lang) throw new AiInputError("same_language");
  const title = line(src.title, 200);
  const body = para(src.body, POST_BODY_MAX);
  if (!title && !body) throw new AiInputError("missing_text");
  return {
    sourceLang,
    title,
    excerpt: line(src.excerpt, 500),
    body,
    tags: listOf(src.tags, 12, 30),
    seoTitle: line(src.seoTitle, 70),
    seoDescription: line(src.seoDescription, 170),
    keepNames: listOf(src.keepNames, 20, 80),
  };
}

export function buildPostTranslatePrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanPostTranslateInput(rawInput, lang);
  const keep = input.keepNames.length
    ? `\nNames that must appear unchanged, in Latin script, in every language: ${input.keepNames.join(", ")}.`
    : "";
  const system = `${HOUSE_VOICE}

TASK: translate a blog article from ${LANG_NAME[input.sourceLang]} into ${LANG_NAME[lang]}. Translate meaning, not word for word — it must read as if written natively in ${LANG_NAME[lang]}, in the voice above. Do not shorten, summarise, expand, reorder or add anything the source does not say.
- "body" is HTML: keep every tag exactly where it is (<h2>, <p>, <ul>, <li>, <strong>, <em>) and translate only the text between tags. Never add, drop or rename a tag.
- "tags": the same tags, translated as short lowercase words a reader in ${LANG_NAME[lang]} would search for.
- "seoTitle": at most 60 characters INCLUDING spaces — count them, shorten if the translation runs long. "seoDescription": at most 155 characters INCLUDING spaces — same rule.${keep}
Respond with exactly this JSON shape and nothing else: {"title": "...", "excerpt": "...", "body": "...", "tags": ["..."], "seoTitle": "...", "seoDescription": "..."}`;

  const user = [
    `SOURCE (${LANG_NAME[input.sourceLang]}):`,
    `title: ${input.title}`,
    input.excerpt ? `excerpt: ${input.excerpt}` : "",
    input.tags.length ? `tags: ${input.tags.join(", ")}` : "",
    input.seoTitle ? `seoTitle: ${input.seoTitle}` : "",
    input.seoDescription ? `seoDescription: ${input.seoDescription}` : "",
    input.body ? `body:\n${input.body}` : "",
  ].filter(Boolean).join("\n");
  return { system, user };
}

/* ---------- copy ---------------------------------------------------------------
 * The short texts behind the «✨» buttons: a banner slide, the announcement
 * strip, the «Контакты» paragraph, the letter footer line, a promo code's
 * note to self, a new product's name. One task, one `kind`, so the route
 * and its tests have one door; each kind carries its own facts and its
 * own JSON shape. */

export const COPY_KINDS = ["hero", "announcement", "contact_page", "email_footer", "promo_note", "product_name"] as const;
export type CopyKind = (typeof COPY_KINDS)[number];

export interface CopyInput {
  kind: CopyKind;
  /** What the owner wants it to say — a phrase, a sentence, the current text. */
  hint?: string;
  /** hero: the product the slide points at, if any; where the button leads. */
  product?: string;
  target?: string;
  /** contact_page / email_footer: the company as the content layer has it. */
  company?: { name?: string; address?: string; phone?: string; email?: string; hours?: string };
  /** promo_note: the code as the form has it. */
  promo?: { code?: string; kind?: string; value?: number | string; minSubtotal?: number | string; endsAt?: string; maxUses?: number | string };
  /** product_name: what the owner typed. */
  brand?: string;
  name?: string;
  category?: string;
}

/** The Russian type tails the storefront knows how to translate (app.js NAME_TAILS / TAIL_EXACT). */
export const PRODUCT_NAME_TAILS = [
  "шампунь", "кондиционер", "маска", "сыворотка", "тоник", "спрей", "футболка", "худи", "масло", "бальзам",
  "паста", "воск", "пудра", "гель", "крем", "пенка", "лосьон", "патчи", "глазурь", "эссенция",
  "футболка оверсайз", "парфюм", "гидрофильное масло", "ручная работа",
] as const;
export const PRODUCT_NAME_FRAGS = ["для волос", "для кожи головы", "для укладки", "для лица", "для бороды", "для бритья"] as const;

export function isCopyKind(v: unknown): v is CopyKind {
  return typeof v === "string" && (COPY_KINDS as readonly string[]).includes(v);
}

function cleanCopyInput(raw: unknown) {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isCopyKind(src.kind)) throw new AiInputError("bad_kind");
  const co = (src.company && typeof src.company === "object" ? src.company : {}) as Record<string, unknown>;
  const pr = (src.promo && typeof src.promo === "object" ? src.promo : {}) as Record<string, unknown>;
  return {
    kind: src.kind,
    hint: para(src.hint, 600),
    product: line(src.product, 160),
    target: line(src.target, 80),
    company: { name: line(co.name, 120), address: line(co.address, 200), phone: line(co.phone, 40), email: line(co.email, 190), hours: line(co.hours, 300) },
    promo: { code: line(pr.code, 24), kind: line(pr.kind, 20), value: line(String(pr.value ?? ""), 12), minSubtotal: line(String(pr.minSubtotal ?? ""), 12), endsAt: line(pr.endsAt, 30), maxUses: line(String(pr.maxUses ?? ""), 12) },
    brand: line(src.brand, 60),
    name: line(src.name, 120),
    category: line(src.category, 60),
  };
}

export function buildCopyPrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanCopyInput(rawInput);
  const L = LANG_NAME[lang];
  let task = "";
  let facts: string[] = [];

  if (input.kind === "hero") {
    if (!input.hint && !input.product && !input.target) throw new AiInputError("missing_hint");
    task = `TASK: write the four texts of one slide of the shop's home-page banner, in ${L}. Short, concrete, no exclamation marks, no invented discounts, dates or claims — only what INPUT says.
- "eyebrow": a small line above the title, at most 40 characters (may be empty).
- "title": at most 40 characters INCLUDING spaces — count them.
- "sub": one sentence, at most 90 characters INCLUDING spaces.
- "cta": the button label, at most 24 characters — a verb («Смотреть», «Vaata», «Shop now»).
Respond with exactly this JSON shape and nothing else: {"eyebrow": "...", "title": "...", "sub": "...", "cta": "..."}`;
    facts = [
      input.hint ? `What the slide is about: ${input.hint}` : "",
      input.product ? `The product the slide points at: ${input.product}` : "",
      input.target ? `Where the button leads: ${input.target}` : "",
    ];
  } else if (input.kind === "announcement") {
    if (!input.hint) throw new AiInputError("missing_hint");
    task = `TASK: write the black announcement strip above the shop's header, in ${L}. One line, no exclamation marks, nothing INPUT does not say (no invented dates, percentages or conditions). You may keep the placeholders {EE} {LV} {FI} {EU} exactly as written — the shop replaces them with its free-delivery thresholds.
- "text": at most 90 characters INCLUDING spaces — count them.
- "short": the phone-width version of the same line, at most 40 characters INCLUDING spaces.
Respond with exactly this JSON shape and nothing else: {"text": "...", "short": "..."}`;
    facts = [`What it should say: ${input.hint}`];
  } else if (input.kind === "contact_page") {
    task = `TASK: write the opening paragraph of the shop's «Contacts» page, in ${L}: who we are (the Rempire barbershop's own shop of men's grooming products, Tallinn), how to reach us and what to expect — warm, plain, 2 to 4 sentences, at most 600 characters. The phone, e-mail, address and opening hours are printed under it automatically — do NOT repeat them in the text. No invented facts beyond INPUT.
Respond with exactly this JSON shape and nothing else: {"text": "..."}`;
    facts = [
      input.hint ? `The owner's note: ${input.hint}` : "",
      input.company.name ? `Company: ${input.company.name}` : "",
      input.company.address ? `Address (for context only, not to be repeated): ${input.company.address}` : "",
      input.company.hours ? `Opening hours (context only): ${input.company.hours}` : "",
    ];
  } else if (input.kind === "email_footer") {
    task = `TASK: write one extra line for the bottom of every letter the shop sends, in ${L} — under the legal line, above nothing. A warm one-liner (a thank-you, an invitation to write back, a barbershop greeting), at most 110 characters INCLUDING spaces, no exclamation marks, no invented offers or facts.
Respond with exactly this JSON shape and nothing else: {"text": "..."}`;
    facts = [input.hint ? `The owner's note: ${input.hint}` : "", input.company.name ? `Company: ${input.company.name}` : ""];
  } else if (input.kind === "promo_note") {
    if (!input.promo.code) throw new AiInputError("missing_code");
    const p = input.promo;
    const what = p.kind === "free_shipping" ? "free delivery" : p.kind === "fixed" ? `${p.value} € off` : `${p.value} % off`;
    task = `TASK: write the owner's private note-to-self for a promo code, in ${L}: one line, at most 110 characters INCLUDING spaces, saying in plain words what the code is for and where it is meant to be given out (inferred from INPUT only — a hint from the owner, or the code's own conditions; never invent a channel or a date that is not there).
Respond with exactly this JSON shape and nothing else: {"text": "..."}`;
    facts = [
      `Code: ${p.code}`,
      `What it gives: ${what}`,
      p.minSubtotal && p.minSubtotal !== "0" ? `Minimum order: ${p.minSubtotal} €` : "",
      p.endsAt ? `Valid until: ${p.endsAt}` : "",
      p.maxUses ? `Uses allowed: ${p.maxUses}` : "",
      input.hint ? `The owner's note: ${input.hint}` : "",
    ];
  } else {
    if (!input.name && !input.hint) throw new AiInputError("missing_name");
    task = `TASK: write the shop's catalogue name for a new product. The house pattern is «<line and product name in Latin script, exactly as the maker writes it> — <Russian type tail>», e.g. «Beard Balm Cypress & Vetyver — бальзам для бороды», «PLUMPING.WASH — шампунь», «Oil Cure Scalp Treatment — маска для кожи головы». Keep the brand out of the name (it is a separate field). The Russian tail MUST start with one of these words, because the storefront translates only these into Estonian and English by itself: ${PRODUCT_NAME_TAILS.join(", ")} — optionally followed by one of: ${PRODUCT_NAME_FRAGS.join(", ")}. Pick the tail that truthfully describes the product from INPUT; do not invent a type the input does not support.
Respond with exactly this JSON shape and nothing else: {"name": "..."}`;
    facts = [
      input.brand ? `Brand: ${input.brand}` : "",
      input.name ? `What the owner typed as the name: ${input.name}` : "",
      input.category ? `Shop section: ${input.category}` : "",
      input.hint ? `The owner's note: ${input.hint}` : "",
    ];
  }

  return { system: `${HOUSE_VOICE}\n\n${task}`, user: `INPUT:\n${facts.filter(Boolean).join("\n")}` };
}

/* ---------- dispatch --------------------------------------------------------- */

export function buildPrompt(task: AiTask, lang: Lang3, input: unknown): PromptResult {
  if (task === "describe") return buildDescribePrompt(lang, input);
  if (task === "translate") return buildTranslatePrompt(lang, input);
  if (task === "seo") return buildSeoPrompt(lang, input);
  if (task === "reply") return buildReplyPrompt(lang, input);
  if (task === "blog_outline") return buildBlogOutlinePrompt(lang, input);
  if (task === "post_full") return buildPostFullPrompt(lang, input);
  if (task === "post_translate") return buildPostTranslatePrompt(lang, input);
  if (task === "copy") return buildCopyPrompt(lang, input);
  throw new AiInputError("unknown_task");
}

export function isAiTask(v: unknown): v is AiTask {
  return typeof v === "string" && (AI_TASKS as readonly string[]).includes(v);
}
