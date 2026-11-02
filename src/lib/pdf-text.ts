/**
 * The text of a PDF that came from a LINK, read on the server — the one case
 * the browser cannot cover (Dim, 02.11.2026: Renat's Claude saves a material
 * from a public address, «PDFs and images at a URL included»). A PDF the owner
 * has on his phone is still read in the browser by pdf.js, pictures and all
 * (public/shop2/app.js bnewReadPdf); this is text only.
 *
 * Why not pdf.js here as well: the shop's copy (public/vendor/pdfjs-6.2.108)
 * is the browser build, and in Node 22 it stops at DOMMatrix, Promise.try and
 * Uint8Array.prototype.toHex — one polyfill after another, each on a code
 * path some catalogue might take. pdf-lib is already a dependency (the gift
 * card), parses the file and inflates its streams; what is here is the small
 * part on top: run each page's content stream, decode its strings through the
 * fonts (ToUnicode first, then the simple encodings), and set the pieces into
 * lines by where they stand on the page — the panel's bnewPageInfo does the
 * same with pdf.js's items, and pageHeading() below is its twin.
 *
 * Bounded everywhere: 300 pages, 4 MB of content per page, three million
 * tokens in all, 20 000 characters a page, 300 000 in all. An encrypted file,
 * a scan (no text at all) and a file whose fonts carry no way back to letters
 * are refused with a code, never returned as nonsense.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { constants as zlibConstants, inflateSync } from "node:zlib";
import {
  decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObjectStreamParser, PDFRawStream,
  PDFXRefStreamParser, ParseSpeeds, type PDFObject,
} from "pdf-lib";
import { pageHeading } from "@/lib/pdf-heading";

export { pageHeading };

export class PdfTextError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/* Per document, because a PDF from a link comes from a stranger: `decoded` is
   what it may unpack in all — the object streams pdf-lib opens while loading,
   then content streams and ToUnicode maps — so a small file that inflates to
   gigabytes stops at the cap instead of filling the function's memory; `steps`
   is how many codes all its fonts' W arrays and ToUnicode ranges may expand (one
   entry can name 65 536 or more); `fonts` how many fonts it reads. */
export const PDF_TEXT_LIMITS = {
  pages: 300, pageText: 20_000, total: 300_000, contentBytes: 4 * 1024 * 1024, tokens: 3_000_000,
  decoded: 64 * 1024 * 1024, steps: 500_000, fonts: 400, pageCount: 5000,
} as const;

type Budget = { tokens: number; bytes: number; steps: number };
const newBudget = (): Budget => ({ tokens: PDF_TEXT_LIMITS.tokens, bytes: PDF_TEXT_LIMITS.decoded, steps: PDF_TEXT_LIMITS.steps });

export interface PdfPage {
  n: number;
  heading: string;
  text: string;
}

/* ---------- fonts: from codes to letters ------------------------------------ */

const WIN_ANSI_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];
function winAnsi(code: number): string {
  if (code >= 0x20 && code < 0x7f) return String.fromCharCode(code);
  if (code >= 0x80 && code < 0xa0) return WIN_ANSI_HIGH[code - 0x80] ? String.fromCharCode(WIN_ANSI_HIGH[code - 0x80]) : "";
  if (code >= 0xa0 && code <= 0xff) return String.fromCharCode(code === 0xa0 ? 0x20 : code);
  return code === 9 || code === 10 || code === 13 ? " " : "";
}

const GLYPHS: Record<string, string> = {
  space: " ", nbspace: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&",
  quotesingle: "'", quoteright: "’", quoteleft: "‘", parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",",
  hyphen: "-", minus: "−", period: ".", slash: "/", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">",
  question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_",
  grave: "`", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", quotedblleft: "“", quotedblright: "”",
  quotedblbase: "„", quotesinglbase: "‚", endash: "–", emdash: "—", bullet: "•", ellipsis: "…", guillemotleft: "«",
  guillemotright: "»", degree: "°", copyright: "©", registered: "®", trademark: "™", section: "§", periodcentered: "·",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};
