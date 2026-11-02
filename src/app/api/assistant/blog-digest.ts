/**
 * Salon guides: the shop chat reads the blog.
 *
 * Dim, 02.11.2026: «blogs become the source of truth for product choice and
 * the AI assistant for client needs to be able to suggest also correct items
 * connected to the blog post». Until then the shop chat's prompt carried the
 * published articles as `slug|title` and nothing more — it could link the
 * Kevin.Murphy shampoo guide, but it never saw that the guide answers «тонкие
 * окрашенные волосы без объёма» with Angel.Wash + Angel.Rinse and the mask
 * once a week, so it picked from its own catalogue slice and could contradict
 * the salon's own article.
 *
 * Now, per question, the 0–2 published articles that fit it go into the
 * prompt as a DIGEST: the title, the sections, and the article's sentences
 * that name its products, each product with its catalogue id. The model is
 * told to build the answer on that guide when it covers the need
 * (shopPrompt in ./route.ts), and the answer carries the article back as
 * structured data the widget draws as a card (public/shop2/chat.js).
 *
 * The budget, because Vercel Hobby's CPU allowance is near its cap (75 % of
 * the four hours by 30.10.2026 — src/lib/hidden-cache.ts tells it): no
 * embeddings, no extra model call, no database read per message. Measured on
 * the shop's six articles of 02.11.2026: parsing all of them takes ~30 ms,
 * once per change; ranking one question ~0.1 ms; the guides add at most
 * ~2,800 characters to the prompt (tests/assistant-shop-guides.test.ts).
 *
 *   · The articles live in this instance's memory, parsed once into an entry
 *     per article (its digest in each language and a word index). The cache
 *     is checked at most once a minute by one aggregate query
 *     (publishedStamp) and the bodies are re-read only when that stamp moved
 *     — or at once, on this instance, when a save called refreshBlogCache()
 *     (blogGeneration in src/lib/blog-cache.ts, the blog's own drop).
 *   · Ranking is cheap keyword scoring against that index: the shopper's
 *     words, folded and stemmed the way the shop's own search does it
 *     (srchNorm / srchStem in public/shop2/app.js, which is a browser IIFE
 *     and cannot be imported — the three rules are ported below and say so),
 *     weighed by where in the article they appear and by how rare they are
 *     across the blog. A threshold keeps it at zero articles when nothing
 *     really fits: «доставка в Финляндию» gets no guide.
 *   · A digest is capped (DIGEST_CAP) and its lines are chosen for the
 *     question, so a 34-product guide does not cost 34 products of prompt.
 *
 * Everything here is best effort, the posture of every optional block in the
 * shop chat: a database that does not answer means no guides and the chat
 * answers exactly as it did before — never an error.
 */
import catalogue from "@/data/catalogue.min.json";
import { listPublishedFull, publishedStamp, renderPostBody, type Post } from "@/lib/blog";
import { blogGeneration } from "@/lib/blog-cache";

export type Lang3 = "RU" | "ET" | "EN";
const LANGS: readonly Lang3[] = ["RU", "ET", "EN"];

/** Characters one article's digest may take in the prompt. */
export const DIGEST_CAP = 1200;
/** …and the second article's, when two fit: it is the lesser match. */
export const DIGEST_CAP_SECOND = 800;
/** At most this many articles go in as digests. */
export const MAX_GUIDES = 2;
/** The score an article needs before it is offered at all (see rankArticles). */
export const MIN_SCORE = 3;
/** A second article is offered only when it scores at least this share of the first. */
export const SECOND_RATIO = 0.5;
/** How often the cache asks the database whether the published set changed. */
const CHECK_MS = 60_000;
/** How many published articles are read into memory — the blog has six (02.11.2026). */
const MAX_POSTS = 40;

/* ---------- words ---------------------------------------------------------
   The shop's own search spelling (srchNorm in public/shop2/app.js): lower
   case, every accent mark dropped but the breve — so ё → е, õäöü → oaou,
   šž → sz, and й stays й — a digit and a letter always parted, every other
   character a space. Ported, not imported: app.js is a browser IIFE. */
