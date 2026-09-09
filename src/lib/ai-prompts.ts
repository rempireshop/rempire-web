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

/* ---------- what a search result is made of --------------------------------
 *
 * Every task below that writes a title or a snippet inherits these. They are
 * not style preferences — each line is a fact about how this shop's pages are
 * built (src/lib/seo-head.mjs) or a number out of the Search Console export of
 * 07.09.2026 (docs/audit/2026-09-07-seo.md), where the shop ranked first for
 * five of its own products and took no clicks at all from any of them.
 *
 * Dim, 07.09.2026: «Every text generated with AI / Assistant needs to be
 * perfect for SEO.» */
export const TITLE_MAX = 60;
export const DESC_MAX = 155;
/** fitTitle() in src/lib/seo-head.mjs appends " — REMPIRE" below this length. */
export const TITLE_SUFFIXED_UNDER = 50;

export const SEO_RULES = `HOW THIS SHOP'S SEARCH RESULTS WORK — the budget you are writing to:
- A Google result prints about ${TITLE_MAX} characters of the title and about ${DESC_MAX} of the description. Both are hard limits: count the characters INCLUDING spaces and stay inside them. What runs past is cut mid-word, and a result that ends mid-word reads as a broken page.
- The shop adds " — REMPIRE" to a title of ${TITLE_SUFFIXED_UNDER} characters or fewer by itself, and Google prints the site's name beside every result anyway. Never write "Rempire", "| Rempire", "REMPIRE" or the domain into a title yourself.
- One title, one subject. A title naming two products, or a product and a category, ranks for neither.
- No keyword stuffing: never repeat a word to fit it in twice, never chain synonyms ("шампунь, шампуни, средство для мытья волос"), never bolt on a city, a country or "купить" where the sentence does not need it.
- The description is a reason to click, not a second title and not a slogan. Say what the thing is and who it is for, then the one concrete thing about it that would decide a purchase — taken from INPUT, never invented. No call to action ("Купите сейчас", "Заказывайте"), no exclamation marks, no ALL-CAPS.
- Never write a price, a discount, a delivery time or a stock figure into either field. The shop puts the live price and "в наличии" into the result itself, from its own data; a number saved inside a text is wrong the first time it changes.`;

/* The one rule that is specific to a product, and the one the export settles
   rather than guesses: every query this shop is found by is the maker's own
   words in the maker's own order. */
export const SEO_PRODUCT_RULES = `WHAT PEOPLE ACTUALLY TYPE — write the title in their words, in their order: the brand, then the maker's own name for the line, then what the thing is. The shop's real queries look like this: "system 4 bio botanical shampoo", "kevin murphy anti.gravity spray", "davines naturaltech calming shampoo", "mandom gatsby moving rubber grunge mat hair wax 80g", "system 4 t scalp tonic". So keep the maker's spelling exactly as INPUT gives it — the dots in "ANTI.GRAVITY.SPRAY", the line name ("Naturaltech", "Moving Rubber", "Bio Botanical"), and the size when the maker's own name carries one ("80 g"). Do not translate, transliterate or re-case any of it.`;

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
- THE FIRST SENTENCE IS THE SEARCH SNIPPET. When nobody writes a separate Google description for this product, the shop cuts the page's meta description out of the front of this text (src/lib/seo-head.mjs). So sentence one has to stand on its own in a search result: under 100 characters, saying plainly what the product is and who it is for. Do not open with a heading, with the brand shouted back at the reader, or with a line in capitals — the shop strips a capitalised opening, and what is left is what a stranger reads first.
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

/* A blog body reaches a translation task with its product cards taken out and
 * a numbered token left where each one stood — «[[1]]», «[[2]]»
 * (blogCardsOut() in public/shop2/app.js). The editor puts the cards back
 * wherever it finds the tokens, so a token the model translated, renumbered
 * or swallowed costs that card its paragraph: the editor can only append it
 * at the end of the article. Hence this line — and hence it is said only when
 * there is a token to say it about, because an instruction about placeholders
 * in a text that has none is an invitation to invent one. */
const PLACEHOLDER_RX = /\[\[\d+\]\]/;
function placeholderRule(text: string): string {
  return PLACEHOLDER_RX.test(text)
    ? "\nThe source contains placeholders written as [[1]], [[2]] — copy each one into the translation exactly as it stands, in the same sentence and the same order. Never translate, renumber, drop or duplicate one, and never add one of your own."
    : "";
}