/** A glyph's name as a letter: a–z by itself, uniXXXX, uXXXX, afii100NN (Cyrillic), or one of the common names. */
export function glyphToText(name: string): string {
  if (/^[A-Za-z]$/.test(name)) return name;
  if (GLYPHS[name]) return GLYPHS[name];
  let m = name.match(/^uni([0-9A-Fa-f]{4})/);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = name.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (m) { const cp = parseInt(m[1], 16); return cp <= 0x10ffff ? String.fromCodePoint(cp) : ""; }
  m = name.match(/^afii(100\d\d)$/);
  if (m) {
    const n = Number(m[1]);
    // А–Е, Ё, Ж–Я (10017–10049); а–е, ё, ж–я (10065–10097)
    for (const base of [10017, 10065]) {
      const cap = base === 10017;
      const k = n - base;
      if (k >= 0 && k <= 32) {
        if (k < 6) return String.fromCharCode((cap ? 0x410 : 0x430) + k);
        if (k === 6) return cap ? "Ё" : "ё";
        return String.fromCharCode((cap ? 0x410 : 0x430) + k - 1);
      }
    }
  }
  return "";
}

interface FontInfo {
  bytes: 1 | 2;
  /** ToUnicode, when the font has one. */
  map: Map<number, string> | null;
  /** The simple encoding with its Differences, for a font without ToUnicode. */
  simple: Map<number, string> | null;
  widths: (code: number) => number;
}

const hexBytes = (hex: string) => {
  const h = hex.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  if (h.length % 2) out.push(parseInt(h.slice(-1) + "0", 16));
  return out;
};
const hexInt = (hex: string) => hexBytes(hex).reduce((n, b) => n * 256 + b, 0);
/** A character code a font can use: a whole number of at most four bytes. */
const isCode = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
const utf16 = (hex: string) => {
  const b = hexBytes(hex);
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] * 256 + b[i + 1]);
  return s;
};

/** A ToUnicode CMap: its bfchar and bfrange lines, and how long its codes are.
 *  Every code it maps is charged to the document's `steps` budget. */
export function parseToUnicode(src: string, budget: Budget = newBudget()): { map: Map<number, string>; bytes: 1 | 2 } {
  const map = new Map<number, string>();
  const lens = new Set<number>();
  const tok = /<([0-9A-Fa-f\s]*)>|(\[)|(\])|\b(begincodespacerange|endcodespacerange|beginbfchar|endbfchar|beginbfrange|endbfrange)\b/g;
  let mode = "";
  let buf: Array<string | string[]> = [];
  let arr: string[] | null = null;
  let m: RegExpExecArray | null;
  while ((m = tok.exec(src)) && budget.steps > 0) {
    if (m[4]) {
      mode = m[4].startsWith("begin") ? m[4].slice(5) : "";
      buf = [];
      continue;
    }
    if (m[2]) { arr = []; continue; }
    if (m[3]) { if (arr) buf.push(arr); arr = null; }
    else if (m[1] !== undefined) { if (arr) { arr.push(m[1]); continue; } buf.push(m[1]); }
    if (mode === "codespacerange" && buf.length === 2) {
      lens.add(Math.max(1, Math.ceil(String(buf[0]).replace(/\s+/g, "").length / 2)));
      buf = [];
    } else if (mode === "bfchar" && buf.length === 2) {
      const code = hexInt(String(buf[0]));
      if (isCode(code)) map.set(code, utf16(String(buf[1])));
      budget.steps--;
      buf = [];
    } else if (mode === "bfrange" && buf.length === 3) {
      const lo = hexInt(String(buf[0])), hi = hexInt(String(buf[1]));
      budget.steps--;
      // codes are at most four bytes; an integer offset walks the range, so a
      // huge float code can never stall the loop
      if (isCode(lo) && isCode(hi) && hi >= lo && hi - lo <= 0xffff) {
        const dst = buf[2];
        const span = hi - lo + 1;
        if (Array.isArray(dst)) {
          const n = Math.min(dst.length, span, Math.max(0, budget.steps));
          for (let k = 0; k < n; k++) map.set(lo + k, utf16(dst[k]));
          budget.steps -= Math.min(dst.length, span);
        } else {
          const base = utf16(dst);
          const n = Math.min(span, Math.max(0, budget.steps));
          budget.steps -= span;
          for (let k = 0; k < n; k++) {
            const last = base.charCodeAt(base.length - 1) + k;
            map.set(lo + k, base.slice(0, -1) + String.fromCharCode(last & 0xffff));
          }
        }
      }
      buf = [];
    }
  }
  // one-byte codes only when every range the CMap declares is one byte long
  return { map, bytes: lens.has(1) && !lens.has(2) ? 1 : 2 };
}

