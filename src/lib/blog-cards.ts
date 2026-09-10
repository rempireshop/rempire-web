/**
 * The product cards the article generator puts into its own text — chosen,
 * checked and placed here, on the server, so the article the owner opens
 * already has its products in it (Dim, 10.09.2026: today the cards could
 * only be added by hand; the assistant should pick 2–4 of the shop's own
 * products for the topic and put them into the draft itself).
 *
 * The card is the editor's own «Товар» marker, `<a data-product="ID">`, on
 * a line of its own — `<p><a data-product="ID"></a></p>`. The panel writes
 * the picture, the name and the price (blogCardsIn() in public/shop2/app.js),
 * the storefront swaps it for a real card, and the owner deletes it like any
 * other line. What this module decides is which ids stand where:
 *
 *   - the model's own cards stay where it put them, once each, and only for
 *     an id out of the list it was offered (`candidates` — the catalogue
 *     slice for the topic, in stock and not hidden; the route builds it). A
 *     card inside a heading is lifted out and put under the section's first
 *     paragraph, one inside a list right after the list; an unknown or a
 *     repeated id loses its tag and keeps its words, so an invented product
 *     can never become a card;
 *   - the ids the model only *named* (its `products` — a string or an
 *     `{id, after}` each) get a card after the paragraph `after` points at,
 *     a heading's words or the paragraph's number, or, without a usable
 *     hint, after the paragraph that names the product's brand, its name or
 *     its category most;
 *   - when that still leaves the article short of POST_CARDS_MIN cards, the
 *     best-fitting candidates are added the same way — scored against the
 *     topic and the article's own words, the slice's own order breaking
 *     ties — so a model that wrote no cards at all still yields an article
 *     with its products in it;
 *   - never two cards in a row, never more than POST_CARDS_MAX, and at least
 *     one card in the last third of the text — before the closing paragraph
 *     when there is room, so the article still ends in words.
 *
 * Pure: strings in, strings out; the catalogue and the database are the
 * route's business. Runs over sanitised HTML (sanitizeHtml() in src/lib/
 * blog.ts writes every tag bare and balanced and escapes every "<" in text),
 * which is what makes the tag-by-tag walk below sound.
 */
import { POST_CARDS_MAX, POST_CARDS_MIN, POST_PRODUCTS_MAX } from "@/lib/ai-prompts";

export interface CardCandidate {
  id: string;
  brand?: string;
  name?: string;
  category?: string;
}

/** One product the model named: an id, and where it belongs when it said so. */
export interface CardPick {
  id: string;
  /** A paragraph's number (from 1) or a few words of the heading the card goes under. */
  after?: number | string;
}

export interface PlacedCards {
  html: string;
  /** Every card standing in the text, in the order it stands. */
  cards: string[];
}

const ID_RX = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The model's `products`, whatever shape it chose — `["id"]` as the contract
 * asks, or `[{id, after}]` — as ids this shop could have, once each.
 */
export function readCardPicks(raw: unknown, max = POST_PRODUCTS_MAX): CardPick[] {
  if (!Array.isArray(raw)) return [];
  const out: CardPick[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let id = "";
    let after: number | string | undefined;
    if (typeof item === "string") id = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      id = typeof o.id === "string" ? o.id.trim() : "";
      if (typeof o.after === "number" && Number.isFinite(o.after)) after = Math.floor(o.after);
      else if (typeof o.after === "string" && o.after.trim()) after = o.after.trim().slice(0, 120);
    }
    id = id.slice(0, 80);
    if (!ID_RX.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(after === undefined ? { id } : { id, after });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------- the text as blocks --------------------------------------------- */

export interface Block {
  /** "p", "h2", "ul", … — or "text" for words standing between blocks. */
  tag: string;
  html: string;
  /** A card was unwrapped in here — the one case an emptied line is dropped. */
  touched?: boolean;
}

const TAG_RX = /<(\/?)([a-z][a-z0-9]*)(?:\s[^>]*)?>/gi;
const VOID = new Set(["br", "img"]);

/** Sanitised HTML → its top-level blocks, each with the tags inside it. */
export function splitBlocks(html: string): Block[] {
  const src = String(html || "");
  const out: Block[] = [];
  const text = (s: string) => {
    if (s.trim()) out.push({ tag: "text", html: s });
  };
  let depth = 0;
  let start = 0;
  let tag = "";
  let last = 0;
  TAG_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RX.exec(src))) {
    const name = m[2].toLowerCase();
    if (VOID.has(name)) continue;
    if (m[1] !== "/") {
      if (depth === 0) {
        text(src.slice(last, m.index));
        start = m.index;
        tag = name;
      }
      depth++;
      continue;
    }
    if (depth === 0) {
      // a stray close tag — sanitised html has none; the words before it stand, the tag goes
      text(src.slice(last, m.index));
      last = m.index + m[0].length;
      continue;
    }
    depth--;
    if (depth === 0) {
      last = m.index + m[0].length;
      out.push({ tag, html: src.slice(start, last) });
    }
  }
  if (depth > 0) out.push({ tag, html: src.slice(start) });
  else text(src.slice(last));
  return out;
}