export function buildTranslatePrompt(lang: Lang3, rawInput: unknown): PromptResult {
  const input = cleanTranslateInput(rawInput, lang);
  const keep = input.keepNames.length
    ? `\nNames that must appear unchanged in every language: ${input.keepNames.join(", ")}.`
    : "";

  const system = `${HOUSE_VOICE}

TASK: translate the SOURCE TEXT below from ${LANG_NAME[input.sourceLang]} into ${input.targetLangs.map((l) => LANG_NAME[l]).join(" and ")}. Translate meaning, not word for word — it must read as if it had been written natively in each target language, following the voice and formatting rules above. Do not shorten, summarise, expand or add anything the source does not say.${keep}${placeholderRule(input.text)}
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

${SEO_RULES}

${SEO_PRODUCT_RULES}

TASK: write a Google search snippet for this product, in ${LANG_NAME[lang]}.
- "title": at most ${TITLE_MAX} characters INCLUDING spaces — count them. Brand, then the maker's name for the product, then what it is, in ${LANG_NAME[lang]}: "System 4 Bio Botanical Shampoo — шампунь", "Kevin.Murphy ANTI.GRAVITY.SPRAY — спрей для объёма".
- "description": at most ${DESC_MAX} characters INCLUDING spaces — count them. One sentence on what it is and whom it suits, one on the thing about it that decides the purchase. Nothing that is not in INPUT.
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

${SEO_RULES}

TASK: write a Google search snippet for this blog article, in ${LANG_NAME[lang]}. The article under INPUT may be written in another language — write the snippet in ${LANG_NAME[lang]} regardless: it is for the ${LANG_NAME[lang]} page of the same article.
- "title": at most ${TITLE_MAX} characters INCLUDING spaces — count them. Name the article's subject in the reader's own words, the way they would type the question into the search box. A product or brand name belongs in it only when the article really is about that one thing.
- "description": at most ${DESC_MAX} characters INCLUDING spaces — count them. Say concretely what the reader will know after reading it — the answer the article gives, not a promise that it gives one.
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

${SEO_RULES}

TASK: plan a grooming-advice blog article for the shop's own blog, in ${LANG_NAME[lang]}, on the topic given under INPUT. This is a skeleton for the owner to write into, not a finished article — do not invent product names, brand claims or statistics; keep every heading generic enough that no fact-check is needed.
- "title": an article title, plain and specific to the topic, under 70 characters.
- "h2": exactly 6 section headings (H2s) that would structure a genuinely useful article on this topic, in a sensible reading order, each under 60 characters, no numbering. Each one should read like a question a reader would actually ask, not like a chapter of a textbook.
- "metaTitle": SEO title for this article, at most ${TITLE_MAX} characters INCLUDING spaces — count them. The topic in the reader's own search words.
- "metaDescription": SEO meta description, at most ${DESC_MAX} characters INCLUDING spaces — count them. What the reader will know after reading it.
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
 * model it may mention nothing else.
 *
 * The article also places its own product cards (Dim, 09.09.2026: «пусть
 * помощник сам вставляет товары в текст»). The card is the marker the
 * editor's «Товар» button already writes — `<a data-product="ID">` — so a
 * placed card is the same object as a hand-placed one: the owner moves or
 * deletes it exactly as before, the storefront swaps it for a real card
 * (blogBodyHTML() in public/shop2/app.js) and a translation carries it
 * across (blogCardsOut()/blogCardsIn(), same file). All the model supplies
 * is an id out of PRODUCTS — the picture, the name and the price are the
 * panel's to write, and an id that was never offered is filtered out by the
 * route before the answer leaves it. */

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
/* Cards in the body, not products in the article. Three is where a piece of
   advice stops being advice and starts being a catalogue page — the same
   ceiling the prose already has ("mention 1–3 of the PRODUCTS"). */
export const POST_CARDS_MAX = 3;

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

${SEO_RULES}

TASK: write a complete grooming-advice article for the shop's own blog, in ${LANG_NAME[lang]}, on the topic under INPUT. This is the finished piece the owner will read once and publish — not an outline, not a stub. Practical, specific, honest; general grooming knowledge is fine, invented facts about products, ingredients or studies are not.
- "title": the article title, plain and specific, under 80 characters, no trailing punctuation.
- "excerpt": two sentences (under 300 characters) that say what the reader will learn — shown in the list and in search.
- "body": ${POST_WORDS[0]}–${POST_WORDS[1]} words of clean HTML. Use ONLY these tags: <h2> for section headings (4 to 6 sections, in a sensible reading order), <p> for paragraphs (2–4 sentences each), <ul><li> for one or two lists where a list genuinely helps (steps, a short checklist), <strong> for a key phrase now and then, plus the product card below. No <h1>, no <h3>, no images, no links of your own, no inline styles, no markdown, no comments. Start with an opening paragraph before the first <h2>. Mention 1–3 of the PRODUCTS by their exact name inside the advice where they fit, at most once each, and never as a sales pitch — a recommendation a barber would make out loud. End with one short closing paragraph that invites the reader to ask at the Rempire barbershop (Mardi 1, Tallinn) or in the shop — no prices, no discounts, no promises.
- the product card: right after the paragraph that recommends one of the PRODUCTS, put that product's card on a line of its own, written exactly as <p><a data-product="ID"></a></p>, where ID is copied character for character from the PRODUCTS list. Nothing inside the tag, no href, no other attribute, no text of your own around it — the shop fills in the picture, the name and the price itself, so writing them there would only print them twice. At most one card per product and at most ${POST_CARDS_MAX} in the whole article, each next to the advice it belongs to and never all together at the end. An ID that is not in the PRODUCTS list is not a product: write no card rather than a card for something that does not exist, and if nothing in PRODUCTS genuinely fits the topic, write no cards at all — an article without cards is a good article.
- "tags": 3 to 5 short lowercase tags in ${LANG_NAME[lang]} (single words or two-word phrases), the reader's own search words.
- "seoTitle": a Google title, at most ${TITLE_MAX} characters INCLUDING spaces — count them. The article's subject in the reader's own search words; the shop's name is added for you.
- "seoDescription": a Google meta description, at most ${DESC_MAX} characters INCLUDING spaces — count them; concrete, what the reader will know after reading it.
- "products": the ids (from PRODUCTS) of the products the body actually mentions or shows a card for, in the order they appear — an empty list if none.
Respond with exactly this JSON shape and nothing else: {"title": "...", "excerpt": "...", "body": "<p>...</p><h2>...</h2><p>...</p><p><a data-product=\\"id\\"></a></p>", "tags": ["...", "...", "..."], "seoTitle": "...", "seoDescription": "...", "products": ["id"]}`;

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

${SEO_RULES}

TASK: translate a blog article from ${LANG_NAME[input.sourceLang]} into ${LANG_NAME[lang]}. Translate meaning, not word for word — it must read as if written natively in ${LANG_NAME[lang]}, in the voice above. Do not shorten, summarise, expand, reorder or add anything the source does not say.
- "body" is HTML: keep every tag exactly where it is (<h2>, <p>, <ul>, <li>, <strong>, <em>) and translate only the text between tags. Never add, drop or rename a tag.
- "tags": the same tags, translated as short lowercase words a reader in ${LANG_NAME[lang]} would search for.
- "seoTitle": at most ${TITLE_MAX} characters INCLUDING spaces — count them. ${LANG_NAME[lang]} is often longer than the source; re-write the title to fit rather than translating it and letting it run over. "seoDescription": at most ${DESC_MAX} characters INCLUDING spaces — same rule.${keep}${placeholderRule(input.body)}
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
 * The short texts behind the «✨» buttons: a banner slide and a new product's
 * name. One task, one `kind`, so the route and its tests have one door; each
 * kind carries its own facts and its own JSON shape.
 *
 * There were six (07.09.2026, Dim: «fewer sparkle buttons»). The four that
 * went — the announcement strip, the «Контакты» paragraph, the letter footer
 * line and a promo code's note to self — were four different one-off ways to
 * ask the assistant for one sentence, each with a button of its own in a
 * corner of a form. The assistant itself lost nothing: it writes all four
 * through `set_content` / `create_promo`, in its own words, showing the owner
 * what is about to change before he applies it. These two stayed because they
 * are the two the owner genuinely cannot dash off himself — a banner in three
 * languages, and a catalogue name in the house pattern. */

export const COPY_KINDS = ["hero", "product_name", "bundle"] as const;
export type CopyKind = (typeof COPY_KINDS)[number];

export interface CopyInput {
  kind: CopyKind;
  /** What the owner wants it to say — a phrase, a sentence, the current text. */
  hint?: string;
  /** hero: the product the slide points at, if any; where the button leads. */
  product?: string;
  target?: string;
  /** product_name: what the owner typed. bundle: the set's own Russian name. */
  brand?: string;
  name?: string;
  category?: string;
  /** bundle: the products inside the set, «Brand Name, 100 мл ×2» each. */
  products?: string[];
}

/* A set's description is the one AI text in the shop that is BOTH the page's
   copy and its Google snippet: tools/prerender-shop2.mjs writes
   `desc: clip(blurb, 158)` into the <meta description> of /shop2/set/<id>/.
   So the budget is not a style note — it is the snippet's own limit, and the
   first sentence has to carry the search words on its own. */
export const BUNDLE_DESC_SNIPPET_MAX = 155;
export const BUNDLE_DESC_CHARS = [240, 420] as const;

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
  return {
    kind: src.kind,
    hint: para(src.hint, 600),
    product: line(src.product, 160),
    target: line(src.target, 80),
    brand: line(src.brand, 60),
    name: line(src.name, 120),
    category: line(src.category, 60),
    products: listOf(src.products, 8, 160),
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
  } else if (input.kind === "bundle") {
    /* «Наборы» — the set editor's own «Написать черновик» (Dim, 07.09.2026:
       «Set descriptions should be possible to generate with AI»). The set is
       real products the owner has already put in the form, so the products
       are the facts; everything else about it — what it does, who it is for —
       has to come out of those and nothing else. */
    if (!input.products.length && !input.name && !input.hint) throw new AiInputError("missing_products");
    task = `TASK: write the shop's own description of a SET («набор») — several products sold together at one price — in ${L}.
The set has its own page, and THE FIRST ${BUNDLE_DESC_SNIPPET_MAX} CHARACTERS OF THIS TEXT BECOME THAT PAGE'S GOOGLE SNIPPET. So:
- open with what the set is and who it is for, in the words a customer would actually search — the shop section and the product types, named naturally («Набор для бороды: масло, бальзам и мыло …»), never a keyword list and never the shop's name (the site appends it);
- then one or two sentences on why these products belong together and what the set gives whoever buys it.
- ${BUNDLE_DESC_CHARS[0]}–${BUNDLE_DESC_CHARS[1]} characters in total, 2 to 4 sentences, plain text — no headings, no bullet points, no emoji, no line breaks.
- Name the products from INPUT by their exact names where it helps the reader; never mention a product INPUT does not list.
- Never name a price, a discount, a percentage or "save X": the set's price is edited separately and this text would start lying the day it changes.
- Never invent an ingredient, a result, an award or a medical claim — only what the products under INPUT plainly are.
Respond with exactly this JSON shape and nothing else: {"text": "..."}`;
    facts = [
      input.name ? `The set's name: ${input.name}` : "",
      input.category ? `Shop section: ${input.category}` : "",
      input.products.length ? `What is inside the set, use only these:\n- ${input.products.join("\n- ")}` : "",
      input.hint ? `The owner's note: ${input.hint}` : "",
    ];
  } else {
    if (!input.name && !input.hint) throw new AiInputError("missing_name");
    task = `TASK: write the shop's catalogue name for a new product. The house pattern is «<line and product name in Latin script, exactly as the maker writes it> — <Russian type tail>», e.g. «Beard Balm Cypress & Vetyver — бальзам для бороды», «PLUMPING.WASH — шампунь», «Oil Cure Scalp Treatment — маска для кожи головы». Keep the brand out of the name (it is a separate field). The Russian tail MUST start with one of these words, because the storefront translates only these into Estonian and English by itself: ${PRODUCT_NAME_TAILS.join(", ")} — optionally followed by one of: ${PRODUCT_NAME_FRAGS.join(", ")}. Pick the tail that truthfully describes the product from INPUT; do not invent a type the input does not support.

This name is not only a label: the shop builds the product page's <title> out of the brand and this name, so it is what the page will rank for. Keep every word a buyer would type — the maker's own line name ("Naturaltech", "Moving Rubber", "Bio Botanical"), the maker's own punctuation ("ANTI.GRAVITY.SPRAY"), and the size when the maker's name carries one ("Hair Wax 80g"). Do not tidy, translate or shorten those, and do not add words of your own to help it rank. Brand plus name has to stay under 50 characters when it can.
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