const N = (n: string) => PDFName.of(n);
const num = (o: PDFObject | undefined, d = 0) => (o instanceof PDFNumber ? o.asNumber() : d);
const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText().replace(/^\//, "") : "");

/** Flate inflated by zlib with a hard output cap: past `cap` it throws instead of
 *  growing (pdf-lib's own decoder has no cap). Truncated streams still read. */
function inflateCapped(data: Uint8Array, cap: number): Buffer {
  return inflateSync(data, { maxOutputLength: Math.max(1, cap), finishFlush: zlibConstants.Z_SYNC_FLUSH });
}

/**
 * A stream's text, unpacked within the document's byte budget. Read here: no
 * filter, Flate (capped, see inflateCapped), and the two ASCII filters, which
 * only shrink their input. LZW, RunLength and filter chains can blow up and text
 * streams rarely use them — skipped, like a picture's DCT.
 */
function streamText(s: PDFObject | undefined, budget: Budget, max: number = PDF_TEXT_LIMITS.contentBytes): string {
  if (!(s instanceof PDFRawStream)) return "";
  const cap = Math.min(max, budget.bytes);
  if (cap <= 0) return "";
  const filters = filtersOf(s.dict);
  try {
    let out: Uint8Array;
    if (!filters.length) out = s.contents;
    else if (filters.length === 1 && filters[0] === "FlateDecode") {
      const parms = s.dict.lookup(N("DecodeParms"));
      if (parms instanceof PDFDict && num(parms.lookup(N("Predictor")), 1) > 1) return "";
      out = inflateCapped(s.contents, cap);
    } else if (filters.every((x) => x === "ASCIIHexDecode" || x === "ASCII85Decode")) out = decodePDFRawStream(s).decode();
    else return "";
    const n = Math.min(out.length, cap);
    budget.bytes -= n;
    return Buffer.from(out.subarray(0, n)).toString("latin1");
  } catch {
    return "";   // over the cap, broken, or a filter not read here: nothing to read there
  }
}

/*
 * pdf-lib unpacks every object stream and cross-reference stream while it loads,
 * through PDFObjectStreamParser.forStream / PDFXRefStreamParser.forStream, with
 * no output limit. Both are wrapped once: inside pdfPages (an AsyncLocalStorage
 * run, so two reads at once keep their own budgets) each such stream is checked
 * first — pdf-lib's own parse of its dictionary, so nothing a regex could miss —
 * and must be one FlateDecode stream that zlib unpacks within the document's
 * byte budget; any other filter, or a stream zlib will not read, refuses the
 * file. Outside pdfPages the wrappers do nothing.
 */
type LoadGuard = { budget: Budget; refused: boolean };
const loading = new AsyncLocalStorage<LoadGuard>();
let parsersGuarded = false;

function filtersOf(dict: PDFDict): string[] {
  const f = dict.lookup(N("Filter"));
  return f instanceof PDFName ? [nameOf(f)] : f instanceof PDFArray ? f.asArray().map((x) => nameOf(dict.context.lookup(x))) : [];
}

function checkLoadStream(s: PDFRawStream, g: LoadGuard): void {
  const filters = filtersOf(s.dict);
  let size = s.contents.length;
  if (filters.length === 1 && filters[0] === "FlateDecode") {
    try {
      size = inflateCapped(s.contents, g.budget.bytes).length;
    } catch {
      size = Infinity;   // over the budget, or not Flate after all
    }
  } else if (filters.length) size = Infinity;   // LZW, RunLength, ASCII85, chains: no cap there
  g.budget.bytes -= size;
  if (g.budget.bytes < 0) {
    g.refused = true;
    throw new PdfTextError("broken");
  }
}

function guardParsers(): void {
  if (parsersGuarded) return;
  parsersGuarded = true;
  for (const P of [PDFObjectStreamParser, PDFXRefStreamParser] as unknown as Array<{ forStream: (s: PDFRawStream, ...rest: unknown[]) => unknown }>) {
    const orig = P.forStream;
    P.forStream = function (this: unknown, s: PDFRawStream, ...rest: unknown[]) {
      const g = loading.getStore();
      if (g) checkLoadStream(s, g);
      return orig.call(this, s, ...rest);
    };
  }
}

function fontInfo(font: PDFDict, budget: Budget): FontInfo {
  const sub = nameOf(font.lookup(N("Subtype")));
  const tu = font.lookup(N("ToUnicode"));
  const cmap = tu instanceof PDFRawStream ? parseToUnicode(streamText(tu, budget), budget) : null;
  if (sub === "Type0") {
    const desc = font.lookupMaybe(N("DescendantFonts"), PDFArray)?.lookup(0);
    const d = desc instanceof PDFDict ? desc : null;
    const dw = num(d?.lookup(N("DW")), 1000);
    const w = new Map<number, number>();
    const W = d?.lookupMaybe(N("W"), PDFArray);
    if (W) {
      // every code an entry names is charged to the document's step budget, so
      // repeating a wide range cannot loop past it even when it adds nothing new;
      // an integer offset walks each range, so a huge float code cannot stall it
      for (let i = 0; i < W.size() && budget.steps > 0;) {
        const first = num(W.lookup(i));
        const next = W.lookup(i + 1);
        budget.steps--;
        if (!isCode(first)) break;   // not a character code: stop reading widths
        if (next instanceof PDFArray) {
          const n = Math.min(next.size(), Math.max(0, budget.steps));
          for (let k = 0; k < n; k++) w.set(first + k, num(next.lookup(k)));
          budget.steps -= next.size();
          i += 2;
        } else {
          const last = num(next), width = num(W.lookup(i + 2));
          i += 3;
          if (!isCode(last) || last < first) continue;
          const span = last - first + 1;
          const n = Math.min(span, Math.max(0, budget.steps));
          for (let k = 0; k < n; k++) w.set(first + k, width);
          budget.steps -= span;
        }
      }
    }
    return { bytes: cmap ? cmap.bytes : 2, map: cmap?.map ?? null, simple: null, widths: (c) => w.get(c) ?? dw };
  }
  // a simple font: one byte a code
  const first = num(font.lookup(N("FirstChar")), 0);
  const Ws = font.lookupMaybe(N("Widths"), PDFArray);
  const fd = font.lookup(N("FontDescriptor"));
  const missing = fd instanceof PDFDict ? num(fd.lookup(N("MissingWidth")), 0) : 0;
  const widths = (c: number) => {
    const i = c - first;
    const v = Ws && i >= 0 && i < Ws.size() ? num(Ws.lookup(i)) : 0;
    return v || missing || 500;
  };
  let simple: Map<number, string> | null = null;
  if (!cmap) {
    simple = new Map();
    for (let c = 0; c < 256; c++) { const t = winAnsi(c); if (t) simple.set(c, t); }
    const enc = font.lookup(N("Encoding"));
    if (enc instanceof PDFDict) {
      const diffs = enc.lookupMaybe(N("Differences"), PDFArray);
      let code = 0;
      for (let i = 0; diffs && i < diffs.size(); i++) {
        const v = diffs.lookup(i);
        if (v instanceof PDFNumber) code = v.asNumber();
        else if (v instanceof PDFName) { simple.set(code, glyphToText(nameOf(v))); code++; }
      }
    }
  }
  return { bytes: 1, map: cmap?.map ?? null, simple, widths };
}

/* ---------- the content stream ----------------------------------------------- */

type M6 = [number, number, number, number, number, number];
const ID: M6 = [1, 0, 0, 1, 0, 0];
const mul = (a: M6, b: M6): M6 => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

interface Piece { str: string; x: number; y: number; ex: number; size: number; at: number }
type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "name"; v: string } | { t: "op"; v: string } | { t: "arr"; v: Tok[] };

