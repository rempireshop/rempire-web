/**
 * «Рассылка» as a stack of blocks — the letter Renat asked for.
 *
 * On 20.09.2026 he sent the letter he had in mind: an Aromatic 89 campaign
 * built entirely out of pictures, each one clicking through to a page of its
 * own, with a line of text here and there. On 23.09.2026 he tried to make one
 * in the panel's rich-text box and stopped at «paste a link to a picture»;
 * Dim: the setup has to be very simple and logical. So a letter is no longer
 * a document to type into but a list of blocks, each one a thing a thumb can
 * add, move and delete:
 *
 *   img      a picture (uploaded from the phone — src/lib/images.ts
 *            processEmailImage), optionally a link          → a banner
 *   text     a few lines, or a heading, in each language
 *   btn      a label in each language and a link           → a button
 *   product  a catalogue product                            → the usual card
 *   html     a letter written before blocks existed — its three bodies as
 *            they were, so an old draft opens and sends exactly as before
 *
 * A link is either an ordinary http(s) address or one of the shop's own
 * places, written as a token so the reader lands on it in their own language:
 * `home`, `blog`, `gift`, `cat:<id>`, `product:<id>`, `brand:<slug>`,
 * `post:<slug>` (src/emails/newsletter.ts shopLinkPath — one grammar, used by
 * the cleaning here and by the renderer).
 *
 * Nothing the panel sends is trusted: every field is cut to its type and its
 * length, a picture must be https (or a path on this shop), a link http(s)
 * or a token, text is plain text — the renderer escapes it — and the legacy
 * HTML goes through the blog's own allowlist.
 */
import { shopLinkPath } from "@/emails/newsletter";
import { sanitizeHtml } from "@/lib/blog";

export const BLOCK_LANGS = ["RU", "ET", "EN"] as const;
export type BlockLang = (typeof BLOCK_LANGS)[number];
export type BlockTri = Record<BlockLang, string>;

export interface ImageBlock {
  t: "img";
  src: string;
  /** "" — a picture that is only a picture. */
  href: string;
  alt: string;
}
export interface TextBlock {
  t: "text";
  /** p — paragraphs (a blank line between them); h — one heading line. */
  style: "p" | "h";
  text: BlockTri;
}
export interface ButtonBlock {
  t: "btn";
  text: BlockTri;
  href: string;
}
export interface ProductBlock {
  t: "product";
  id: string;
}
export interface HtmlBlock {
  t: "html";
  html: BlockTri;
}
export type NewsBlock = ImageBlock | TextBlock | ButtonBlock | ProductBlock | HtmlBlock;

export const BLOCKS_MAX = 40;
export const TEXT_MAX = 3000;
export const HEADING_MAX = 200;
export const BUTTON_MAX = 60;
export const ALT_MAX = 200;
export const URL_MAX = 1000;
export const HTML_MAX = 60_000;
/** Cards a letter can resolve — src/lib/newsletters.ts PRODUCTS_MAX. */
export const PRODUCT_BLOCKS_MAX = 8;

const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
/* Characters no address of ours ever needs and every injection wants. The
   renderer escapes what it writes anyway; this keeps the stored value clean. */
const UNSAFE_URL_CHARS = /[\s<>"'`\\]/;
/** A path on this shop — `/shop/img/…`, never `//host/…`. */
const SHOP_PATH_RE = /^\/(?!\/)[A-Za-z0-9._~%!$&()*+,;=:@/?#-]*$/;
/* Bidi overrides and isolates: invisible, and able to make a line read
   backwards. Zero-width joiners stay — emoji are built out of them. */
const BIDI_RE = /[‪-‮⁦-⁩]/g;

/* ---------- the fields ---------------------------------------------------- */

/** A picture: https anywhere, or a path on this shop. Everything else is "". */
export function cleanImageSrc(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s || s.length > URL_MAX || UNSAFE_URL_CHARS.test(s)) return "";
  if (s.startsWith("/")) return SHOP_PATH_RE.test(s) ? s : "";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "";
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return "";
  return s;
}

/** A link: a shop token, or an http(s) address. Everything else is "". */
export function cleanLink(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  if (shopLinkPath(s) !== null) return s;
  if (s.length > URL_MAX || UNSAFE_URL_CHARS.test(s)) return "";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "";
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !u.hostname) return "";
  return s;
}

