/**
 * «Отписаться» — the link under the three marketing letters, and the target
 * of the mail client's own unsubscribe button.
 *
 *   GET  /api/mail/unsubscribe/?u=<base64url "email|kind|lang">&t=<token>
 *        A human clicked the link. Verifies the token, takes the address off
 *        the list (src/lib/consent.ts optOut) and answers a small page in the
 *        letter's language: «Вы отписаны. Письма о заказах будут приходить
 *        как прежде.» A link that does not check out answers 400 with «Ссылка
 *        не работает. Напишите нам: …». Both idempotent — the second click
 *        gets the same page.
 *   POST same URL, body `List-Unsubscribe=One-Click` (RFC 8058)
 *        Gmail, Apple Mail and the rest press the button for the person and
 *        follow no redirect, so the address in the header is this exact URL,
 *        trailing slash and all. Same check, same write, `200` plain text.
 *
 * The token is the only credential: one HMAC per mailbox, no sign-in — a
 * guest with a cart has no account to sign in to, and the worst a stolen
 * link can do is take its own address off a list. 30 requests a minute per
 * IP, so nobody can grind tokens through it. The page never prints the
 * address in full (`r***@example.com`), and nothing here logs it at all.
 *
 * Self-contained HTML on purpose: no script, no font, no image — the page
 * has to render inside whatever a mail client opens, and the shop's CSP for
 * this path allows inline styles.
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { baseUrl, esc } from "@/emails/layout";
import { maskEmail, optOut, readUnsubscribeParams, supportAddress } from "@/lib/consent";
import type { LangCode } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 30;
const WINDOW_MS = 60_000;

interface Strings {
  done: string;
  doneText: (masked: string) => string;
  shop: string;
  bad: string;
  badText: string;
  later: string;
  laterText: string;
  writeUs: string;
}

const T: Record<LangCode, Strings> = {
  RU: {
    done: "Вы отписаны",
    doneText: (m) => `Рассылок на адрес ${m} больше не будет. Письма о заказах будут приходить как прежде.`,
    shop: "В магазин",
    bad: "Ссылка не работает",
    badText: "Отпишем вручную — напишите нам.",
    later: "Не получилось",
    laterText: "Попробуйте ссылку ещё раз чуть позже, или напишите нам.",
    writeUs: "Напишите нам:",
  },
  ET: {
    done: "Olete loobunud",
    doneText: (m) => `Aadressile ${m} pakkumisi enam ei saadeta. Tellimuste kirjad tulevad nagu varem.`,
    shop: "Poodi",
    bad: "Link ei tööta",
    badText: "Võtame teid nimekirjast maha käsitsi — kirjutage meile.",
    later: "Ei õnnestunud",
    laterText: "Proovige linki veidi hiljem uuesti või kirjutage meile.",
    writeUs: "Kirjutage meile:",
  },
  EN: {
    done: "You are unsubscribed",
    doneText: (m) => `No more offers to ${m}. Order e-mails keep coming as before.`,
    shop: "Back to the shop",
    bad: "This link does not work",
    badText: "We will unsubscribe you by hand — write to us.",
    later: "That did not work",
    laterText: "Try the link again in a little while, or write to us.",
    writeUs: "Write to us:",
  },
};

function shopUrl(lang: LangCode): string {
  const seg = lang === "ET" ? "/et" : lang === "EN" ? "/en" : "";
  return `${baseUrl()}/shop2${seg}/`;
}

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
} as const;

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
} as const;

/** The whole page: the shop's cream, its ink, its stack — and nothing loaded from anywhere. */
function page(lang: LangCode, title: string, body: string, status: number): Response {
  const t = T[lang];
  const html = `<!DOCTYPE html>
<html lang="${lang.toLowerCase()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} — Rempire</title>
<style>
  body{margin:0;background:#edeae1;color:#1c1a00;font-family:'Golos Text',-apple-system,'Segoe UI',Arial,Helvetica,sans-serif;}
  main{max-width:520px;margin:0 auto;padding:72px 24px 96px;}
  .brand{margin:0 0 40px;font-size:18px;font-weight:700;letter-spacing:8px;text-transform:uppercase;}
  h1{margin:0 0 16px;font-size:22px;line-height:30px;letter-spacing:2px;text-transform:uppercase;}
  p{margin:0 0 24px;font-size:16px;line-height:24px;}
  a{color:#1c1a00;}
  .btn{display:inline-block;padding:15px 30px;background:#1c1a00;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;}
</style>
</head>
<body>
<main>
  <p class="brand">Rempire</p>
  <h1>${esc(title)}</h1>
${body}
  <a class="btn" href="${esc(shopUrl(lang))}">${esc(t.shop)}</a>
</main>
</body>
</html>
`;
  return new Response(html, { status, headers: HTML_HEADERS });
}

function writeUsLine(lang: LangCode): string {
  const addr = supportAddress();
  if (!addr) return "";
  return `  <p>${esc(T[lang].writeUs)} <a href="mailto:${esc(addr)}">${esc(addr)}</a></p>\n`;
}

function donePage(lang: LangCode, email: string): Response {
  const t = T[lang];
  return page(lang, t.done, `  <p>${esc(t.doneText(maskEmail(email)))}</p>\n`, 200);
}

function badPage(lang: LangCode): Response {
  const t = T[lang];
  return page(lang, t.bad, `  <p>${esc(t.badText)}</p>\n${writeUsLine(lang)}`, 400);
}

function laterPage(lang: LangCode): Response {
  const t = T[lang];
  return page(lang, t.later, `  <p>${esc(t.laterText)}</p>\n${writeUsLine(lang)}`, 503);
}

function params(req: Request) {
  const url = new URL(req.url);
  return readUnsubscribeParams(url.searchParams.get("u"), url.searchParams.get("t"));
}

export async function GET(req: Request) {
  if (rateLimit("mail-unsubscribe", clientIp(req), LIMIT, WINDOW_MS)) {
    return new Response("rate_limited", { status: 429, headers: { ...TEXT_HEADERS, "retry-after": "60" } });
  }
  const p = params(req);
  if (!p.ok) return badPage(p.lang);
  try {
    await optOut(p.email, p.kind, "link");
  } catch (err) {
    console.error("[api/mail/unsubscribe] write failed:", (err as Error)?.message ?? err);
    return laterPage(p.lang);
  }
  return donePage(p.lang, p.email);
}

/* RFC 8058 §3.2: the client POSTs `List-Unsubscribe=One-Click` to the URL
   from the header and expects a 2xx. The body is not read — the token in
   the URL is the whole credential, and a server that insists on the exact
   body text only adds a way to fail. */
export async function POST(req: Request) {
  if (rateLimit("mail-unsubscribe", clientIp(req), LIMIT, WINDOW_MS)) {
    return new Response("rate_limited", { status: 429, headers: { ...TEXT_HEADERS, "retry-after": "60" } });
  }
  const p = params(req);
  if (!p.ok) return new Response("bad_token", { status: 400, headers: TEXT_HEADERS });
  try {
    await optOut(p.email, p.kind, "one-click");
  } catch (err) {
    console.error("[api/mail/unsubscribe] one-click write failed:", (err as Error)?.message ?? err);
    return new Response("db_unavailable", { status: 503, headers: TEXT_HEADERS });
  }
  return new Response("ok", { status: 200, headers: TEXT_HEADERS });
}
