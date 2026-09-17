/**
 * «Отписаться» — the link under the three marketing letters, and the target
 * of the mail client's own unsubscribe button.
 *
 *   GET  /api/mail/unsubscribe/?u=<base64url "email|kind|lang">&t=<token>
 *        Somebody — or something — opened the link. Verifies the token and
 *        answers a page. It writes nothing at all.
 *
 *        Until 17.09.2026 this handler called optOut() straight away, and the
 *        link in a letter is a plain <a href>: a mail scanner, a Safe-Links
 *        rewriter or a preview fetcher took the customer off the list without
 *        them touching anything, and on a back-in-stock letter it DELETED
 *        every alert they were still waiting on. A preference wrongly flipped
 *        is annoying; those rows are gone.
 *
 *        So the page finishes the job itself: an inline script POSTs back to
 *        this same URL the moment a browser renders it. A fetcher gets the
 *        HTML, runs no script, never follows up with a state-changing request
 *        — and nothing is written. For a person it is still ONE press, the
 *        one in the letter; the second request is the page's, not theirs.
 *
 *        Scripting off: the very same page shows a real <form method="post">
 *        with an «Отписаться» button. The form is what the HTML says by
 *        default and the script hides it, so anything that cannot run the
 *        script — an old browser, a blocked inline script, a failed fetch —
 *        falls back to a visible control instead of silently not
 *        unsubscribing anybody.
 *
 *   POST same URL. Two callers, told apart by `from=page` in the body:
 *
 *        · the page above. This is the human's press arriving a moment late,
 *          so it is written as source "link" — the customer card still says
 *          «Отписался по ссылке в письме» — and answered with the HTML the
 *          GET used to answer: «Вы отписаны», or the 400 / 503 pages. The
 *          script reads only the status and throws the body away; the
 *          no-script form lands on it as a normal page.
 *
 *        · a mail client, body `List-Unsubscribe=One-Click` (RFC 8058).
 *          Gmail, Apple Mail and the rest press the button for the person and
 *          follow no redirect, so the address in the header is this exact
 *          URL, trailing slash and all. Source "one-click", `200` plain text,
 *          unchanged. `List-Unsubscribe` and `List-Unsubscribe-Post` are on
 *          every marketing letter already (src/lib/consent.ts,
 *          unsubscribeHeaders) and point here; none of this touches them.
 *
 *        Both idempotent — a second press gets the same answer.
 *
 * The token is the only credential: one HMAC per mailbox, no sign-in — a
 * guest with a cart has no account to sign in to, and the worst a stolen
 * link can do is take its own address off a list. 30 requests a minute per
 * IP, so nobody can grind tokens through it. The page never prints the
 * address in full (`r***@example.com`), and nothing here logs it at all.
 *
 * Self-contained HTML on purpose: no font, no image, nothing fetched from
 * anywhere — the page has to render wherever a mail client opens it. The one
 * script is inline and so are the styles; the shop's CSP allows both on this
 * path (next.config.ts: only /shop2/* gets the strict `script-src 'self'`).
 */
import { clientIp, rateLimit } from "@/lib/auth";
import { baseUrl, esc } from "@/emails/layout";
import {
  hasPendingStockAlerts,
  maskEmail,
  optOut,
  readUnsubscribeParams,
  supportAddress,
  type OptOutKind,
} from "@/lib/consent";
import type { LangCode } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 30;
const WINDOW_MS = 60_000;

/** What the page's own POST carries and a mail client's does not. */
const FROM_PAGE = "from=page";

interface Strings {
  /** The page as it leaves the server: an offer, not a fait accompli. */
  ask: string;
  askText: (masked: string) => string;
  askBtn: string;
  /** Between the script's POST and its answer. */
  working: string;
  /** The POST did not go through — the button below it is the way out. */
  retry: string;
  done: string;
  doneText: (masked: string) => string;
  /**
   * The one letter «больше не будет» does not cover, shown only to somebody it
   * is really true for: a «сообщите о наличии» notice is something the shopper
   * asked for by name, and the stop list does not block it (src/lib/consent.ts).
   * Without this line the page promised silence and the shop went on writing.
   */
  stillWaiting: string;
  shop: string;
  bad: string;
  badText: string;
  later: string;
  laterText: string;
  writeUs: string;
}

