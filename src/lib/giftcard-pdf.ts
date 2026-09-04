/**
 * The printable gift card — one A5 landscape PDF per issued code.
 *
 * Why a PDF at all: the code arrives by e-mail, but a gift is handed over. A
 * card that can be printed (or shown full-screen) is the difference between
 * "forward this e-mail" and an actual present. It is made on the paid
 * transition, next to the codes themselves (src/lib/mail-hooks.ts →
 * sendGiftCards), attached to the gift-card letter, stored in R2 when the
 * bucket is configured, and served from
 *
 *     GET /api/giftcards/<code>/pdf/?t=<token>
 *
 * `t` is an HMAC of the code under SESSION_SECRET (giftPdfToken below), so the
 * address cannot be guessed from the code and the code cannot be guessed from
 * the address. It is a bearer link, exactly like the e-mail that carries it:
 * anyone holding the URL holds the card. That is the point — the buyer forwards
 * it to whoever the present is for.
 *
 * Library: `pdf-lib` + `@pdf-lib/fontkit`. Chosen over a headless browser (a
 * ~300 MB dependency for one page) and over PDFKit (no serverless-friendly font
 * story); it is ~1 MB, pure JS, and runs in the Node runtime unchanged.
 *
 * Fonts: three TTFs committed to `public/fonts/` — Oswald Medium (the display
 * face, matching the shop), Golos Text Regular (body) and PT Mono Regular (the
 * code). All three are SIL Open Font License 1.1 (docs/features.md § «Шрифты
 * подарочной карты»); all three carry Cyrillic, so the Russian and Estonian
 * cards are typeset in the real letters rather than transliterated. They are
 * read from disk once per process — never downloaded at build or run time.
 *
 * The tower comes from public/brand/rempire-tower.svg as a real vector path
 * (pdf-lib's drawSvgPath), so the mark stays sharp at any print size.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/* ---------- the URL and its token ---------------------------------------- */

/** Storage key inside the media bucket — lower case, one file per code. */
export function giftPdfKey(code: string): string {
  return `giftcards/${String(code || "").toLowerCase()}.pdf`;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 16 ? s : "";
}

/**
 * `HMAC-SHA256("giftcard-pdf:v1:" + code)` under SESSION_SECRET, base64url,
 * truncated to 32 characters (192 bits — far past guessable, short enough that
 * the link still fits on one line of an e-mail).
 *
 * Empty string when SESSION_SECRET is unset: without a key there is nothing to
 * sign, and verifyGiftPdfToken() then refuses everything rather than accepting
 * anything.
 */
export function giftPdfToken(code: string): string {
  const key = secret();
  if (!key || !code) return "";
  return createHmac("sha256", key)
    .update(`giftcard-pdf:v1:${String(code).toUpperCase()}`)
    .digest("base64url")
    .slice(0, 32);
}