const WS = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%\0\t\n\f\r ]/;
const ESC: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };

class Lexer {
  pos = 0;
  constructor(readonly s: string, readonly budget: { tokens: number }) {}
  next(): Tok | null {
    const s = this.s;
    for (;;) {
      while (this.pos < s.length && WS.test(s[this.pos])) this.pos++;
      if (this.pos >= s.length || --this.budget.tokens < 0) return null;
      const c = s[this.pos];
      if (c === "%") { while (this.pos < s.length && s[this.pos] !== "\n" && s[this.pos] !== "\r") this.pos++; continue; }
      if (c === "(") return { t: "str", v: this.literal() };
      if (c === "<" && s[this.pos + 1] === "<") { this.pos += 2; return { t: "op", v: "<<" }; }
      if (c === ">" && s[this.pos + 1] === ">") { this.pos += 2; return { t: "op", v: ">>" }; }
      if (c === "<") {
        const end = s.indexOf(">", this.pos);
        const hex = s.slice(this.pos + 1, end < 0 ? s.length : end);
        this.pos = end < 0 ? s.length : end + 1;
        return { t: "str", v: String.fromCharCode(...hexBytes(hex.replace(/[^0-9A-Fa-f]/g, ""))) };
      }
      if (c === "[") {
        this.pos++;
        const v: Tok[] = [];
        for (;;) {
          while (this.pos < s.length && WS.test(s[this.pos])) this.pos++;
          if (this.pos >= s.length) break;
          if (s[this.pos] === "]") { this.pos++; break; }
          const t = this.next();
          if (!t) break;
          v.push(t);
        }
        return { t: "arr", v };
      }
      if (c === "]" || c === ")" || c === "{" || c === "}" || c === ">") { this.pos++; continue; }
      if (c === "/") {
        let e = this.pos + 1;
        while (e < s.length && !DELIM.test(s[e])) e++;
        const v = s.slice(this.pos + 1, e).replace(/#([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
        this.pos = e;
        return { t: "name", v };
      }
      let e = this.pos;
      while (e < s.length && !DELIM.test(s[e])) e++;
      if (e === this.pos) { this.pos++; continue; }
      const word = s.slice(this.pos, e);
      this.pos = e;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: Number(word) };
      return { t: "op", v: word };
    }
  }
  private literal(): string {
    const s = this.s;
    let depth = 0, out = "";
    for (this.pos++; this.pos < s.length; this.pos++) {
      const c = s[this.pos];
      if (c === "\\") {
        const n = s[++this.pos];
        if (n === undefined) break;
        if (ESC[n] !== undefined) out += ESC[n];
        else if (/[0-7]/.test(n)) {
          let o = n;
          while (o.length < 3 && /[0-7]/.test(s[this.pos + 1] || "")) o += s[++this.pos];
          out += String.fromCharCode(parseInt(o, 8) & 0xff);
        } else if (n === "\r") { if (s[this.pos + 1] === "\n") this.pos++; }
        else if (n !== "\n") out += n;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") { if (depth === 0) { this.pos++; return out; } depth--; }
      out += c;
    }
    return out;
  }
  /** An inline image: everything after «ID» up to the «EI» that ends it. */
  skipInlineImage(): void {
    const id = this.s.indexOf("ID", this.pos);
    if (id < 0) { this.pos = this.s.length; return; }
    const re = /[\0\t\n\f\r ]EI(?=[\0\t\n\f\r ]|$)/g;
    re.lastIndex = id + 3;
    const m = re.exec(this.s);
    this.pos = m ? m.index + 3 : this.s.length;
  }
}

interface RunState { budget: Budget; pieces: Piece[]; unknown: number; known: number; fonts: Map<PDFDict, FontInfo>; seen: Set<PDFObject> }

function runContent(src: string, resources: PDFDict | undefined, ctm0: M6, st: RunState, depth: number): void {
  const lex = new Lexer(src, st.budget);
  const fontsDict = resources?.lookupMaybe(N("Font"), PDFDict);
  const xobjects = resources?.lookupMaybe(N("XObject"), PDFDict);
  let ctm = ctm0;
  const stack: M6[] = [];
  let tm: M6 = ID, tlm: M6 = ID;
  let font: FontInfo | null = null, size = 12, leading = 0, tc = 0, tw = 0, th = 1;
  let ops: Tok[] = [];
  const nums = () => ops.filter((o): o is { t: "num"; v: number } => o.t === "num").map((o) => o.v);
  const moveLine = (tx: number, ty: number) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };

  const show = (raw: string) => {
    if (!font) return;
    const f = font;
    const start = mul(tm, ctm);
    let text = "";
    for (let i = 0; i < raw.length;) {
      const code = f.bytes === 2 ? (raw.charCodeAt(i) << 8) | (raw.charCodeAt(i + 1) || 0) : raw.charCodeAt(i);
      i += f.bytes;
      const ch = f.map ? f.map.get(code) : f.simple ? f.simple.get(code) : undefined;
      if (ch === undefined || ch === "") st.unknown++;
      else { text += ch; st.known++; }
      const adv = ((f.widths(code) / 1000) * size + tc + (f.bytes === 1 && code === 32 ? tw : 0)) * th;
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    }
    const end = mul(tm, ctm);
    if (text) st.pieces.push({ str: text, x: start[4], y: start[5], ex: end[4], size: Math.abs(size * (start[3] || 1)), at: st.pieces.length });
  };

  for (let t = lex.next(); t; t = lex.next()) {
    if (t.t !== "op") { ops.push(t); continue; }
    const op = t.v;
    const n = nums();
    switch (op) {
      case "q": stack.push(ctm); if (stack.length > 64) stack.shift(); break;
      case "Q": ctm = stack.pop() ?? ctm0; break;
      case "cm": if (n.length >= 6) ctm = mul(n.slice(-6) as M6, ctm); break;
      case "BT": tm = ID; tlm = ID; break;
      case "Tf": {
        const fname = ops.find((o) => o.t === "name");
        size = n.length ? n[n.length - 1] : size;
        const fd = fname && fontsDict ? fontsDict.lookup(N((fname as { v: string }).v)) : undefined;
        if (fd instanceof PDFDict && (st.fonts.has(fd) || st.fonts.size < PDF_TEXT_LIMITS.fonts)) {
          if (!st.fonts.has(fd)) st.fonts.set(fd, fontInfo(fd, st.budget));
          font = st.fonts.get(fd)!;
        } else font = null;
        break;
      }
      case "Td": if (n.length >= 2) moveLine(n[n.length - 2], n[n.length - 1]); break;
      case "TD": if (n.length >= 2) { leading = -n[n.length - 1]; moveLine(n[n.length - 2], n[n.length - 1]); } break;
      case "Tm": if (n.length >= 6) { tlm = n.slice(-6) as M6; tm = tlm; } break;
      case "T*": moveLine(0, -leading); break;
      case "TL": if (n.length) leading = n[n.length - 1]; break;
      case "Tc": if (n.length) tc = n[n.length - 1]; break;
      case "Tw": if (n.length) tw = n[n.length - 1]; break;
      case "Tz": if (n.length) th = n[n.length - 1] / 100; break;
      case "Tj": { const s = ops.find((o) => o.t === "str"); if (s) show((s as { v: string }).v); break; }
      case "'": case '"': {
        moveLine(0, -leading);
        if (op === '"' && n.length >= 2) { tw = n[0]; tc = n[1]; }
        const s = ops.find((o) => o.t === "str");
        if (s) show((s as { v: string }).v);
        break;
      }
      case "TJ": {
        const arr = ops.find((o) => o.t === "arr") as { v: Tok[] } | undefined;
        for (const it of arr?.v ?? []) {
          if (it.t === "str") show(it.v);
          else if (it.t === "num") {
            // a wide gap inside one run is a space between words
            if (it.v < -200 && font) {
              const last = st.pieces[st.pieces.length - 1];
              if (last && !last.str.endsWith(" ")) last.str += " ";
            }
            tm = mul([1, 0, 0, 1, (-it.v / 1000) * size * th, 0], tm);
          }
        }
        break;
      }
      case "Do": {
        const xname = ops.find((o) => o.t === "name") as { v: string } | undefined;
        if (!xname || !xobjects || depth >= 4) break;
        const xo = xobjects.lookup(N(xname.v));
        if (!(xo instanceof PDFRawStream) || nameOf(xo.dict.lookup(N("Subtype"))) !== "Form" || st.seen.has(xo)) break;
        st.seen.add(xo);
        const mx = xo.dict.lookupMaybe(N("Matrix"), PDFArray);
        const m6 = mx && mx.size() === 6 ? ([0, 1, 2, 3, 4, 5].map((i) => num(mx.lookup(i))) as M6) : ID;
        const res = xo.dict.lookupMaybe(N("Resources"), PDFDict) ?? resources;
        runContent(streamText(xo, st.budget), res, mul(m6, ctm), st, depth + 1);
        break;
      }
      case "BI": lex.skipInlineImage(); break;
      default: break;
    }
    ops = [];
  }
}

