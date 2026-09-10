/**
 * «Рассылка» — the one letter the owner writes himself (src/lib/newsletters.ts).
 *
 * The body arrives as the HTML the blog's own allowlist lets through
 * (src/lib/blog.ts sanitizeHtml: p h2 h3 strong em ul ol li blockquote figure
 * br, a[href, data-product], img[src, alt] — text already escaped). A mail
 * client is not a browser, so nothing of that is passed through as it is:
 * every block is rebuilt here as one of the shell's table rows with the
 * shell's own inline styles (layout.ts — inline CSS only, tables only, every
 * colour with its background, absolute URLs), and the product marker the
 * editor's «Товар» button writes (`<a data-product="id">`) becomes a product
 * row — picture, brand and name in the reader's language, price, a button to
 * the product page. Products picked for the letter but not placed in the
 * text are drawn under it, in the order they were picked.
 *
 * Marketing letter: the footer carries «Отписаться» with the real per-mailbox
 * link (src/lib/consent.ts unsubscribeUrl), and the sender adds the RFC 8058
 * headers — the same pair the birthday and cart letters carry.
 */

import {
  C,
  COMMON,
  FONT_BODY,
  FONT_HEAD,
  absUrl,
  baseUrl,
  esc,
  money,
  normalizeLang,
  pick,
  rowTitle,
  shell,
  stripHtml,
  textBody,
  textFooter,
} from "./layout";
import type { Lang, RenderedEmail } from "./types";
import { translateProductName } from "../lib/product-name";

/* ---------- what the letter shows --------------------------------------- */

/** One product card — resolved by the sender (src/lib/newsletters.ts newsletterCards). */
export interface NewsletterCard {
  id: string;
  brand: string;
  /** The catalogue name, Russian type tail included — translated here. */
  name: string;
  /** The lowest price, EUR. */
  price: number;
  /** True when the sizes differ in price — «от 9 €». */
  priceFrom?: boolean;
  /** Absolute URL, or a path PUBLIC_BASE_URL is prefixed to. */
  img: string;
}

export interface NewsletterInput {
  subject: string;
  /** Allowlisted HTML (sanitizeHtml), in `lang`. */
  body: string;
  /** The cards, in the owner's order. */
  products?: NewsletterCard[];
  /** The per-mailbox link; falls back to the account page. */
  unsubscribeUrl?: string | null;
}

interface Strings {
  why: string;
  view: string;
  products: string;
  from: string;
  picture: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    why: "Вы получаете это письмо, потому что подписались на новости Rempire.",
    view: "Смотреть",
    products: "Товары",
    from: "от",
    picture: "Картинка",
  },
  et: {
    why: "Saate selle kirja, sest tellisite Rempire'i uudised.",
    view: "Vaata",
    products: "Tooted",
    from: "alates",
    picture: "Pilt",
  },
  en: {
    why: "You are getting this e-mail because you subscribed to Rempire news.",
    view: "View",
    products: "Products",
    from: "from",
    picture: "Picture",
  },
};

const SEG: Record<Lang, string> = { ru: "", et: "/et", en: "/en" };

/** `https://rempireshop.com/shop2/et/p/<id>/` — the product page in the reader's language. */
export function newsletterProductUrl(id: string, lang: Lang): string {
  return `${baseUrl()}/shop2${SEG[lang]}/p/${encodeURIComponent(id)}/`;
}

/* ---------- a tiny tree over the allowlisted HTML ------------------------ */

type Node = string | { tag: string; attrs: Record<string, string>; kids: Node[] };

/* The sanitiser writes every attribute double-quoted and every text run
   escaped, so one pattern covers the whole of what can be in a body: an
   open or close tag with its attributes, or a run of text. A bare "<" cannot
   occur — escapeText() turned it into "&lt;". */
const TOKEN_RE = /<(\/?)([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>|([^<]+)/gi;
const ATTR_RE = /([a-z-]+)="([^"]*)"/gi;
const VOID = new Set(["br", "img"]);
const INLINE = new Set(["strong", "em", "a", "br"]);

function parse(html: string): Node[] {
  const root: { kids: Node[] } = { kids: [] };
  const stack: Array<{ tag: string; attrs: Record<string, string>; kids: Node[] }> = [];
  const top = () => (stack.length ? stack[stack.length - 1].kids : root.kids);
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(html))) {
    if (m[4] !== undefined) {
      top().push(m[4]);
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (closing) {
      const at = stack.map((s) => s.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ATTR_RE.exec(m[3] || ""))) attrs[a[1].toLowerCase()] = a[2];
    const node = { tag, attrs, kids: [] as Node[] };
    top().push(node);
    if (!VOID.has(tag)) stack.push(node);
  }
  return root.kids;
}