const CARD_RX = /<a data-product="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
const P_SHELL_RX = /^<p>|<\/p>$/g;
const BLANK_RX = /<br>|&nbsp;|\s/g;

/** The ids of the cards in a piece of html, in order. */
export function cardIds(html: string): string[] {
  const ids: string[] = [];
  String(html || "").replace(CARD_RX, (m: string, id: string) => {
    ids.push(id);
    return m;
  });
  return ids;
}

function isParagraph(b: Block): boolean {
  return b.tag === "p" || b.tag === "text";
}
function hasCard(b: Block): boolean {
  return b.html.includes("data-product");
}
/** The id when the block is a card standing on a line of its own, else null. */
function cardAlone(b: Block): string | null {
  if (b.tag !== "p") return null;
  const ids = cardIds(b.html);
  if (ids.length !== 1) return null;
  const rest = b.html.replace(P_SHELL_RX, "").replace(CARD_RX, "").replace(BLANK_RX, "");
  return rest ? null : ids[0];
}
/** A paragraph with no card in it or on it. */
function isPlainParagraph(b: Block | undefined): b is Block {
  return !!b && isParagraph(b) && !hasCard(b);
}
/** A block a card may follow: not a heading (a card under a heading stands
    before the section's words), no card in it, no card right after it. */
function eligible(live: Block[], i: number): boolean {
  const b = live[i];
  if (!b || b.tag === "h2" || b.tag === "h3" || hasCard(b)) return false;
  const next = live[i + 1];
  return !(next && cardAlone(next)); // never two cards in a row
}
function cardBlock(id: string): Block {
  return { tag: "p", html: `<p><a data-product="${id}"></a></p>` };
}

/* ---------- words ------------------------------------------------------------ */

const ENT: Record<string, string> = { "&amp;": "&", "&nbsp;": " ", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
function plainText(html: string): string {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|nbsp|quot|#39|lt|gt);/g, (e) => ENT[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}
const SPLIT_RX = /[^a-zа-яёõäöüšž0-9]+/i;
function tokens(s: string): string[] {
  return String(s || "").toLowerCase().split(SPLIT_RX).filter((w) => w.length >= 3);
}
/* A Russian word changes its ending with the case — «борода», «бороды»,
   «бородой» — so a term is matched by its first letters: five of a long word,
   four of a five-letter one, the whole of a shorter one. */
function stem(w: string): string {
  return w.length >= 5 ? w.slice(0, Math.min(5, w.length - 1)) : w;
}
const STOP = new Set(["для", "без", "под", "при", "как", "или", "the", "and", "for", "with", "from", "ml", "мл"]);
/* The words an article uses for a category — Russian first, then Estonian
   and English, the same three the shop chat's slice keys on. Stems, since
   they are matched by prefix. */
const CAT_TERMS: Record<string, string[]> = {
  beard: ["бород", "усы", "усов", "брит", "щетин", "habe", "beard", "shav", "stubble"],
  hair: ["волос", "шампун", "кондиционер", "перхот", "juuks", "šampoon", "hair", "shampoo", "conditioner", "scalp"],
  styling: ["уклад", "стайлинг", "воск", "паст", "гель", "пудр", "глин", "soeng", "styling", "wax", "paste", "clay", "pomade"],
  face: ["лиц", "кож", "тоник", "крем", "сыворот", "nägu", "naha", "face", "skin", "toner", "serum"],
  body: ["тел", "мыл", "душ", "keha", "seep", "body", "soap", "shower"],
  perfume: ["аромат", "парфюм", "духи", "parfüüm", "lõhn", "perfume", "fragrance", "cologne"],
  merch: ["футболк", "мерч", "särk", "shirt", "merch"],
};

interface Terms {
  brand: string[];
  name: string[];
  cat: string[];
}
function termsOf(c: CardCandidate): Terms {
  const brand = tokens(c.brand || "").map(stem);
  const name = tokens(c.name || "")
    .filter((w) => !STOP.has(w))
    .map(stem)
    .filter((w) => !brand.includes(w));
  const cat = (CAT_TERMS[c.category || ""] || []).map(stem);
  return { brand, name, cat };
}
/** How much a text is about a product: its brand counts most, its name next, its category a little. */
function score(toks: string[], t: Terms): number {
  const has = (s: string) => toks.some((w) => w.startsWith(s));
  let n = 0;
  for (const b of t.brand) if (has(b)) n += 4;
  for (const w of t.name) if (has(w)) n += 2;
  let cat = 0;
  for (const w of t.cat) if (has(w)) cat++;
  return n + Math.min(cat, 2);
}
/** «Brand Name» without the bottle's size — two sizes of one oil are one product here. */
function sameKey(c: CardCandidate): string {
  return `${c.brand || ""} ${c.name || ""}`
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:мл|ml|гр|г|g|л|l)\b/g, " ")
    .replace(/[^a-zа-яёõäöüšž0-9]+/gi, " ")
    .trim();
}