/** The pieces of one page set into lines, top first: one line per height (3 pt steps, as the panel does), left to right. */
function linesOf(pieces: Piece[]): string[] {
  const rows = new Map<number, Piece[]>();
  for (const p of pieces) {
    const y = Math.round(p.y / 3) * 3;
    (rows.get(y) ?? rows.set(y, []).get(y)!).push(p);
  }
  return [...rows.keys()].sort((a, b) => b - a).map((y) => {
    const row = rows.get(y)!.sort((a, b) => a.x - b.x || a.at - b.at);
    let line = "";
    let lastEnd = -Infinity;
    for (const p of row) {
      const gap = p.x - lastEnd;
      if (line && !line.endsWith(" ") && !p.str.startsWith(" ") && gap > Math.max(1, p.size * 0.15)) line += " ";
      line += p.str;
      lastEnd = Math.max(lastEnd, p.ex);
    }
    return line.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  }).filter(Boolean);
}

/** A page: its content stream(s) and the Resources it has or inherits from its nearest parent. */
type Leaf = { contents: PDFObject | undefined; resources: PDFDict | undefined };

/**
 * The page tree walked here, not by pdf-lib's getPages(), which follows every
 * Kids entry with no record of where it has been — a tree whose levels each list
 * the next level twice doubles the work per level (a 2.5 KB file took 46 s, the
 * security review of 02.11.2026). Each node is visited once, every Kids entry
 * costs a step, and the walk stops at `countMax` pages.
 */