const T: Record<LangCode, Strings> = {
  RU: {
    ask: "Отписаться",
    askText: (m) => `Нажмите кнопку — и рассылок на адрес ${m} больше не будет.`,
    askBtn: "Отписаться",
    working: "Отписываем…",
    retry: "Не получилось. Нажмите кнопку ещё раз.",
    done: "Вы отписаны",
    doneText: (m) => `Рассылок на адрес ${m} больше не будет. Письма о заказах будут приходить как прежде.`,
    stillWaiting: "Уведомление о наличии товара вы просили сами — оно всё равно придёт. Отказаться от него можно по ссылке в том письме.",
    shop: "В магазин",
    bad: "Ссылка не работает",
    badText: "Отпишем вручную — напишите нам.",
    later: "Не получилось",
    laterText: "Попробуйте ссылку ещё раз чуть позже, или напишите нам.",
    writeUs: "Напишите нам:",
  },
  ET: {
    ask: "Loobu kirjadest",
    askText: (m) => `Vajutage nuppu — ja aadressile ${m} pakkumisi enam ei saadeta.`,
    askBtn: "Loobun",
    working: "Loobume…",
    retry: "Ei õnnestunud. Vajutage nuppu uuesti.",
    done: "Olete loobunud",
    doneText: (m) => `Aadressile ${m} pakkumisi enam ei saadeta. Tellimuste kirjad tulevad nagu varem.`,
    stillWaiting: "Toote saadavuse teavitust palusite ise — see tuleb ikkagi. Sellest saab loobuda selle kirja lingiga.",
    shop: "Poodi",
    bad: "Link ei tööta",
    badText: "Võtame teid nimekirjast maha käsitsi — kirjutage meile.",
    later: "Ei õnnestunud",
    laterText: "Proovige linki veidi hiljem uuesti või kirjutage meile.",
    writeUs: "Kirjutage meile:",
  },
  EN: {
    ask: "Unsubscribe",
    askText: (m) => `Press the button and no more offers go to ${m}.`,
    askBtn: "Unsubscribe",
    working: "Unsubscribing…",
    retry: "That did not work. Press the button again.",
    done: "You are unsubscribed",
    doneText: (m) => `No more offers to ${m}. Order e-mails keep coming as before.`,
    stillWaiting: "You asked for the back-in-stock notice yourself — it still arrives. The link in that e-mail cancels it.",
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

/**
 * The shop's cream, its ink, its stack — and nothing loaded from anywhere.
 *
 * `extraStyle` / `head` are what the confirmation page adds on top: the four
 * states it can be in, and the one line that decides which of them a browser
 * starts from. Every other page here passes neither.
 */
function page(
  lang: LangCode,
  title: string,
  body: string,
  status: number,
  extra: { style?: string; head?: string } = {},
): Response {
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
${extra.style ?? ""}</style>
${extra.head ?? ""}</head>
<body>
<main>
  <p class="brand">Rempire</p>
${body}</main>
</body>
</html>
`;
  return new Response(html, { status, headers: HTML_HEADERS });
}

/** A page with one heading, one or more paragraphs and the way back to the shop. */
function simplePage(lang: LangCode, title: string, body: string, status: number): Response {
  return page(lang, title, `  <h1>${esc(title)}</h1>\n${body}  <a class="btn" href="${esc(shopUrl(lang))}">${esc(T[lang].shop)}</a>\n`, status);
}

function writeUsLine(lang: LangCode): string {
  const addr = supportAddress();
  if (!addr) return "";
  return `  <p>${esc(T[lang].writeUs)} <a href="mailto:${esc(addr)}">${esc(addr)}</a></p>\n`;
}

/** The finished text — the same words whether the script swapped it in or the form landed on it. */
function doneBody(lang: LangCode, email: string, stillWaiting: boolean): string {
  const t = T[lang];
  const extra = stillWaiting ? `  <p>${esc(t.stillWaiting)}</p>\n` : "";
  return `  <p>${esc(t.doneText(maskEmail(email)))}</p>\n${extra}`;
}

function donePage(lang: LangCode, email: string, stillWaiting: boolean): Response {
  return simplePage(lang, T[lang].done, doneBody(lang, email, stillWaiting), 200);
}

function badPage(lang: LangCode): Response {
  const t = T[lang];
  return simplePage(lang, t.bad, `  <p>${esc(t.badText)}</p>\n${writeUsLine(lang)}`, 400);
}

function laterPage(lang: LangCode): Response {
  const t = T[lang];
  return simplePage(lang, t.later, `  <p>${esc(t.laterText)}</p>\n${writeUsLine(lang)}`, 503);
}

/* ---------- the page that finishes the job -------------------------------- */

/**
 * Four states in one document, switched by the class on <html>:
 *
 *   ""      — what the server sends and what a fetcher, a text browser or a
 *             person with scripting off sees: the form, and only the form.
 *   "js"    — a browser with fetch took over: «Отписываем…».
 *   "done"  — the POST came back 2xx.
 *   "fail"  — it did not; the form is back, with a line above it.
 *
 * The first script runs in <head>, before the form is painted, so a person
 * with a working browser never sees a button flash past. The second runs
 * after the form exists. Both are inline, both are blocked or allowed
 * together, and the class only ever moves away from the state that needs no
 * script at all — so every way this can go wrong ends on a visible button.
 *
 * The fifteen seconds in the first script are for the one failure a .catch()
 * cannot see: a fetch that never settles at all (no network, a captive
 * portal, a tunnel). Without it the page spins on «Отписываем…» for as long
 * as the person is willing to watch it. A late answer still wins — whichever
 * of the two writes last is the one telling the truth — and pressing the
 * button in the meantime only repeats a write that is idempotent anyway.
 */
const CONFIRM_STYLE = `  #work,#done,#fail{display:none;}
  .js #ask,.done #ask{display:none;}
  .js #work,.done #done,.fail #fail{display:block;}
  #fail{color:#8a2b14;}
  button.btn{border:0;cursor:pointer;font-family:inherit;}
`;

const HEAD_SCRIPT = `<script>
(function(){if(!window.fetch)return;var h=document.documentElement;h.className="js";
setTimeout(function(){if(h.className==="js")h.className="fail";},15000);})();
</script>
`;

/** Kept on one line on purpose: nothing in here is worth reading in a mail client's view-source. */
const BODY_SCRIPT = `<script>
(function(){var h=document.documentElement,f=document.getElementById("go");if(!f||!window.fetch){h.className="";return;}
fetch(f.action,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:${JSON.stringify(FROM_PAGE)}})
.then(function(r){h.className=r.ok?"done":"fail";},function(){h.className="fail";});})();
</script>
`;

function confirmPage(lang: LangCode, email: string, action: string, stillWaiting: boolean): Response {
  const t = T[lang];
  const masked = maskEmail(email);
  const body = `  <section id="fail" hidden>
    <p>${esc(t.retry)}</p>
${writeUsLine(lang)}  </section>
  <section id="ask">
    <h1>${esc(t.ask)}</h1>
    <p>${esc(t.askText(masked))}</p>
    <form id="go" method="post" action="${esc(action)}">
      <input type="hidden" name="from" value="page">
      <button class="btn" type="submit">${esc(t.askBtn)}</button>
    </form>
  </section>
  <section id="work" hidden>
    <h1>${esc(t.working)}</h1>
  </section>
  <section id="done" hidden>
    <h1>${esc(t.done)}</h1>
${doneBody(lang, email, stillWaiting)}    <a class="btn" href="${esc(shopUrl(lang))}">${esc(t.shop)}</a>
  </section>
${BODY_SCRIPT}`;
  return page(lang, t.ask, body, 200, { style: CONFIRM_STYLE, head: HEAD_SCRIPT });
}

/* ---------- the two handlers ---------------------------------------------- */

function params(req: Request) {
  const url = new URL(req.url);
  return readUnsubscribeParams(url.searchParams.get("u"), url.searchParams.get("t"));
}

/**
 * Will a «сообщите о наличии» letter still come once this opt-out is written?
 *
 * A back-in-stock link cancels every alert the address is still waiting on,
 * so the answer is no and there is nothing to ask. A marketing link never
 * touches those rows, so the answer is the same before the write and after it
 * — which is what lets the confirmation page carry the finished sentence
 * while nothing has been written yet.
 */
async function stillWaiting(email: string, kind: OptOutKind): Promise<boolean> {
  return kind === "backstock" ? false : hasPendingStockAlerts(email);
}

function tooMany(req: Request): boolean {
  return rateLimit("mail-unsubscribe", clientIp(req), LIMIT, WINDOW_MS);
}

const RATE_LIMITED = () =>
  new Response("rate_limited", { status: 429, headers: { ...TEXT_HEADERS, "retry-after": "60" } });

export async function GET(req: Request) {
  if (tooMany(req)) return RATE_LIMITED();
  const p = params(req);
  if (!p.ok) return badPage(p.lang);
  const url = new URL(req.url);
  return confirmPage(p.lang, p.email, `${url.pathname}${url.search}`, await stillWaiting(p.email, p.kind));
}

/* RFC 8058 §3.2: the client POSTs `List-Unsubscribe=One-Click` to the URL
   from the header and expects a 2xx. The body is read for one thing only —
   the page's own `from=page` marker — and never insisted on: a server that
   demands the exact RFC body text only adds a way for a real client to fail.
   Anything without the marker is treated as a mail client, which is the
   conservative reading: it gets plain text and the "one-click" stamp. */
export async function POST(req: Request) {
  if (tooMany(req)) return RATE_LIMITED();
  let body = "";
  try {
    body = (await req.text()).slice(0, 400);
  } catch {
    body = "";
  }
  const fromPage = body.split("&").includes(FROM_PAGE);

  const p = params(req);
  if (!p.ok) {
    return fromPage ? badPage(p.lang) : new Response("bad_token", { status: 400, headers: TEXT_HEADERS });
  }
  try {
    await optOut(p.email, p.kind, fromPage ? "link" : "one-click");
  } catch (err) {
    console.error("[api/mail/unsubscribe] write failed:", (err as Error)?.message ?? err);
    return fromPage ? laterPage(p.lang) : new Response("db_unavailable", { status: 503, headers: TEXT_HEADERS });
  }
  if (!fromPage) return new Response("ok", { status: 200, headers: TEXT_HEADERS });
  /* Asked after the write, exactly as the GET used to: a back-in-stock link
     has just cancelled this address's pending alerts, so it answers "no" and
     the page keeps the plain promise it has always made. */
  return donePage(p.lang, p.email, await stillWaiting(p.email, p.kind));
}