/** Constant-time compare. False for a missing key, a missing token, any mismatch. */
export function verifyGiftPdfToken(code: string, token: string | null | undefined): boolean {
  const want = giftPdfToken(code);
  if (!want || !token) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The path the receipt screen, the letter and the admin card all link to. */
export function giftPdfPath(code: string): string {
  const c = String(code || "").toUpperCase();
  return `/api/giftcards/${encodeURIComponent(c)}/pdf/?t=${encodeURIComponent(giftPdfToken(c))}`;
}

/** `rempire-gift-card-RMP-ACDE-4679.pdf` — the name the download lands under. */
export function giftPdfFilename(code: string): string {
  return `rempire-gift-card-${String(code || "card").toUpperCase()}.pdf`;
}

/* ---------- assets on disk ------------------------------------------------ */

export class GiftPdfError extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

/**
 * `public/…` from wherever the process happens to be rooted. In `next dev`,
 * `next start`, vitest and a Vercel function alike that is the project root —
 * the serverless bundle gets the files through `outputFileTracingIncludes` in
 * next.config.ts, which copies them next to the function under the same
 * relative path.
 */
const ASSET_ROOTS = [process.cwd(), path.join(process.cwd(), "..")];

function readAsset(rel: string): Buffer {
  let lastErr: unknown = null;
  for (const root of ASSET_ROOTS) {
    try {
      return readFileSync(path.join(root, rel));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new GiftPdfError("asset_missing", `${rel} (${lastErr instanceof Error ? lastErr.message : "not found"})`);
}

/** Read once per process — three files, ~215 KB in total. */
let fontCache: { display: Buffer; body: Buffer; mono: Buffer } | null = null;

export function giftPdfFonts(): { display: Buffer; body: Buffer; mono: Buffer } {
  if (!fontCache) {
    fontCache = {
      display: readAsset("public/fonts/Oswald-Medium.ttf"),
      body: readAsset("public/fonts/GolosText-Regular.ttf"),
      mono: readAsset("public/fonts/PTMono-Regular.ttf"),
    };
  }
  return fontCache;
}

/**
 * The tower's single `<path d="…">` plus its viewBox, straight out of the brand
 * file. A brand SVG that ever grows a second path, a `<g transform>` or a
 * gradient stops being drawable this way — so a shape this cannot read is not
 * approximated, it is simply left off the card (drawTower() below).
 */
let towerCache: { d: string; box: [number, number, number, number] } | null | undefined;

export function towerPath(): { d: string; box: [number, number, number, number] } | null {
  if (towerCache !== undefined) return towerCache;
  towerCache = null;
  try {
    const svg = readAsset("public/brand/rempire-tower.svg").toString("utf8");
    const d = /\sd="([^"]+)"/.exec(svg)?.[1];
    const view = /viewBox="([^"]+)"/.exec(svg)?.[1];
    const nums = view ? view.trim().split(/[\s,]+/).map(Number) : [];
    if (d && nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
      towerCache = { d, box: [nums[0], nums[1], nums[2], nums[3]] };
    }
  } catch {
    /* no mark on the card is a cosmetic loss, never a failed gift card */
  }
  return towerCache;
}

/* ---------- copy ---------------------------------------------------------- */

export type PdfLang = "ru" | "et" | "en";

export function pdfLang(lang: unknown): PdfLang {
  const s = String(lang ?? "").toLowerCase().slice(0, 2);
  return s === "et" ? "et" : s === "en" ? "en" : "ru";
}

interface Strings {
  title: string;
  amountLabel: string;
  codeLabel: string;
  validUntil: (date: string) => string;
  from: (name: string) => string;
  to: (name: string) => string;
  messageLabel: string;
  how: (site: string) => string;
  balanceNote: string;
}

const T: Record<PdfLang, Strings> = {
  ru: {
    title: "Подарочная карта",
    amountLabel: "Номинал",
    codeLabel: "Код карты",
    validUntil: (d) => `Действует до ${d}`,
    from: (n) => `От: ${n}`,
    to: (n) => `Кому: ${n}`,
    messageLabel: "Пожелание",
    how: (site) =>
      `Как использовать: введите код в поле «Промокод или подарочная карта» при оформлении на ${site}`,
    balanceNote: "Остаток сохраняется на карте до следующего заказа.",
  },
  et: {
    title: "Kinkekaart",
    amountLabel: "Väärtus",
    codeLabel: "Kaardi kood",
    validUntil: (d) => `Kehtib kuni ${d}`,
    from: (n) => `Kellelt: ${n}`,
    to: (n) => `Kellele: ${n}`,
    messageLabel: "Soov",
    how: (site) =>
      `Kuidas kasutada: sisesta kood kassas väljale «Sooduskood või kinkekaart» aadressil ${site}`,
    balanceNote: "Jääk jääb kaardile järgmise tellimuse jaoks.",
  },
  en: {
    title: "Gift card",
    amountLabel: "Value",
    codeLabel: "Card code",
    validUntil: (d) => `Valid until ${d}`,
    from: (n) => `From: ${n}`,
    to: (n) => `To: ${n}`,
    messageLabel: "Message",
    how: (site) =>
      `How to use it: enter the code in the “Promo code or gift card” field at checkout on ${site}`,
    balanceNote: "Whatever is left stays on the card for the next order.",
  },
};