function pageLeaves(doc: PDFDocument, countMax: number): Leaf[] {
  const out: Leaf[] = [];
  const seen = new Set<PDFDict>();
  const stack: Array<{ node: PDFObject | undefined; res: PDFDict | undefined }> = [{ node: doc.catalog.lookup(N("Pages")), res: undefined }];
  let steps = 0;
  while (stack.length && out.length < countMax && steps < PDF_TEXT_LIMITS.steps) {
    const { node, res } = stack.pop()!;
    steps++;
    if (!(node instanceof PDFDict) || seen.has(node)) continue;
    seen.add(node);
    const own = node.lookup(N("Resources"));
    const r = own instanceof PDFDict ? own : res;
    const kids = node.lookup(N("Kids"));
    if (nameOf(node.lookup(N("Type"))) !== "Page" && kids instanceof PDFArray) {
      for (let i = kids.size() - 1; i >= 0 && steps < PDF_TEXT_LIMITS.steps; i--, steps++) stack.push({ node: kids.lookup(i), res: r });
    } else out.push({ contents: node.lookup(N("Contents")), resources: r });
  }
  return out;
}

function contentsOf(c: PDFObject | undefined, budget: Budget): string {
  if (c instanceof PDFArray) {
    const parts: string[] = [];
    let total = 0;
    for (let i = 0; i < c.size() && total < PDF_TEXT_LIMITS.contentBytes && budget.bytes > 0; i++) {
      const t = streamText(c.lookup(i), budget, PDF_TEXT_LIMITS.contentBytes - total);
      parts.push(t);
      total += t.length;
    }
    return parts.join("\n");
  }
  return streamText(c, budget);
}

