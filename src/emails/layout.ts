/**
 * Shared chrome for every transactional letter.
 *
 * The design source of truth is `public/shop/emails/*.html` — those files stay
 * in the repo as the human-readable reference (and the /shop/emails/ preview
 * page). This module reproduces the same table skeleton, the same palette and
 * the same Oswald/Golos + Arial stack, with the copy lifted out into
 * per-language dictionaries.
 *
 * Rules the templates follow, in order of how often they bite:
 *  - inline CSS only; the <style> block carries nothing but the dark-mode
 *    overrides and the mobile padding, both of which cannot be inlined;
 *  - tables for layout, no flex/grid, no external CSS, no web-font dependency
 *    (Arial/Helvetica is the fallback and the letter must look right in it);
 *  - EVERY element that sets a colour also sets a background colour, so a
 *    client that force-inverts the letter can never land dark-on-dark;
 *  - absolute URLs built from PUBLIC_BASE_URL — a relative src is a broken
 *    image in every mail client there is.
 */

import type { Lang } from "./types";

/* ---------- palette ---------------------------------------------------- */

export const C = {
  page: "#edeae1",
  card: "#ffffff",
  line: "#e5e1d6",
  ink: "#1c1a00",
  muted: "#6f6b57",
  panel: "#edeae1",
  btnBg: "#1c1a00",
  btnInk: "#ffffff",
} as const;

/* Dark counterparts. Warm, not blue-black — the brand ink is olive. */
const D = {
  page: "#141308",
  card: "#1e1c12",
  line: "#3a3728",
  ink: "#f4f1e6",
  muted: "#b6b09a",
  panel: "#2a2719",
  btnBg: "#f4f1e6",
  btnInk: "#1c1a00",
} as const;

export const FONT_HEAD =
  "'Oswald','Golos Text',Arial,Helvetica,sans-serif";
export const FONT_BODY = "'Golos Text',Arial,Helvetica,sans-serif";

export const BRAND = {
  name: "Rempire",
  /** Mandatory footer legal line. */
  legal: "Rempire Store OÜ, Tallinn",
  address: "Mardi 1, 10145",
  site: "rempireshop.com",
} as const;

/* ---------- primitives ------------------------------------------------- */

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First non-empty string, or the fallback. Keeps "undefined" out of letters. */
export function pick(
  ...vals: Array<string | number | null | undefined>
): string {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s && s !== "undefined" && s !== "null") return s;
  }
  return "";
}

/** Turn a rendered HTML fragment back into the plain-text alternative. */
export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Same formatting as the storefront's `eur()` in public/shop2/app.js:
 * comma decimal, ",00" dropped, thin gap before the sign. `html` swaps that
 * gap for &nbsp; so a price never wraps across two lines.
 */
export function money(v: unknown, html = false): string {
  const n = Math.round(num(v) * 100) / 100;
  const body = n.toFixed(2).replace(".", ",").replace(",00", "");
  return body + (html ? "&nbsp;€" : " €");
}

export function baseUrl(): string {
  const raw = pick(process.env.PUBLIC_BASE_URL, "https://rempireshop.com");
  return raw.replace(/\/+$/, "");
}

/** Absolute URL for an in-shop path. */
export function assetUrl(path: string): string {
  return baseUrl() + (path.startsWith("/") ? path : "/" + path);
}