/** `2027-09-04` → `04.09.2027`. One format in all three languages: it is a date
 *  printed on a card, and dd.mm.yyyy is what Estonia reads. */
export function humanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "");
}

/** «50 €» — the card prints whole euros, and cents when a card ever has them. */
function euro(amount: number): string {
  const v = Math.round((Number(amount) || 0) * 100) / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) + " €";
}

/* ---------- the card itself ----------------------------------------------- */

export interface GiftPdfCard {
  code: string;
  amount: number;
  lang?: string | null;
  createdAt?: string | Date | null;
  /** `YYYY-MM-DD`; derived from createdAt (giftValidUntil) when absent. */
  validUntil?: string | null;
  recipient?: {
    name?: string | null;
    from?: string | null;
    message?: string | null;
  } | null;
}

export interface GiftPdfShop {
  legalName: string;
  address: string;
  /** Printed inside «Как использовать …»; the shop's public domain. */
  site: string;
}

export const DEFAULT_SHOP: GiftPdfShop = {
  legalName: "Rempire Store OÜ",
  address: "Mardi 1, 10145 Tallinn",
  site: "rempireshop.com",
};

/* A5 landscape, in points: 210 × 148 mm. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 419.53;

const INK = rgb(0x1c / 255, 0x1a / 255, 0x00 / 255);   // --ink, public/shop2/styles.css
const PAPER = rgb(0xfd / 255, 0xfc / 255, 0xf9 / 255); // --paper
const MUTED = rgb(0.42, 0.41, 0.35);

/** Control characters would land in the PDF as blanks or break a line; a card
 *  is also not the place for a thousand-character "message". */
function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Greedy wrap by measured width — pdf-lib has no text box of its own. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 4): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/**
 * pdf-lib draws an SVG path in SVG's own coordinate frame (y downwards) with
 * (x, y) as the origin, so the viewBox offset has to be undone by hand —
 * otherwise a mark whose box starts at (292, 171) lands that far off the page.
 */
function drawTower(page: PDFPage, left: number, top: number, height: number, colour = PAPER): void {
  const tower = towerPath();
  if (!tower) return;
  const [minX, minY, , boxH] = tower.box;
  const scale = height / boxH;
  page.drawSvgPath(tower.d, {
    x: left - minX * scale,
    y: top + minY * scale,
    scale,
    color: colour,
    borderWidth: 0,
  });
}

/** The wordmark: Oswald caps, tracked out by hand (pdf-lib has no letter-spacing). */
function drawWordmark(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, colour: ReturnType<typeof rgb>, tracking = 2.4): number {
  let cursor = x;
  for (const ch of text) {
    page.drawText(ch, { x: cursor, y, size, font, color: colour });
    cursor += font.widthOfTextAtSize(ch, size) + tracking;
  }
  return cursor - tracking - x;
}

/**
 * One A5 landscape page. Pure: everything it prints comes from its arguments,
 * so a test can assert the layout without a database or a network.
 */