/**
 * Every page's text and heading, page by page — what a PDF material keeps
 * (src/lib/blog-materials.ts). Refuses with a PdfTextError: `not_pdf`,
 * `encrypted`, `broken`, `no_text` (a scan, or pictures of words), `unreadable`
 * (fonts with no way back to letters).
 */
export async function pdfPages(bytes: Uint8Array): Promise<{ pages: PdfPage[]; pageCount: number }> {
  if (!Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-")) throw new PdfTextError("not_pdf");
  const budget = newBudget();
  guardParsers();
  const guard: LoadGuard = { budget, refused: false };
  let doc: PDFDocument;
  try {
    doc = await loading.run(guard, () =>
      PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, parseSpeed: ParseSpeeds.Fastest }));
  } catch {
    throw new PdfTextError("broken");
  }
  // pdf-lib swallows an object that will not parse; a refused stream still refuses the file
  if (guard.refused) throw new PdfTextError("broken");
  if (doc.isEncrypted) throw new PdfTextError("encrypted");
  let list: Leaf[];
  try {
    list = pageLeaves(doc, PDF_TEXT_LIMITS.pageCount);
  } catch {
    throw new PdfTextError("broken");
  }
  const st: RunState = { budget, pieces: [], unknown: 0, known: 0, fonts: new Map(), seen: new Set() };
  const pages: PdfPage[] = [];
  let total = 0;
  for (let i = 0; i < Math.min(list.length, PDF_TEXT_LIMITS.pages) && total < PDF_TEXT_LIMITS.total && st.budget.tokens > 0; i++) {
    st.pieces = [];
    st.seen = new Set();
    try {
      runContent(contentsOf(list[i].contents, budget), list[i].resources, ID, st, 0);
    } catch {
      continue;   // one page that will not read is one page without text
    }
    const lines = linesOf(st.pieces);
    const text = lines.join("\n").slice(0, Math.min(PDF_TEXT_LIMITS.pageText, PDF_TEXT_LIMITS.total - total));
    if (!text) continue;
    total += text.length;
    pages.push({ n: i + 1, heading: pageHeading(lines), text });
  }
  const letters = pages.reduce((n, p) => n + (p.text.match(/\p{L}/gu) || []).length, 0);
  if (st.known + st.unknown > 0 && st.unknown > (st.known + st.unknown) * 0.3) throw new PdfTextError("unreadable");
  if (letters < 40) throw new PdfTextError("no_text");
  return { pages, pageCount: list.length };
}

/** For tests: the lexer and the line setter on their own. */
export const _test = { Lexer, linesOf, streamText, fontInfo, newBudget };