export function normWords(s: string): string[] {
  const t = String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-̅̇-ͯ]/g, "")
    .normalize("NFC");
  return t
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/([0-9])([a-zа-я])/g, "$1 $2")
    .replace(/([a-zа-я])([0-9])/g, "$1 $2")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/* srchStem in app.js: one ending off, and only while three letters of a
   Russian word or four of a Latin one survive (SRCH_SUFFIX_RU / _LAT there). */
const SUFFIX_RU = /(ами|ями|ого|его|ому|ему|ыми|ими|ей|ой|ый|ий|ая|яя|ое|ее|ые|ие|ов|ев|ах|ях|ам|ям|ом|ем|ым|им|ую|юю|ся|сь|ь|й|ы|и|а|о|у|е|я|ю|м|х)$/;
const SUFFIX_LAT = /(idega|itega|dega|tega|isse|asse|esse|itel|idel|iste|este|dele|tele|sele|ides|ites|tes|des|sed|ted|ded|ele|ega|eks|ile|ilt|ist|ing|ies|ks|le|lt|st|ga|de|te|id|ed|ne|se|es|d|t|s|l|e|a|i|u)$/;
export function stem(w: string): string {
  if (/[а-я]$/.test(w)) {
    const r = w.replace(SUFFIX_RU, "");
    return r.length >= 3 ? r : w;
  }
  const s = w.replace(SUFFIX_LAT, "");
  return s.length >= 4 ? s : w;
}

/* The words a chat message is made of that say nothing about the need:
   SRCH_STOP from app.js plus the ones a question to a person adds («посоветуй»,
   «what should I use», «mida soovitate»). Written folded (ё → е, õ → o), the
   spelling normWords() leaves them in. */
const STOP = new Set(
  (
    // Russian
    "и в во на с со для от из по у о об к ко за при не же ли бы это эта этот эти мне мой моя мои " +
    "как что где или без под над про чем чтобы если когда то а но да нет так там тут еще уже очень " +
    "просто только все всех раз есть был была были будет можно нужно нужен нужна нужны надо хочу " +
    "хотел хотела ищу посоветуй посоветуйте подскажи подскажите подбери подберите подобрать " +
    "порекомендуй порекомендуйте выбрать какой какая какое какие какую каким который которая " +
    "которые лучше лучший самый хороший хорошая хорошее хорошие средство средства товар товары " +
    "нибудь вас вам ваш ваши я мы вы он она они его ее их меня себя свой свои купить куплю цена " +
    "цены стоимость заказать заказ отзыв отзывы обзор официальный сайт магазин привет здравствуйте " +
    "спасибо пожалуйста помогите помоги делать сделать " +
    // Estonian
    "ja ning voi kui see seda need ei mu ma mis kas ka kuidas osta hind hinnad pood ametlik soovita " +
    "soovitage soovitate vajan vaja tahan otsin midagi mingi mul minu sul teil teie on oli oleks " +
    "milline millist mida hea parim palun ilma aga siis tere aitah " +
    // English
    "the a an of for and or to in on at with my me is it do how what best top nr no number buy " +
    "price prices shop store website official reviews review online you we your our need needs " +
    "want looking look something anything any some which should would could can use using good " +
    "great recommend suggest advice help please have has get got from about without this that " +
    "these those there very really just also than then hello thanks"
  ).split(" "),
);

/** One word worth matching: three letters or more, not a stop word, not a bare number. */
function keep(w: string): boolean {
  return w.length >= 3 && !STOP.has(w) && !/^[0-9]+$/.test(w);
}

/** Two stems are the same word when equal, or — both four letters or more — one starts the other. */
export function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * The words of a conversation, stemmed, with how much each counts: the
 * shopper's newest message 1, the earlier ones ½ — so «а что лучше, масло или
 * бальзам?» after «борода зимой сохнет» still stays with the beard article.
 * `turns` is oldest first.
 */