/**
 * A text run for the plain-text part: entities decoded, nothing else
 * touched. Not stripHtml() — that one trims, and the space between «строка»
 * and a <strong> is a text run of its own that must keep its edges.
 */
function decodeText(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The plain words of a subtree — entities decoded, tags gone. */
function textOf(nodes: Node[]): string {
  return nodes
    .map((n) => (typeof n === "string" ? decodeText(n) : n.tag === "br" ? "\n" : textOf(n.kids)))
    .join("");
}

/** An `<a data-product>` on its own — the marker the «Товар» button writes. */
function markerOf(nodes: Node[]): string | null {
  let id: string | null = null;
  for (const n of nodes) {
    if (typeof n === "string") {
      if (stripHtml(n).trim()) return null;
      continue;
    }
    if (n.tag === "br") continue;
    if (n.tag === "a" && n.attrs["data-product"] && id === null) {
      id = n.attrs["data-product"];
      continue;
    }
    return null;
  }
  return id;
}

/* ---------- rows ----------------------------------------------------------- */

const BODY_STYLE = `font-family:${FONT_BODY}; font-size:15px; line-height:23px;`;

function cell(inner: string, pad: string): string {
  return `        <tr>
          <td class="em-px em-card" style="padding:${pad}; background-color:${C.card};">
${inner}
          </td>
        </tr>
`;
}

function paragraphRow(html: string): string {
  return cell(`            <p class="em-ink" style="margin:0; ${BODY_STYLE} color:${C.ink};">${html}</p>`, "0 48px 16px 48px");
}

function headingRow(text: string): string {
  return cell(
    `            <h2 class="em-ink" style="margin:0; font-family:${FONT_HEAD}; font-size:17px; line-height:24px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.ink};">${esc(text)}</h2>`,
    "12px 48px 10px 48px",
  );
}

function listRow(items: string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const lis = items
    .map((li) => `              <li class="em-ink" style="margin:0 0 6px 0; ${BODY_STYLE} color:${C.ink};">${li}</li>`)
    .join("\n");
  return cell(`            <${tag} class="em-ink" style="margin:0; padding:0 0 0 22px; color:${C.ink};">\n${lis}\n            </${tag}>`, "0 48px 12px 48px");
}

function quoteRow(html: string): string {
  return cell(
    `            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td class="em-hr em-card" style="border-left:2px solid ${C.line}; padding:2px 0 2px 16px; background-color:${C.card};">
                  <p class="em-muted" style="margin:0; ${BODY_STYLE} color:${C.muted};">${html}</p>
                </td>
              </tr>
            </table>`,
    "0 48px 16px 48px",
  );
}

function imageRow(src: string, alt: string): string {
  return cell(
    `            <img src="${esc(src)}" width="504" alt="${esc(alt)}" style="display:block; width:100%; max-width:504px; height:auto; border:0; outline:none;">`,
    "4px 48px 20px 48px",
  );
}

function labelRow(text: string): string {
  return cell(
    `            <p class="em-muted" style="margin:0; font-family:${FONT_HEAD}; font-size:12px; line-height:18px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">${esc(text)}</p>`,
    "12px 48px 4px 48px",
  );
}

/** Brand + name, the Russian type tail in the reader's language. */
function cardName(card: NewsletterCard, lang: Lang): string {
  const name = translateProductName(pick(card.name), lang);
  const brand = pick(card.brand);
  return brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
}

function cardPrice(card: NewsletterCard, lang: Lang, html: boolean): string {
  const p = money(card.price, html);
  return card.priceFrom ? `${T[lang].from}${html ? "&nbsp;" : " "}${p}` : p;
}

/** Picture · brand · name · price · a button to the product page. */
function productRow(card: NewsletterCard, lang: Lang): string {
  const url = newsletterProductUrl(card.id, lang);
  const name = cardName(card, lang);
  const img = absUrl(card.img, "/brand/rempire-tower.svg");
  return cell(
    `            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td width="88" valign="top" class="em-card" style="padding:0 16px 0 0; background-color:${C.card};">
                  <a href="${esc(url)}" style="text-decoration:none;"><img src="${esc(img)}" width="88" height="88" alt="${esc(name)}" style="display:block; width:88px; height:88px; border:1px solid ${C.line}; background-color:#ffffff;"></a>
                </td>
                <td valign="top" class="em-card" style="background-color:${C.card};">
                  <p class="em-muted" style="margin:0; font-family:${FONT_HEAD}; font-size:11px; line-height:16px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">${esc(card.brand)}</p>
                  <p class="em-ink" style="margin:2px 0 0 0; ${BODY_STYLE} font-weight:bold; color:${C.ink};"><a href="${esc(url)}" class="em-ink" style="color:${C.ink}; text-decoration:none;">${esc(translateProductName(pick(card.name), lang))}</a></p>
                  <p class="em-ink" style="margin:4px 0 0 0; font-family:${FONT_BODY}; font-size:14px; line-height:21px; color:${C.ink};">${cardPrice(card, lang, true)}</p>
                  <p style="margin:10px 0 0 0;"><a href="${esc(url)}" class="em-ink" style="display:inline-block; padding:12px 18px; border:1px solid ${C.ink}; font-family:${FONT_HEAD}; font-size:12px; line-height:16px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.ink}; text-decoration:none;">${esc(T[lang].view)}</a></p>
                </td>
              </tr>
            </table>`,
    "4px 48px 16px 48px",
  );
}

/* ---------- inline content ---------------------------------------------- */

/** Text with <strong>, <em>, <br> and links — in the shell's own styles. */
function inlineHtml(nodes: Node[], lang: Lang, cards: Map<string, NewsletterCard>): string {
  return nodes
    .map((n) => {
      if (typeof n === "string") return n;
      if (n.tag === "br") return "<br>";
      if (n.tag === "strong") return `<strong style="font-weight:bold;">${inlineHtml(n.kids, lang, cards)}</strong>`;
      if (n.tag === "em") return `<em style="font-style:italic;">${inlineHtml(n.kids, lang, cards)}</em>`;
      if (n.tag === "a") {
        const pid = n.attrs["data-product"];
        const href = pid ? newsletterProductUrl(pid, lang) : absUrl(n.attrs.href, "/shop2/");
        const card = pid ? cards.get(pid) : undefined;
        const inner = textOf(n.kids).trim() ? inlineHtml(n.kids, lang, cards) : esc(card ? cardName(card, lang) : href);
        return `<a href="${esc(href)}" class="em-link" style="color:${C.ink}; text-decoration:underline;">${inner}</a>`;
      }
      // a block inside a line (an <img> in a paragraph, a nested list): its words stay
      return inlineHtml(n.kids, lang, cards);
    })
    .join("");
}

/** The same line for the plain-text part: links as «text (url)». */
function inlineText(nodes: Node[], lang: Lang, cards: Map<string, NewsletterCard>): string {
  return nodes
    .map((n) => {
      if (typeof n === "string") return decodeText(n);
      if (n.tag === "br") return "\n";
      if (n.tag === "a") {
        const pid = n.attrs["data-product"];
        const href = pid ? newsletterProductUrl(pid, lang) : absUrl(n.attrs.href, "/shop2/");
        const card = pid ? cards.get(pid) : undefined;
        const words = textOf(n.kids).trim() || (card ? cardName(card, lang) : "");
        return words ? `${words} (${href})` : href;
      }
      return inlineText(n.kids, lang, cards);
    })
    .join("")
    .replace(/[ \t]{2,}/g, " ");
}

/* ---------- the walk ---------------------------------------------------- */

interface Built {
  rows: string[];
  text: string[];
  /** The first paragraph's words — the inbox preview line. */
  preheader: string;
  placed: Set<string>;
}

function build(html: string, lang: Lang, cards: Map<string, NewsletterCard>): Built {
  const t = T[lang];
  const out: Built = { rows: [], text: [], preheader: "", placed: new Set() };
  let pending: Node[] = [];

  const flushParagraph = () => {
    if (!pending.length) return;
    const nodes = pending;
    pending = [];
    const words = textOf(nodes).trim();
    if (!words && !nodes.some((n) => typeof n !== "string" && n.tag === "a")) return;
    const marker = markerOf(nodes);
    if (marker && cards.has(marker)) {
      product(cards.get(marker)!);
      return;
    }
    out.rows.push(paragraphRow(inlineHtml(nodes, lang, cards)));
    out.text.push(inlineText(nodes, lang, cards).trim(), "");
    if (!out.preheader && words) out.preheader = words;
  };
  const product = (card: NewsletterCard) => {
    out.placed.add(card.id);
    out.rows.push(productRow(card, lang));
    out.text.push(`${cardName(card, lang)} — ${cardPrice(card, lang, false)}: ${newsletterProductUrl(card.id, lang)}`, "");
  };
  const image = (attrs: Record<string, string>) => {
    const src = pick(attrs.src);
    if (!src) return;
    const abs = absUrl(src, "/shop2/");
    const alt = stripHtml(pick(attrs.alt)) || t.picture;
    out.rows.push(imageRow(abs, alt));
    out.text.push(`${alt}: ${abs}`, "");
  };
  const block = (n: Exclude<Node, string>) => {
    if (n.tag === "p") {
      pending = n.kids;
      flushParagraph();
      return;
    }
    if (n.tag === "h2" || n.tag === "h3") {
      const words = textOf(n.kids).trim();
      if (!words) return;
      out.rows.push(headingRow(words));
      out.text.push(words.toUpperCase(), "");
      return;
    }
    if (n.tag === "ul" || n.tag === "ol") {
      const items = n.kids.filter((k): k is Exclude<Node, string> => typeof k !== "string" && k.tag === "li");
      const kept = items.filter((li) => textOf(li.kids).trim());
      if (!kept.length) return;
      out.rows.push(listRow(kept.map((li) => inlineHtml(li.kids, lang, cards)), n.tag === "ol"));
      kept.forEach((li, i) => out.text.push(`  ${n.tag === "ol" ? `${i + 1}.` : "-"} ${inlineText(li.kids, lang, cards).trim()}`));
      out.text.push("");
      return;
    }
    if (n.tag === "blockquote") {
      const words = textOf(n.kids).trim();
      if (!words) return;
      out.rows.push(quoteRow(inlineHtml(n.kids, lang, cards)));
      out.text.push(`  «${inlineText(n.kids, lang, cards).trim()}»`, "");
      return;
    }
    if (n.tag === "figure") {
      for (const k of n.kids) if (typeof k !== "string" && k.tag === "img") image(k.attrs);
      return;
    }
    if (n.tag === "img") {
      image(n.attrs);
      return;
    }
    // li outside a list, or anything else the allowlist admits: its words as a paragraph
    pending = n.kids;
    flushParagraph();
  };

  for (const n of parse(html)) {
    if (typeof n === "string" || INLINE.has(n.tag)) {
      pending.push(n);
      continue;
    }
    flushParagraph();
    block(n);
  }
  flushParagraph();
  return out;
}

/* ---------- the letter -------------------------------------------------- */

export function renderNewsletter(input: NewsletterInput, lang: Lang | string = "ru"): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];
  const subject = pick(input.subject, "Rempire");
  const cards = new Map<string, NewsletterCard>();
  for (const p of input.products ?? []) if (p && p.id && !cards.has(p.id)) cards.set(p.id, p);

  const built = build(String(input.body ?? ""), L, cards);
  const rest = [...cards.values()].filter((p) => !built.placed.has(p.id));

  let body = rowTitle(subject) + `        <tr><td class="em-card" style="padding:0 0 12px 0; background-color:${C.card};"></td></tr>\n` + built.rows.join("");
  const text = [subject.toUpperCase(), "", ...built.text];
  if (rest.length) {
    body += labelRow(t.products) + rest.map((p) => productRow(p, L)).join("");
    text.push(t.products.toUpperCase(), "");
    for (const p of rest) text.push(`${cardName(p, L)} — ${cardPrice(p, L, false)}: ${newsletterProductUrl(p.id, L)}`, "");
  }
  // the last row keeps the card's bottom clear of the footer's rule
  body += `        <tr><td class="em-card" style="padding:0 0 24px 0; background-color:${C.card};"></td></tr>\n`;

  const unsubscribe = absUrl(input.unsubscribeUrl, "/shop2/account/");
  const footerNote =
    `${esc(t.why)} <a href="${esc(unsubscribe)}" class="em-link" style="color:#6f6b57; text-decoration:underline;">${esc(c.unsubscribe)}</a>`;

  const html = shell({
    lang: L,
    title: subject,
    preheader: (built.preheader || subject).slice(0, 140),
    body,
    footerNote,
  });

  return {
    subject,
    html,
    text: textBody([...text, textFooter(L, `${t.why} ${c.unsubscribe}: ${unsubscribe}`)]),
  };
}