export async function renderGiftCardPdf(
  card: GiftPdfCard,
  opts: { shop?: GiftPdfShop; lang?: string | null } = {},
): Promise<Uint8Array> {
  const code = clean(card.code, 40).toUpperCase();
  if (!code) throw new GiftPdfError("bad_code");
  const L = pdfLang(opts.lang ?? card.lang);
  const t = T[L];
  const shop = opts.shop ?? DEFAULT_SHOP;

  const fonts = giftPdfFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // subset: true keeps the file at ~25 KB instead of ~220 KB — three full
  // Cyrillic faces would otherwise ride along in every letter's attachment.
  const display = await doc.embedFont(fonts.display, { subset: true });
  const body = await doc.embedFont(fonts.body, { subset: true });
  const mono = await doc.embedFont(fonts.mono, { subset: true });

  doc.setTitle(`Rempire — ${t.title} ${code}`);
  doc.setSubject(t.title);
  doc.setProducer("rempireshop.com");
  doc.setCreator("rempireshop.com");

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: PAPER });

  /* Every baseline on the card, spelled out rather than derived one from the
     next: the block above the footer grows (a message may take three lines, or
     none), and a chain of `y -= …` is exactly how a long message ends up
     printed over the shop's address. MARGIN is the printable inset — A5 on a
     home printer loses about 10 mm, and nothing here goes near it. */
  const MARGIN = 44;
  const BAND = 86;                          // the ink strip along the top
  const BAND_BOTTOM = PAGE_HEIGHT - BAND;   // 333.53
  const AMOUNT_LABEL_Y = 300;
  const AMOUNT_Y = 252;
  const CODE_BOX_Y = 244;
  const CODE_BOX_H = 62;
  const VALID_Y = 214;
  const WHOM_Y = 192;
  const MESSAGE_LABEL_Y = 170;
  const MESSAGE_Y = 154;
  const MESSAGE_STEP = 15;
  const MESSAGE_LINES = 3;
  const RULE_Y = 82;
  const HOW_Y = 66;
  const HOW_STEP = 13;
  const BALANCE_Y = 38;
  const LEGAL_Y = 20;

  /* ---- header band: the tower, then the wordmark ---- */
  page.drawRectangle({ x: 0, y: BAND_BOTTOM, width: PAGE_WIDTH, height: BAND, color: INK });
  drawTower(page, MARGIN, PAGE_HEIGHT - 15, 56);
  drawWordmark(page, "REMPIRE", MARGIN + 48, BAND_BOTTOM + 30, display, 26, PAPER, 3.4);
  page.drawText(t.title.toUpperCase(), {
    x: MARGIN + 48,
    y: BAND_BOTTOM + 15,
    size: 9,
    font: body,
    color: rgb(0.78, 0.77, 0.72),
  });

  /* ---- amount, left ---- */
  page.drawText(t.amountLabel.toUpperCase(), { x: MARGIN, y: AMOUNT_LABEL_Y, size: 8, font: body, color: MUTED });
  page.drawText(euro(card.amount), { x: MARGIN, y: AMOUNT_Y, size: 48, font: display, color: INK });

  /* ---- code, right, boxed, in PT Mono ---- */
  const boxW = 250;
  const boxX = PAGE_WIDTH - MARGIN - boxW;
  page.drawRectangle({
    x: boxX,
    y: CODE_BOX_Y,
    width: boxW,
    height: CODE_BOX_H,
    borderColor: INK,
    borderWidth: 1,
    color: PAPER,
  });
  page.drawText(t.codeLabel.toUpperCase(), {
    x: boxX + 16,
    y: CODE_BOX_Y + CODE_BOX_H - 20,
    size: 8,
    font: body,
    color: MUTED,
  });
  page.drawText(code, { x: boxX + 16, y: CODE_BOX_Y + 16, size: 20, font: mono, color: INK });

  /* ---- how long it is good for ---- */
  const validUntil = clean(card.validUntil, 10) || isoPlusYear(card.createdAt);
  page.drawText(t.validUntil(humanDate(validUntil)), { x: MARGIN, y: VALID_Y, size: 11, font: body, color: INK });

  /* ---- who it is for, who it is from, and what they wrote ---- */
  const from = clean(card.recipient?.from, 80);
  const to = clean(card.recipient?.name, 80);
  const message = clean(card.recipient?.message, 300);
  const whom = [to ? t.to(to) : "", from ? t.from(from) : ""].filter(Boolean).join("   ·   ");
  if (whom) {
    page.drawText(whom, { x: MARGIN, y: WHOM_Y, size: 10, font: body, color: MUTED });
  }
  if (message) {
    const lines = wrapText(message, body, 12, PAGE_WIDTH - 2 * MARGIN - 16, MESSAGE_LINES);
    page.drawText(t.messageLabel.toUpperCase(), { x: MARGIN, y: MESSAGE_LABEL_Y, size: 8, font: body, color: MUTED });
    // a hairline down the left of the quote, exactly as tall as the quote is
    page.drawLine({
      start: { x: MARGIN, y: MESSAGE_Y + 11 },
      end: { x: MARGIN, y: MESSAGE_Y - (lines.length - 1) * MESSAGE_STEP - 3 },
      thickness: 1,
      color: INK,
    });
    lines.forEach((line, i) => {
      page.drawText(line, { x: MARGIN + 10, y: MESSAGE_Y - i * MESSAGE_STEP, size: 12, font: body, color: INK });
    });
  }

  /* ---- how to use it, and who is behind the card ---- */
  page.drawLine({
    start: { x: MARGIN, y: RULE_Y },
    end: { x: PAGE_WIDTH - MARGIN, y: RULE_Y },
    thickness: 0.7,
    color: rgb(0.82, 0.81, 0.76),
  });
  wrapText(t.how(shop.site), body, 9.5, PAGE_WIDTH - 2 * MARGIN, 2).forEach((line, i) => {
    page.drawText(line, { x: MARGIN, y: HOW_Y - i * HOW_STEP, size: 9.5, font: body, color: INK });
  });
  page.drawText(t.balanceNote, { x: MARGIN, y: BALANCE_Y, size: 8.5, font: body, color: MUTED });
  page.drawText(clean([shop.legalName, shop.address].filter(Boolean).join(" · "), 160), {
    x: MARGIN,
    y: LEGAL_Y,
    size: 8,
    font: body,
    color: MUTED,
  });

  return doc.save();
}