export function queryStems(turns: string[]): Map<string, number> {
  const out = new Map<string, number>();
  // newest first, so the cap below keeps what the shopper said last
  for (let i = turns.length - 1; i >= 0; i--) {
    const w = i === turns.length - 1 ? 1 : 0.5;
    for (const word of normWords(turns[i])) {
      if (!keep(word)) continue;
      const s = stem(word);
      if ((out.get(s) ?? 0) < w) out.set(s, w);
    }
  }
  // a pasted paragraph is not a question; its first words still are
  return new Map([...out].slice(0, 24));
}

/* ---------- the article index ----------------------------------------------
   Where in the article a word stands says how much it is about that word.
   A word counts once per field and the fields add up: «перхоть» in the System
   4 guide's tags, a heading, the excerpt and an advice line is that guide's
   subject; «масло» in one product name of the shampoo guide is not. */
const FIELD = { title: 1, tags: 2, head: 4, names: 8, excerpt: 16, lines: 32 } as const;
const FIELD_W: Array<[number, number]> = [
  [FIELD.title, 3],
  [FIELD.tags, 2.5],
  [FIELD.head, 2],
  [FIELD.names, 1.5],
  [FIELD.excerpt, 1],
  [FIELD.lines, 0.5],
];
function maskWeight(mask: number): number {
  let w = 0;
  for (const [bit, v] of FIELD_W) if (mask & bit) w += v;
  return w;
}

type Index = { exact: Map<string, number>; pre: Map<string, number> };

function indexAdd(ix: Index, text: string, bit: number): void {
  for (const word of normWords(text)) {
    if (!keep(word)) continue;
    const s = stem(word);
    ix.exact.set(s, (ix.exact.get(s) ?? 0) | bit);
    // every strict prefix of four letters or more: «an article word starting with the query's»
    for (let k = 4; k < s.length; k++) {
      const p = s.slice(0, k);
      ix.pre.set(p, (ix.pre.get(p) ?? 0) | bit);
    }
  }
}

/** The fields of the article a query stem is found in (sameStem, both ways). */
function indexMask(ix: Index, q: string): number {
  let m = ix.exact.get(q) ?? 0;
  if (q.length >= 4) {
    m |= ix.pre.get(q) ?? 0;
    for (let k = q.length - 1; k >= 4; k--) m |= ix.exact.get(q.slice(0, k)) ?? 0;
  }
  return m;
}

/* ---------- the digest ----------------------------------------------------- */

export type DigestLine = {
  /** The sentence, every product in it followed by `[id]`. */
  text: string;
  ids: string[];
  /** Its own stems, and those of the heading it stands under. */
  own: string[];
  ctx: string[];
};
export type LangDigest = { title: string; sections: string[]; lines: DigestLine[] };

export type GuideEntry = {
  slug: string;
  /** The title in each language — an empty translation is the Russian one, as pickLang() reads it. */
  title: Record<Lang3, string>;
  cover: string | null;
  /** The article's own products («Товары в статье»), in its order. */
  products: string[];
  digest: Record<Lang3, LangDigest>;
  index: Index;
};

type NameRow = { id: string; b: string; n: string };
const CAT = catalogue as NameRow[];
const CAT_BY_ID = new Map(CAT.map((r) => [r.id, r]));