/**
 * The candidates that fit a text best, best first — the fallback when the
 * model named fewer products than the article needs. Ids in `taken` are
 * skipped, and so is another size of a product already taken.
 */
export function rankCandidates(candidates: CardCandidate[], text: string, taken: Set<string> = new Set()): CardCandidate[] {
  const toks = tokens(text);
  const keys = new Set<string>();
  for (const c of candidates) if (taken.has(c.id)) keys.add(sameKey(c));
  const out: CardCandidate[] = [];
  candidates
    .map((c, i) => ({ c, i, s: score(toks, termsOf(c)) }))
    .filter(({ c }) => ID_RX.test(c.id) && !taken.has(c.id))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .forEach(({ c }) => {
      const k = sameKey(c);
      if (keys.has(k)) return;
      keys.add(k);
      out.push(c);
    });
  return out;
}

/* ---------- where a card goes ---------------------------------------------- */

interface Wanted {
  id: string;
  after?: number | string;
  /** The heading or list the card was lifted out of. */
  from?: Block;
}

/** The paragraphs of the text, in order — what a paragraph number counts. */
function paragraphs(live: Block[]): number[] {
  const out: number[] = [];
  live.forEach((b, i) => {
    if (isParagraph(b) && !cardAlone(b)) out.push(i);
  });
  return out;
}
/** The first paragraph after block `i` — where a card lifted out of a heading lands. */
function paragraphAfter(live: Block[], i: number): number {
  for (let j = i + 1; j < live.length; j++) if (isParagraph(live[j]) && !cardAlone(live[j])) return j;
  return i;
}
/** The paragraph in the middle of the longest stretch without a card — cards spread out, not bunched. */
function spreadAnchor(live: Block[]): number {
  const walls = [-1];
  live.forEach((b, i) => {
    if (hasCard(b)) walls.push(i);
  });
  walls.push(live.length);
  let from = -1;
  let to = -1;
  for (let k = 1; k < walls.length; k++) {
    if (walls[k] - walls[k - 1] > to - from) {
      from = walls[k - 1];
      to = walls[k];
    }
  }
  const mid = Math.floor((from + to) / 2);
  for (let d = 0; d < live.length; d++) {
    if (isPlainParagraph(live[mid + d]) && mid + d < to) return mid + d;
    if (isPlainParagraph(live[mid - d]) && mid - d > from) return mid - d;
  }
  return -1;
}
/** The paragraph a card should follow, before the «never two in a row» rule has its say. */
function preferredAnchor(live: Block[], w: Wanted, cand: CardCandidate): number {
  if (w.from) {
    const i = live.indexOf(w.from);
    // out of a heading: under the section's first paragraph; out of a list: right after the list
    if (i >= 0) return w.from.tag === "h2" || w.from.tag === "h3" ? paragraphAfter(live, i) : i;
  }
  const paras = paragraphs(live);
  if (typeof w.after === "number") {
    const at = paras[Math.max(0, w.after - 1)];
    if (at !== undefined) return at;
  } else if (typeof w.after === "string" && w.after.trim()) {
    const needle = w.after.trim().toLowerCase();
    const i = live.findIndex((b) => plainText(b.html).toLowerCase().includes(needle));
    if (i >= 0) return isParagraph(live[i]) && !cardAlone(live[i]) ? i : paragraphAfter(live, i);
  }
  const t = termsOf(cand);
  let best = -1;
  let bestScore = 0;
  for (const i of paras) {
    const s = score(tokens(plainText(live[i].html)), t);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  }
  if (best >= 0) return best;
  /* Nothing in the text names it. The last third first, while no card
     stands there — so a text that names none of its products still ends
     with one near the end — then the middle of the longest stretch
     without a card, so the rest spread out instead of bunching. */
  if (!live.some((b, i) => hasCard(b) && i >= lastThird(live))) {
    const at = lastThirdAnchor(live, cand);
    if (at >= 0) return at;
  }
  return spreadAnchor(live);
}
/** The paragraph the card goes after, or -1 when no place keeps the rules. */
function anchorFor(live: Block[], w: Wanted, cand: CardCandidate): number {
  const wanted = preferredAnchor(live, w, cand);
  if (wanted < 0) return -1;
  for (let i = wanted; i < live.length; i++) if (eligible(live, i)) return i;
  for (let i = wanted - 1; i >= 0; i--) if (eligible(live, i)) return i;
  return -1;
}
/** Where the last third of the text begins. */
function lastThird(live: Block[]): number {
  return Math.floor((live.length * 2) / 3);
}
/** The block in the last third a card fits best after — on a tie the later
    one, and the closing paragraph only when nothing else will do, so the
    article still ends in words. */