/** createdAt + GIFT_VALID_MONTHS, without importing the db-backed module. */
function isoPlusYear(createdAt: GiftPdfCard["createdAt"]): string {
  const base = createdAt ? new Date(createdAt) : new Date();
  const d = Number.isNaN(base.getTime()) ? new Date() : new Date(base.getTime());
  d.setUTCMonth(d.getUTCMonth() + 12);
  return d.toISOString().slice(0, 10);
}

/* ---------- the convenience wrapper the app actually calls ---------------- */

/**
 * The shop's own name and address for the card's foot, out of
 * `settings.content` (Настройки → Контент). Best effort, exactly like the
 * letters' footer (src/lib/mail-hooks.ts loadBrand): a settings query that
 * fails must not cost a paying customer their gift card.
 */
export async function giftPdfShop(): Promise<GiftPdfShop> {
  try {
    const [{ getSettings }, { mergeContent }] = await Promise.all([
      import("@/lib/orders"),
      import("@/lib/content"),
    ]);
    const content = mergeContent((await getSettings()).content);
    return {
      legalName: content.company.legalName || DEFAULT_SHOP.legalName,
      address: content.company.address || DEFAULT_SHOP.address,
      site: DEFAULT_SHOP.site,
    };
  } catch {
    return DEFAULT_SHOP;
  }
}

/** Render one card with the shop's live details. Throws GiftPdfError only. */
export async function buildGiftCardPdf(card: GiftPdfCard, lang?: string | null): Promise<Uint8Array> {
  return renderGiftCardPdf(card, { shop: await giftPdfShop(), lang: lang ?? card.lang });
}

/* ---------- the copy kept in the bucket ----------------------------------- */

/**
 * Put the card in R2 under `giftcards/<code>.pdf` when the bucket is
 * configured, so the download link does not re-render the PDF on every open and
 * the file survives a font or layout change. Never throws: an unconfigured (or
 * unhappy) bucket only means the route renders on demand instead.
 */
export async function storeGiftCardPdf(code: string, bytes: Uint8Array): Promise<string | null> {
  try {
    const { putObject, storageConfigured } = await import("@/lib/storage");
    if (!storageConfigured()) return null;
    const res = await putObject({
      key: giftPdfKey(code),
      body: Buffer.from(bytes),
      contentType: "application/pdf",
      // the code is unique and its card never changes, so it can be cached hard
      cacheControl: "public, max-age=31536000, immutable",
    });
    return res.url;
  } catch (err) {
    console.error("[giftcard-pdf] store failed", err);
    return null;
  }
}

/** The stored copy, or null when there is no bucket or no object yet. */
export async function fetchStoredGiftCardPdf(code: string): Promise<Uint8Array | null> {
  try {
    const { publicUrl, storageConfigured } = await import("@/lib/storage");
    if (!storageConfigured()) return null;
    const url = publicUrl(giftPdfKey(code));
    if (!url) return null;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}