const ENT: Record<string, string> = { "&amp;": "&", "&nbsp;": " ", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
function decode(s: string): string {
  return s
    .replace(/&(?:amp|nbsp|quot|#39|lt|gt);/g, (e) => ENT[e] ?? e)
    .replace(/&#(\d{1,6});/g, (_e, n) => String.fromCodePoint(Number(n)));
}
const tagless = (html: string) => decode(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/* A product link inside the text: the editor's card (`data-product`) or any
   link to the product's page, in whatever spelling the address had then —
   /ru/products/<id>, /products/<id>, /shop2/p/<id>/ — or even on a foreign
   host (one article links https://www.claudeusercontent.com/ru/products/…). */
function anchorId(attrs: string): string | null {
  const dp = /data-product="([a-z0-9-]{1,80})"/i.exec(attrs);
  if (dp) return dp[1].toLowerCase();
  const href = /href="([^"]*)"/i.exec(attrs);
  if (!href) return null;
  const m = /\/(?:products|p)\/([a-z0-9-]{1,80})\/?(?:[?#]|$)/i.exec(href[1]);
  return m ? m[1].toLowerCase() : null;
}

/* Inside a block, a linked product is `\u0001<link text>\u0002[id]`: the
   markers let the name scan below skip what is already linked, and fall away
   when the line is written out. */
const LINK_OPEN = "\u0001";
const LINK_CLOSE = "\u0002";
const LINKED_RX = /\u0001[^\u0002]*\u0002\[[a-z0-9-]+\]/g;
const ID_RX = /\[([a-z0-9-]{1,80})\]/g;

function blockText(inner: string, isProduct: (id: string) => boolean): string {
  const withLinks = inner.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, text: string) => {
    const id = anchorId(attrs);
    const label = tagless(text);
    return id && isProduct(id) ? `${LINK_OPEN}${label}${LINK_CLOSE}[${id}] ` : ` ${label} `;
  });
  return tagless(withLinks.replace(/<br\s*\/?>/gi, " "));
}

/** «ANGEL.WASH — шампунь» → «angel wash»: the maker's name, as the text would spell it. */
const nameKey = (n: string) => normWords(String(n).split(" — ")[0]).join(" ");

/**
 * The attached products a sentence names without a link — «масло Proraso
 * Beard Oil Wood Spice с ароматом кедра» — longest name first, so «Blonde
 * Angel Wash» is not also read as «Angel Wash» (mentionedProducts in
 * src/lib/catalogue-slice.ts keeps the same rule).
 */
function namedIn(text: string, names: Array<{ id: string; key: string }>): string[] {
  const hay = " " + normWords(text.replace(LINKED_RX, " ")).join(" ") + " ";
  const taken: Array<[number, number]> = [];
  const found: Array<[number, string]> = [];
  for (const { id, key } of names) {
    const at = hay.indexOf(" " + key + " ");
    if (at < 0) continue;
    const span: [number, number] = [at + 1, at + 1 + key.length];
    if (taken.some(([s, e]) => span[0] < e && span[1] > s)) continue;
    taken.push(span);
    found.push([at, id]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, id]) => id);
}

const LINE_MAX = 320;
const idsIn = (s: string) => [...s.matchAll(ID_RX)].map((m) => m[1]);

/**
 * A sentence as the prompt shows it. Every product it names keeps its `[id]`:
 * a linked one right after its name, one named without a link (or given by the
 * card after it) at the end — and when a long sentence is cut, the ids of the
 * cut part move to the end too, so a product is never lost with its words.
 */
function lineText(raw: string, ids: string[]): { text: string; ids: string[] } {
  let t = raw.replace(/\u0001/g, "").replace(/\u0002/g, " ").replace(/\s+/g, " ").replace(/\s+([,.;:!?…])/g, "$1").trim();
  const all = [...new Set([...idsIn(t), ...ids])];
  if (t.length > LINE_MAX) t = t.slice(0, LINE_MAX - 20).replace(/\s*\[[^\]]*$/, "").replace(/\s+\S*$/, "") + "…";
  const present = new Set(idsIn(t));
  const missing = all.filter((id) => !present.has(id));
  if (missing.length) t += " " + missing.map((id) => `[${id}]`).join(" ");
  return { text: t, ids: all };
}

const stemsOf = (s: string) => [...new Set(normWords(s.replace(ID_RX, " ")).filter(keep).map(stem))];

type Pending = { raw: string; ids: string[]; ctx: string };

/**
 * One language of one article as the chat needs it. Headings become the
 * sections and the context of the lines under them; a paragraph or list item
 * becomes lines — one per sentence that names a product.
 *
 * A paragraph that is nothing but a product card or a product link
 * («<p><a data-product=…>», the shop guides end each product's section with
 * one) names its product for the text before it. When that text already named
 * it, there is nothing to add. Under a product's own heading («Angel.Wash —
 * тонкие, хрупкие, окрашенные») the heading is the best line it can have.
 * Otherwise it joins the last sentence before it — the one that led to it
 * («Хороший пример — густое масло, которое…:»).
 */
export function digestOf(
  title: string,
  bodyHtml: string,
  products: string[],
  isProduct: (id: string) => boolean,
): LangDigest & { headings: string[] } {
  const html = renderPostBody(bodyHtml || "");
  const names = products
    .map((id) => ({ id, key: nameKey(CAT_BY_ID.get(id)?.n ?? "") }))
    .filter((r) => r.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length);
  const sections: string[] = [];
  const headings: string[] = [];
  const lines: DigestLine[] = [];
  const add = (p: Pending) => {
    if (!p.ids.length) return;
    const { text, ids } = lineText(p.raw, p.ids);
    lines.push({ text, ids, own: stemsOf(text), ctx: stemsOf(p.ctx) });
  };
  // the sentences of the block before, held back until the next block: a card on its own may still join them
  const st: { prev: Pending[] } = { prev: [] };
  const flush = () => {
    st.prev.forEach(add);
    st.prev = [];
  };
  let h2 = "", h3 = "";
  // the ids an h3 has already been written out for, so two cards under one heading make one line each
  const h3Used = new Set<string>();
  for (const m of html.matchAll(/<(h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = m[1].toLowerCase();
    if (tag === "h2" || tag === "h3") {
      flush();
      const h = tagless(m[2]);
      if (h) headings.push(h);
      if (tag === "h2") {
        h2 = h;
        h3 = "";
        if (h) sections.push(h);
      } else h3 = h;
      continue;
    }
    const text = blockText(m[2], isProduct);
    if (!text) continue;
    const ctx = `${h2} ${h3}`;
    const bare = text.replace(LINKED_RX, " ").replace(/[\s.,:;!?…—–-]+/g, "");
    if (!bare) {
      for (const id of idsIn(text)) {
        if (st.prev.some((p) => p.ids.includes(id))) continue;
        if (h3 && !h3Used.has(`${h3}|${id}`)) {
          h3Used.add(`${h3}|${id}`);
          add({ raw: `${h3} [${id}]`, ids: [id], ctx: h2 });
        } else if (st.prev.length) {
          st.prev[st.prev.length - 1].ids.push(id);
        }
      }
      continue;
    }
    flush();
    // a list item is one thought; a paragraph is split into its sentences
    const parts = tag === "li" ? [text] : text.split(/(?<=[.!?…])\s+(?=[«"(A-ZА-ЯЁ0-9\u0001])/u);
    st.prev = parts.map((raw) => {
      const ids = idsIn(raw);
      for (const id of namedIn(raw, names)) if (!ids.includes(id)) ids.push(id);
      return { raw, ids, ctx };
    });
  }
  flush();
  return { title, sections, lines, headings };
}

/** The language shown, falling back to Russian — pickLang() in src/lib/blog.ts, per field. */
function inLang(t: Record<string, string> | null | undefined, l: Lang3): string {
  const v = t || {};
  return v[l] || v.RU || v.ET || v.EN || "";
}

/**
 * One published article → what the chat ranks and quotes. A product id counts
 * when the catalogue file has it or the article itself attached it (the
 * owner's own «c-…» products are only known that way); the route drops any id
 * the shop does not know when it writes the digest out.
 */
export function buildEntry(post: Post): GuideEntry {
  const products = post.products.filter((id, i, a) => a.indexOf(id) === i);
  const attached = new Set(products);
  const isProduct = (id: string) => CAT_BY_ID.has(id) || attached.has(id);
  const title = { RU: inLang(post.title, "RU"), ET: inLang(post.title, "ET"), EN: inLang(post.title, "EN") };
  const digest = {} as Record<Lang3, LangDigest>;
  const index: Index = { exact: new Map(), pre: new Map() };
  for (const l of LANGS) {
    const own = Boolean(post.body[l]);
    const { headings, ...d } = digestOf(title[l], post.body[l] || post.body.RU || "", products, isProduct);
    digest[l] = d;
    // an empty translation is the Russian text again — indexed once, not twice
    if (l === "RU" || post.title[l]) indexAdd(index, post.title[l] || "", FIELD.title);
    if (l === "RU" || post.excerpt[l]) indexAdd(index, post.excerpt[l] || "", FIELD.excerpt);
    if (l === "RU" || own) {
      for (const h of headings) indexAdd(index, h, FIELD.head);
      for (const line of d.lines) indexAdd(index, line.text.replace(ID_RX, " "), FIELD.lines);
    }
  }
  for (const t of [...post.tags, ...post.tagsI18n.ET, ...post.tagsI18n.EN]) indexAdd(index, t, FIELD.tags);
  for (const id of products) {
    const r = CAT_BY_ID.get(id);
    if (r) indexAdd(index, `${r.b} ${r.n}`, FIELD.names);
  }
  return { slug: post.slug, title, cover: post.coverUrl || null, products, digest, index };
}

/* ---------- ranking -------------------------------------------------------- */

export type Ranked = { entry: GuideEntry; score: number };

/**
 * The articles that fit a conversation, best first: at most MAX_GUIDES, each
 * scoring at least MIN_SCORE, the second at least SECOND_RATIO of the first.
 *
 * score = Σ over the conversation's stems of
 *           (how much that stem counts: 1 newest message, ½ earlier)
 *         × (the weights of the article's fields it is found in, added up)
 *         × (how rare it is across the blog: 1 in one article, less the more share it)
 *
 * The rarity is ln(1 + N/df) / ln(1 + N), which is 1 for a word only one
 * article has whatever N is — so the threshold means the same thing with
 * three articles in a test database and with forty in the shop. With it, one
 * title word of its own passes (3), one tag or heading of its own does not
 * unless the word stands somewhere else in the article too, and a product name
 * alone never does — «масло» is in half the catalogue.
 *
 * And at least one of the words that matched must be one the article does not
 * share with half the blog (rarity ≥ SPECIFIC): «волосы» on its own is in five
 * articles of six, and a guide picked for it would be a guess.
 */
export const SPECIFIC = 0.5;
export function rankArticles(entries: GuideEntry[], turns: string[]): { ranked: Ranked[]; q: Map<string, number>; rare: Map<string, number> } {
  const q = queryStems(turns);
  const rare = new Map<string, number>();
  const N = entries.length;
  if (!q.size || !N) return { ranked: [], q, rare };
  const scores = new Array<number>(N).fill(0);
  const specific = new Array<boolean>(N).fill(false);
  for (const [s, qw] of q) {
    const masks = entries.map((e) => indexMask(e.index, s));
    const df = masks.filter(Boolean).length;
    if (!df) continue;
    const r = Math.log(1 + N / df) / Math.log(1 + N);
    rare.set(s, r);
    masks.forEach((m, i) => {
      if (!m) return;
      scores[i] += qw * maskWeight(m) * r;
      if (r >= SPECIFIC) specific[i] = true;
    });
  }
  const order = entries
    .map((entry, i) => ({ entry, score: Math.round(scores[i] * 100) / 100, ok: specific[i] }))
    .filter((x) => x.ok && x.score >= MIN_SCORE)
    .map(({ entry, score }) => ({ entry, score }))
    .sort((a, b) => b.score - a.score);
  const ranked = order.filter((x, i) => i === 0 || x.score >= order[0].score * SECOND_RATIO).slice(0, MAX_GUIDES);
  return { ranked, q, rare };
}

/* ---------- the digest, written for one question --------------------------- */

export type StockOf = (id: string) => string | undefined;

/**
 * One article for the prompt, at most `cap` characters: its title and slug,
 * its sections, then its product lines — the ones that share the most words
 * with the question first (a word in the line itself counts fully, one in the
 * heading above it less), the rest in the article's order while there is
 * room, and the article's other products by id after that. A product sold out
 * right now is written `[id:out]`, and one the shop does not know is dropped.
 */
export function renderDigest(
  entry: GuideEntry,
  lang: Lang3,
  q: Map<string, number>,
  rare: Map<string, number>,
  stockOf: StockOf,
  opts: { pinned?: boolean; cap?: number; known?: (id: string) => boolean } = {},
): string {
  const cap = opts.cap ?? DIGEST_CAP;
  const known = opts.known ?? (() => true);
  const d = entry.digest[lang] ?? entry.digest.RU;
  const out = (id: string) => stockOf(id) === "out";
  const head =
    `ARTICLE ${entry.slug} — «${d.title}»` +
    (opts.pinned ? " — the customer opened the chat from this article: «эта статья», «здесь», «в ней» mean it" : "");
  const parts: string[] = [head];
  let used = head.length;
  const room = (s: string) => used + 1 + s.length <= cap;
  const push = (s: string) => {
    parts.push(s);
    used += 1 + s.length;
  };

  if (d.sections.length) {
    let s = "Sections: ";
    for (const h of d.sections) {
      const next = s === "Sections: " ? s + h : `${s} · ${h}`;
      if (next.length > 180) break;
      s = next;
    }
    if (s !== "Sections: " && room(s)) push(s);
  }

  const stemHit = (list: string[], qs: string) => list.some((x) => sameStem(qs, x));
  const scored = d.lines.map((line, i) => {
    let score = 0;
    for (const [s, w] of q) {
      const r = rare.get(s) ?? 0.5;
      if (stemHit(line.own, s)) score += w * r;
      else if (stemHit(line.ctx, s)) score += 0.4 * w * r;
    }
    return { line, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const shown = new Set<string>();
  for (const { line } of scored) {
    const ids = line.ids.filter(known);
    if (!ids.length) continue;
    const text = line.text.replace(ID_RX, (whole, id: string) =>
      !known(id) ? "" : out(id) ? `[${id}:out]` : whole,
    ).replace(/\s+([,.;:!?…])/g, "$1");
    const row = "- " + text;
    if (!room(row)) continue;
    push(row);
    for (const id of ids) shown.add(id);
  }

  const rest = entry.products.filter((id) => known(id) && !shown.has(id) && !out(id));
  if (rest.length) {
    let s = "Its other products: ";
    const lead = s;
    for (const id of rest) {
      const next = s === lead ? s + id : `${s}, ${id}`;
      if (!room(next)) break;
      s = next;
    }
    if (s !== lead) push(s);
  }
  return parts.join("\n");
}

/* ---------- the cache ------------------------------------------------------ */

type Store = { at: number; stamp: string; gen: number; entries: GuideEntry[] };
let store: Store | null = null;

/** Tests only: forget everything read. */
export function resetGuideCache(): void {
  store = null;
}

/**
 * Every published article as an entry, newest first — from memory, checked
 * against the database at most once a minute, re-read only when something the
 * public can see changed. On any trouble: what was read before (stale beats
 * nothing), else nothing at all, and the next try a minute later — a database
 * that is down must not be asked again by every message.
 */
export async function guideEntries(): Promise<GuideEntry[]> {
  const now = Date.now();
  const gen = blogGeneration();
  if (store && store.gen === gen && now - store.at < CHECK_MS) return store.entries;
  try {
    const stamp = await publishedStamp();
    if (store && store.stamp === stamp) {
      store = { ...store, at: now, gen };
      return store.entries;
    }
    const posts = await listPublishedFull(MAX_POSTS);
    const entries: GuideEntry[] = [];
    for (const p of posts) {
      try {
        entries.push(buildEntry(p));
      } catch (err) {
        // one article that cannot be read is one article fewer, never no chat
        console.error("[blog-digest] skipped", p.slug, err);
      }
    }
    store = { at: now, stamp, gen, entries };
  } catch {
    store = store ? { ...store, at: now, gen } : { at: now, stamp: "", gen, entries: [] };
  }
  return store.entries;
}

/* ---------- what the route asks -------------------------------------------- */

export type ShopGuides = {
  /** The BLOG ARTICLES list as it always was (slug|Russian title, newest first, up to 20), minus the digested ones. */
  list: string;
  /** The SALON GUIDES block, or "" when nothing fits. */
  block: string;
  /** The slugs in the block, best first. */
  offered: string[];
  bySlug: Map<string, GuideEntry>;
};

const SLUG_RX = /^[a-z0-9-]{1,80}$/;
/** A slug the request may pin — the shape, nothing more; whether it exists is the cache's answer. */
export function cleanSlug(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return SLUG_RX.test(s) ? s : "";
}

/**
 * The blog for one shop question: the plain list the prompt always had, and
 * the digests of the articles that fit. `pinned` — the article the shopper
 * opened the chat from (window.openChatAbout in chat.js) — is always the first
 * digest when it is published, whatever the question; the best other match
 * may join it.
 */
export function shopGuides(
  entries: GuideEntry[],
  args: { lang: Lang3; turns: string[]; pinned?: string; stockOf: StockOf; known?: (id: string) => boolean },
): ShopGuides {
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const { ranked, q, rare } = rankArticles(entries, args.turns);
  const picked: Array<{ entry: GuideEntry; pinned: boolean }> = [];
  const pin = args.pinned ? bySlug.get(args.pinned) : undefined;
  if (pin) picked.push({ entry: pin, pinned: true });
  for (const r of ranked) {
    if (picked.length >= MAX_GUIDES) break;
    if (!picked.some((p) => p.entry.slug === r.entry.slug)) picked.push({ entry: r.entry, pinned: false });
  }
  const block = picked
    .map((p, i) =>
      renderDigest(p.entry, args.lang, q, rare, args.stockOf, {
        pinned: p.pinned,
        cap: i === 0 ? DIGEST_CAP : DIGEST_CAP_SECOND,
        known: args.known,
      }),
    )
    .join("\n\n");
  const offered = picked.map((p) => p.entry.slug);
  const list = entries
    .slice(0, 20)
    .filter((e) => !offered.includes(e.slug))
    .map((e) => `${e.slug}|${e.title.RU || e.slug}`)
    .join("\n");
  return { list, block, offered, bySlug };
}

/** What the response carries for the card: the slug, the title in the shopper's language, the cover. */
export type ArticleCard = { slug: string; title: string; cover: string | null };

const PATH_RX = /(?:\/(?:ru|et|en))?\/blogs\/news\/([a-z0-9-]{1,80})\/?|\/shop2\/(?:et\/|en\/|ru\/)?blog\/([a-z0-9-]{1,80})\/?/gi;

/**
 * The article an answer is about, as the card under it: the "article" the
 * model named, or else the first /blogs/news/<slug> its sentence links — and
 * only ever a published article this shop has, never a slug the model made
 * up. The link that became the card is taken off the END of the sentence
 * (where the prompt asks for it), so the shopper does not read the same
 * article twice; a link in the middle of a sentence stays, and chat.js still
 * makes it a link (withBlogLinks).
 */
export function articleOfAnswer(
  named: unknown,
  reply: string,
  bySlug: Map<string, GuideEntry>,
  lang: Lang3,
): { card: ArticleCard | null; reply: string } {
  let slug = cleanSlug(named);
  if (!bySlug.has(slug)) slug = "";
  if (!slug) {
    for (const m of reply.matchAll(PATH_RX)) {
      const s = String(m[1] || m[2]).toLowerCase();
      if (bySlug.has(s)) {
        slug = s;
        break;
      }
    }
  }
  if (!slug) return { card: null, reply };
  const e = bySlug.get(slug)!;
  const tail = new RegExp(
    `[\\s:—–-]*(?:\\/(?:ru|et|en))?\\/blogs\\/news\\/${slug}\\/?[\\s.]*$`,
    "i",
  );
  const trimmed = reply.replace(tail, "").trim();
  return {
    card: { slug, title: e.title[lang] || e.title.RU || slug, cover: e.cover },
    reply: trimmed ? (/[.!?…»)]$/.test(trimmed) ? trimmed : trimmed + ".") : reply,
  };
}