function lastThirdAnchor(live: Block[], cand: CardCandidate): number {
  const t = termsOf(cand);
  const last = live.length - 1;
  let best = -1;
  let bestScore = -1;
  for (let i = last - 1; i >= lastThird(live); i--) {
    if (!eligible(live, i)) continue;
    const s = score(tokens(plainText(live[i].html)), t);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  }
  if (best >= 0) return best;
  return eligible(live, last) ? last : -1;
}

/**
 * The article with its cards: the model's own kept in their places (once
 * each, known ids only, out of headings and lists), the products it named
 * given a card after the paragraph they belong to, the article filled up to
 * `min` cards from `candidates` when it is short, never two cards in a row,
 * at most `max`, one of them in the last third.
 */
export function placeArticleCards(
  html: string,
  picks: CardPick[],
  candidates: CardCandidate[],
  opts: { topic?: string; min?: number; max?: number } = {},
): PlacedCards {
  const min = Math.max(0, opts.min ?? POST_CARDS_MIN);
  const max = Math.max(min, opts.max ?? POST_CARDS_MAX);
  const known = new Map<string, CardCandidate>();
  for (const c of candidates || []) if (c && typeof c.id === "string" && ID_RX.test(c.id) && !known.has(c.id)) known.set(c.id, c);
  const blocks = splitBlocks(html);
  if (!blocks.length) return { html: String(html || ""), cards: [] };

  /* 1. the model's own cards: once each, known ids only; a card inside a
     heading or a list is lifted out, to go after the paragraph below it */
  const seen = new Set<string>();
  const queue: Wanted[] = [];
  for (const b of blocks) {
    if (!hasCard(b)) continue;
    const inline = isParagraph(b);
    b.html = b.html.replace(CARD_RX, (m: string, id: string, inner: string) => {
      if (!known.has(id) || seen.has(id)) {
        b.touched = true;
        return inner; // the tag goes, its words stay
      }
      seen.add(id);
      if (inline) return m;
      b.touched = true;
      queue.push({ id, from: b });
      return inner;
    });
  }
  // a line that held nothing but a card that is gone now
  const live = blocks.filter((b) => !(b.touched && b.tag === "p" && !b.html.replace(P_SHELL_RX, "").replace(BLANK_RX, "")));
  let have = seen.size;

  /* 2. the products the model named but gave no card */
  for (const p of picks || []) {
    if (have >= max) break;
    if (!known.has(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    have++;
    queue.push({ id: p.id, after: p.after });
  }
  /* 3. still short: the candidates that fit the topic and the text best */
  const ranked = () => rankCandidates(Array.from(known.values()), `${opts.topic || ""} ${plainText(live.map((b) => b.html).join(" "))}`, seen);
  if (have < min) {
    for (const c of ranked()) {
      if (have >= min) break;
      seen.add(c.id);
      have++;
      queue.push({ id: c.id });
    }
  }
  /* 4. each after the paragraph it belongs to — the rules decide the exact line */
  for (const w of queue) {
    const cand = known.get(w.id);
    if (!cand) continue;
    const at = anchorFor(live, w, cand);
    if (at >= 0) live.splice(at + 1, 0, cardBlock(w.id));
  }
  /* 5. one card in the last third: another product when there is room for
     one, else the last card moved there */
  const standing = live.map((b, i) => (hasCard(b) ? i : -1)).filter((i) => i >= 0);
  if (standing.length && !standing.some((i) => i >= lastThird(live))) {
    const inText = new Set(cardIds(live.map((b) => b.html).join("")));
    const more = inText.size < max ? ranked().filter((c) => !inText.has(c.id))[0] : undefined;
    if (more) {
      const at = lastThirdAnchor(live, more);
      if (at >= 0) live.splice(at + 1, 0, cardBlock(more.id));
    } else {
      const lastAt = standing[standing.length - 1];
      const id = cardAlone(live[lastAt]);
      if (id) {
        live.splice(lastAt, 1);
        const at = lastThirdAnchor(live, known.get(id) || { id });
        live.splice(at >= 0 ? at + 1 : lastAt, 0, cardBlock(id));
      }
    }
  }
  const out = live.map((b) => b.html).join("");
  return { html: out, cards: cardIds(out) };
}