/** One line: control characters gone, runs of space collapsed. */
function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(BIDI_RE, "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Paragraphs: newlines kept, at most one blank line in a row. */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(BIDI_RE, "")
    .replace(/\p{Cc}/gu, (ch) => (ch === "\n" ? "\n" : " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function tri(raw: unknown, clean: (v: unknown) => string): BlockTri {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out = { RU: "", ET: "", EN: "" } as BlockTri;
  for (const L of BLOCK_LANGS) out[L] = clean(src[L]);
  return out;
}

/** An allowlisted body is something when it has words, a picture or a product card. */
export function htmlHasContent(html: string): boolean {
  const s = String(html || "");
  const words = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
  return !!words || /<img\b|data-product=/.test(s);
}

/* ---------- one block, a list of them ------------------------------------- */

/** Null for anything that is not a block — or a picture with no picture. */
export function cleanBlock(raw: unknown): NewsBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.t === "img") {
    const src = cleanImageSrc(r.src);
    return src ? { t: "img", src, href: cleanLink(r.href), alt: cleanLine(r.alt, ALT_MAX) } : null;
  }
  if (r.t === "text") {
    const style = r.style === "h" ? "h" : "p";
    return { t: "text", style, text: tri(r.text, (v) => (style === "h" ? cleanLine(v, HEADING_MAX) : cleanText(v, TEXT_MAX))) };
  }
  if (r.t === "btn") {
    return { t: "btn", text: tri(r.text, (v) => cleanLine(v, BUTTON_MAX)), href: cleanLink(r.href) };
  }
  if (r.t === "product") {
    const id = typeof r.id === "string" ? r.id.trim() : "";
    return PRODUCT_ID_RE.test(id) ? { t: "product", id } : null;
  }
  if (r.t === "html") {
    const html = tri(r.html, (v) => {
      if (typeof v !== "string") return "";
      const clean = sanitizeHtml(v.slice(0, HTML_MAX));
      return htmlHasContent(clean) ? clean : "";
    });
    return BLOCK_LANGS.some((L) => html[L]) ? { t: "html", html } : null;
  }
  return null;
}

/**
 * The whole list, cleaned. Blocks the owner has only half-filled — a text
 * with no words yet, a button with no link yet — are KEPT: the draft is saved
 * mid-edit, and a block that vanished on «Сохранить» would be a lost edit.
 * They simply draw nothing until they are filled (src/emails/newsletter.ts).
 */
export function cleanBlocks(raw: unknown): NewsBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: NewsBlock[] = [];
  const products = new Set<string>();
  for (const item of raw) {
    if (out.length >= BLOCKS_MAX) break;
    const b = cleanBlock(item);
    if (!b) continue;
    if (b.t === "product") {
      // a card the letter could not resolve is a block that silently draws nothing
      if (!products.has(b.id) && products.size >= PRODUCT_BLOCKS_MAX) continue;
      products.add(b.id);
    }
    out.push(b);
  }
  return out;
}

/** The ids the letter's cards are resolved for: the product blocks, then the markers inside an old body. */
export function blocksProducts(blocks: NewsBlock[]): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (PRODUCT_ID_RE.test(id) && !out.includes(id) && out.length < PRODUCT_BLOCKS_MAX) out.push(id);
  };
  for (const b of blocks) if (b.t === "product") add(b.id);
  for (const b of blocks) {
    if (b.t !== "html") continue;
    for (const L of BLOCK_LANGS) {
      for (const m of b.html[L].matchAll(/data-product="([^"]+)"/g)) add(m[1]);
    }
  }
  return out;
}

/* ---------- what a language has ------------------------------------------ */

/** Does this block draw anything for a reader in `L`? */
export function blockHasContent(b: NewsBlock, L: BlockLang): boolean {
  if (b.t === "img") return !!b.src;
  if (b.t === "text") return !!b.text[L].trim();
  if (b.t === "btn") return !!b.text[L].trim() && !!b.href;
  if (b.t === "product") return true;
  return htmlHasContent(b.html[L]);
}

export function blocksHaveContent(blocks: NewsBlock[], L: BlockLang): boolean {
  return blocks.some((b) => blockHasContent(b, L));
}

/**
 * Every word the letter carries in some language is there in `L` too. A
 * reader whose language is not complete gets the Russian letter whole
 * (src/lib/newsletters.ts langFor) — never a letter with holes in it where
 * the Russian text was.
 */
export function blocksComplete(blocks: NewsBlock[], L: BlockLang): boolean {
  return blocks.every((b) => {
    if (b.t === "text" || b.t === "btn") return !BLOCK_LANGS.some((x) => b.text[x].trim()) || !!b.text[L].trim();
    if (b.t === "html") return !BLOCK_LANGS.some((x) => htmlHasContent(b.html[x])) || htmlHasContent(b.html[L]);
    return true;
  });
}