/** Absolute URL from whatever the caller had — full URL, path, or nothing. */
export function absUrl(
  url: string | null | undefined,
  fallback = "/shop2/",
): string {
  const v = pick(url);
  if (/^https?:\/\//i.test(v)) return v;
  if (/^mailto:/i.test(v)) return v;
  return assetUrl(v || fallback);
}

/* ---------- language --------------------------------------------------- */

const LANGS: Lang[] = ["ru", "et", "en"];

export function normalizeLang(v: unknown): Lang {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "ru";
  if (s.startsWith("ru")) return "ru";
  if (s.startsWith("et") || s.startsWith("ee") || s.startsWith("es"))
    return "et";
  if (s.startsWith("en")) return "en";
  return "ru";
}

export function isLang(v: unknown): v is Lang {
  return LANGS.includes(String(v) as Lang);
}

export const ALL_LANGS: readonly Lang[] = LANGS;

/** HTML `lang` attribute value. */
function htmlLang(lang: Lang): string {
  return lang === "ru" ? "ru" : lang === "et" ? "et" : "en";
}

/* ---------- shared copy ------------------------------------------------ */

interface CommonStrings {
  hello: string;
  helloNamed: (name: string) => string;
  total: string;
  shipping: string;
  free: string;
  serviceNote: string;
  unsubscribe: string;
  unsubscribeAsk: string;
  viewInBrowserless: string;
  /** Unit word after the count: [one, many]. English needs both. */
  qty: [string, string];
}

export const COMMON: Record<Lang, CommonStrings> = {
  ru: {
    hello: "Здравствуйте!",
    helloNamed: (n) => `Здравствуйте, ${n}!`,
    total: "Итого",
    shipping: "Доставка",
    free: "бесплатно",
    serviceNote: "Это служебное письмо о вашем заказе.",
    unsubscribe: "Отписаться",
    unsubscribeAsk: "Не хотите получать такие письма?",
    viewInBrowserless: "",
    qty: ["шт", "шт"],
  },
  et: {
    hello: "Tere!",
    helloNamed: (n) => `Tere, ${n}!`,
    total: "Kokku",
    shipping: "Tarne",
    free: "tasuta",
    serviceNote: "See on teenuskiri teie tellimuse kohta.",
    unsubscribe: "Loobu",
    unsubscribeAsk: "Ei soovi selliseid kirju saada?",
    viewInBrowserless: "",
    qty: ["tk", "tk"],
  },
  en: {
    hello: "Hello!",
    helloNamed: (n) => `Hello, ${n}!`,
    total: "Total",
    shipping: "Shipping",
    free: "free",
    serviceNote: "This is a service e-mail about your order.",
    unsubscribeAsk: "Rather not get these e-mails?",
    unsubscribe: "Unsubscribe",
    viewInBrowserless: "",
    qty: ["pc", "pcs"],
  },
};

/* ---------- building blocks -------------------------------------------- */

/**
 * Dark-mode block. Two mechanisms, because clients disagree:
 *  - prefers-color-scheme (Apple Mail, iOS, Outlook for Mac) reads the media
 *    query and we hand it a real dark palette;
 *  - Outlook.com / Gmail app repaint the DOM themselves and expose the
 *    [data-ogsc]/[data-ogsb] hooks, which get the same values.
 * Everything is !important because the inline style always wins otherwise.
 */
function darkCss(): string {
  const rules = [
    [".em-bg", `background-color:${D.page} !important;`],
    [
      ".em-card",
      `background-color:${D.card} !important; border-color:${D.line} !important;`,
    ],
    [
      ".em-ink",
      `color:${D.ink} !important; background-color:${D.card} !important;`,
    ],
    [
      ".em-muted",
      `color:${D.muted} !important; background-color:${D.card} !important;`,
    ],
    [
      ".em-panel",
      `background-color:${D.panel} !important; border-color:${D.line} !important;`,
    ],
    [
      ".em-panel-ink",
      `color:${D.ink} !important; background-color:${D.panel} !important;`,
    ],
    [
      ".em-panel-muted",
      `color:${D.muted} !important; background-color:${D.panel} !important;`,
    ],
    [
      ".em-btn",
      `background-color:${D.btnBg} !important; border-color:${D.btnBg} !important;`,
    ],
    [".em-btn-a", `color:${D.btnInk} !important;`],
    [".em-hr", `border-color:${D.line} !important;`],
    [".em-link", `color:${D.muted} !important;`],
  ];
  const body = rules.map(([sel, css]) => `${sel}{${css}}`).join("\n    ");
  const ogsc = rules
    .map(([sel, css]) => `[data-ogsc] ${sel}{${css}}`)
    .join("\n  ");
  return (
    `  @media (prefers-color-scheme: dark){\n    ${body}\n  }\n` + `  ${ogsc}\n`
  );
}

export interface ShellInput {
  lang: Lang;
  title: string;
  preheader: string;
  /** Table rows of the white card, already rendered. */
  body: string;
  /** Extra footer paragraph (unsubscribe line or the service note). */
  footerNote: string;
}

export function shell(input: ShellInput): string {
  const { lang, title, preheader, body, footerNote } = input;
  const logo = assetUrl("/brand/tower-email.png");
  const site = baseUrl();

  return `<!DOCTYPE html>
<html lang="${htmlLang(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Golos+Text:wght@400;600&display=swap');
  :root{color-scheme:light dark;supported-color-schemes:light dark;}
  @media only screen and (max-width:620px){
    .em-container{width:100% !important;}
    .em-px{padding-left:24px !important;padding-right:24px !important;}
  }
${darkCss()}</style>
</head>
<body class="em-bg" style="margin:0; padding:0; background-color:${C.page};">

<div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">
  ${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-bg" style="border-collapse:collapse; background-color:${C.page};">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="em-container em-card" style="width:600px; max-width:600px; border-collapse:collapse; background-color:${C.card}; border:1px solid ${C.line};">

        <tr>
          <td align="center" class="em-card em-hr" style="padding:30px 40px; border-bottom:1px solid ${C.line}; background-color:${C.card};">
            <img src="${esc(logo)}" width="31" height="48" alt="" style="display:block; margin:0 auto 10px auto; border:0; outline:none;">
            <a href="${esc(site)}/" class="em-ink" style="font-family:${FONT_HEAD}; font-size:20px; font-weight:bold; letter-spacing:8px; text-transform:uppercase; color:${C.ink}; text-decoration:none;">REMPIRE</a>
          </td>
        </tr>
${body}
        <tr>
          <td class="em-px em-card em-hr" style="padding:24px 48px 32px 48px; border-top:1px solid ${C.line}; background-color:${C.card};">
            <p class="em-muted" style="margin:0; font-family:${FONT_BODY}; font-size:12px; line-height:19px; color:${C.muted};">
              ${esc(BRAND.legal)} · ${esc(BRAND.address)} ·
              <a href="${esc(site)}/" class="em-link" style="color:${C.muted}; text-decoration:underline;">${esc(BRAND.site)}</a>
            </p>
            <p class="em-muted" style="margin:8px 0 0 0; font-family:${FONT_BODY}; font-size:12px; line-height:19px; color:${C.muted};">${footerNote}</p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}

/** Big uppercase headline row. */
export function rowTitle(text: string, center = false): string {
  return `        <tr>
          <td class="em-px em-card"${center ? ' align="center"' : ""} style="padding:40px 48px 8px 48px; background-color:${C.card};">
            <h1 class="em-ink" style="margin:0; font-family:${FONT_HEAD}; font-size:22px; line-height:30px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:${C.ink};">${esc(text)}</h1>
          </td>
        </tr>
`;
}

/** Body paragraph. `html` is trusted — callers pass escaped fragments. */
export function rowLead(html: string, center = false): string {
  return `        <tr>
          <td class="em-px em-card"${center ? ' align="center"' : ""} style="padding:12px 48px 28px 48px; background-color:${C.card};">
            <p class="em-ink" style="margin:0; font-family:${FONT_BODY}; font-size:15px; line-height:23px; color:${C.ink};">${html}</p>
          </td>
        </tr>
`;
}

/** Small uppercase label above a block. */
export function rowLabel(text: string): string {
  return `        <tr>
          <td class="em-px em-card" style="padding:0 48px 0 48px; background-color:${C.card};">
            <p class="em-muted" style="margin:0; font-family:${FONT_HEAD}; font-size:12px; line-height:18px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">${esc(text)}</p>
          </td>
        </tr>
`;
}

/** Grey note paragraphs at the bottom of the card. */
export function rowNote(lines: string[], center = false): string {
  const ps = lines
    .filter(Boolean)
    .map(
      (l, i) =>
        `            <p class="em-muted" style="margin:${i ? "10px 0 0 0" : "0"}; font-family:${FONT_BODY}; font-size:13px; line-height:20px; color:${C.muted};">${l}</p>`,
    )
    .join("\n");
  return `        <tr>
          <td class="em-px em-card"${center ? ' align="center"' : ""} style="padding:20px 48px 40px 48px; background-color:${C.card};">
${ps}
          </td>
        </tr>
`;
}

/** Beige panel: a label, a strong line, an optional grey line. */
export function rowPanel(
  label: string,
  strong: string,
  note = "",
  center = false,
  boxed = false,
): string {
  const align = center ? ' align="center"' : "";
  const border = boxed ? `border:2px solid ${C.ink}; ` : "";
  const bg = boxed ? C.card : C.panel;
  const panelCls = boxed ? "em-card" : "em-panel";
  const inkCls = boxed ? "em-ink" : "em-panel-ink";
  const mutedCls = boxed ? "em-muted" : "em-panel-muted";
  return `        <tr>
          <td class="em-px em-card" style="padding:0 48px 8px 48px; background-color:${C.card};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td${align} class="${panelCls}" bgcolor="${bg}" style="${border}background-color:${bg}; padding:22px 24px;">
                  <p class="${mutedCls}" style="margin:0 0 8px 0; font-family:${FONT_HEAD}; font-size:12px; line-height:18px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">${esc(label)}</p>
                  <p class="${inkCls}" style="margin:0; font-family:${FONT_BODY}; font-size:16px; line-height:24px; font-weight:bold; color:${C.ink};">${strong}</p>
${
  note
    ? `                  <p class="${mutedCls}" style="margin:8px 0 0 0; font-family:${FONT_BODY}; font-size:13px; line-height:20px; color:${C.muted};">${note}</p>\n`
    : ""
}                </td>
              </tr>
            </table>
          </td>
        </tr>
`;
}

/** Monospaced-looking code panel (tracking number, promo code). */
export function rowCode(
  label: string,
  code: string,
  note = "",
  boxed = false,
): string {
  const bg = boxed ? C.card : C.panel;
  const border = boxed ? `border:2px solid ${C.ink}; ` : "";
  const panelCls = boxed ? "em-card" : "em-panel";
  const inkCls = boxed ? "em-ink" : "em-panel-ink";
  const mutedCls = boxed ? "em-muted" : "em-panel-muted";
  return `        <tr>
          <td class="em-px em-card" style="padding:0 48px 8px 48px; background-color:${C.card};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td align="center" class="${panelCls}" bgcolor="${bg}" style="${border}background-color:${bg}; padding:24px;">
                  <p class="${mutedCls}" style="margin:0 0 8px 0; font-family:${FONT_HEAD}; font-size:12px; line-height:18px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">${esc(label)}</p>
                  <p class="${inkCls}" style="margin:0; font-family:${FONT_HEAD}; font-size:22px; line-height:30px; font-weight:bold; letter-spacing:4px; color:${C.ink};">${esc(code)}</p>
${
  note
    ? `                  <p class="${mutedCls}" style="margin:10px 0 0 0; font-family:${FONT_BODY}; font-size:13px; line-height:20px; color:${C.muted};">${esc(note)}</p>\n`
    : ""
}                </td>
              </tr>
            </table>
          </td>
        </tr>
`;
}

/** Bulletproof button. */
export function rowButton(url: string, label: string): string {
  return `        <tr>
          <td class="em-px em-card" align="center" style="padding:24px 48px 8px 48px; background-color:${C.card};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td align="center" class="em-btn" bgcolor="${C.btnBg}" style="background-color:${C.btnBg}; border:1px solid ${C.btnBg}; padding:15px 38px;">
                  <a href="${esc(url)}" class="em-btn-a" style="font-family:${FONT_HEAD}; font-size:13px; line-height:16px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.btnInk}; text-decoration:none; display:inline-block;">${esc(label)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
`;
}

export interface LineRow {
  label: string;
  value: string;
  muted?: boolean;
  /** Draw the heavy rule above and set the row in bold — the totals line. */
  total?: boolean;
  /** Suppress the hairline under the row. */
  last?: boolean;
}

/** The items table: product rows, shipping row, totals row. */
export function rowLines(lines: LineRow[]): string {
  const body = lines
    .map((l) => {
      const colour = l.muted ? C.muted : C.ink;
      const cls = l.muted ? "em-muted" : "em-ink";
      const rule = l.total
        ? `border-top:2px solid ${C.ink}; `
        : l.last
          ? ""
          : `border-bottom:1px solid ${C.line}; `;
      const pad = l.total ? "14px 0 0 0" : "13px 0";
      const padR = l.total ? "14px 0 0 16px" : "13px 0 13px 16px";
      const head = l.total
        ? `font-family:${FONT_HEAD}; font-size:15px; line-height:22px; font-weight:bold; letter-spacing:1px; text-transform:uppercase;`
        : `font-family:${FONT_BODY}; font-size:14px; line-height:21px;`;
      const val = l.total
        ? `font-family:${FONT_BODY}; font-size:15px; line-height:22px; font-weight:bold;`
        : `font-family:${FONT_BODY}; font-size:14px; line-height:21px;`;
      return `              <tr>
                <td class="em-hr ${cls}" style="${rule}padding:${pad}; ${head} color:${colour}; background-color:${C.card};">${l.label}</td>
                <td align="right" class="em-hr ${cls}" style="${rule}padding:${padR}; ${val} color:${colour}; background-color:${C.card}; white-space:nowrap;">${l.value}</td>
              </tr>`;
    })
    .join("\n");
  return `        <tr>
          <td class="em-px em-card" style="padding:6px 48px 0 48px; background-color:${C.card};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
${body}
            </table>
          </td>
        </tr>
`;
}

/** Footer legal block for the plain-text alternative. */
export function textFooter(lang: Lang, note: string): string {
  const site = baseUrl();
  return [
    "",
    "—",
    `${BRAND.legal} · ${BRAND.address}`,
    `${site}/`,
    note || COMMON[lang].serviceNote,
  ].join("\n");
}

/** Collapse blank runs so the plain-text part never ships three empty lines. */
export function textBody(parts: Array<string | false | null | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === "string")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
