import { NextResponse } from "next/server";
import { publicBaseUrl } from "@/lib/payments";
import { mockSecret, readMockTicket, signMockTicket } from "@/lib/payments/mock";

/**
 * The stand-in bank page.
 *
 * /api/payments/mock/?t=<ticket>            → two buttons
 * /api/payments/mock/?t=<ticket>&do=paid    → back to the return URL, paid
 * /api/payments/mock/?t=<ticket>&do=failed  → back to the return URL, failed
 *
 * It exists so the whole flow — order, redirect, payment, webhook-shaped
 * return, receipt — can be walked on a laptop with no Montonio account. The
 * ticket is a signed JWT, so this page cannot be used to mark someone else's
 * order paid without the secret.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function eur(n: number): string {
  return `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";

  let secret: string;
  try {
    secret = mockSecret();
  } catch {
    // no SESSION_SECRET ⇒ no mock provider at all (audit C1)
    return new NextResponse("Тестовая оплата не настроена.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let ticket;
  try {
    ticket = readMockTicket(token, secret);
  } catch {
    return new NextResponse("Ссылка недействительна или устарела.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const decision = url.searchParams.get("do");
  if (decision === "paid" || decision === "failed") {
    const settled = signMockTicket({ ...ticket, status: decision }, secret);
    /* The ticket names where to send the shopper, so this page could be used
       to bounce anyone anywhere from the shop's own domain (audit M7). It
       leads back here or nowhere. */
    let back: URL;
    try {
      back = new URL(ticket.returnUrl);
    } catch {
      return new NextResponse("Ссылка недействительна.", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const base = publicBaseUrl(req);
    const allowed = new Set([url.origin, base ? new URL(base).origin : url.origin]);
    if (!allowed.has(back.origin)) {
      return new NextResponse("Ссылка недействительна.", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    back.searchParams.set("mock-token", settled);
    return NextResponse.redirect(back.toString(), 303);
  }

  const payHref = `?t=${encodeURIComponent(token)}&do=paid`;
  const failHref = `?t=${encodeURIComponent(token)}&do=failed`;

  const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Тестовая оплата — REMPIRE</title>
<style>
  :root { color-scheme: light }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#f4f2ee; color:#14110f;
         font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif }
  .card { background:#fff; border:1px solid #e2ddd5; border-radius:14px;
          padding:28px 24px; width:min(380px,92vw); text-align:center;
          box-shadow:0 12px 32px rgba(20,17,15,.07) }
  .tag { display:inline-block; font-size:12px; letter-spacing:.08em;
         text-transform:uppercase; color:#8a8177; margin-bottom:14px }
  .sum { font-size:30px; font-weight:600; margin:6px 0 2px }
  .ref { color:#8a8177; font-size:14px; margin-bottom:22px }
  a.btn { display:block; padding:15px 18px; border-radius:10px; min-height:44px;
          font-size:16px; font-weight:600; text-decoration:none; box-sizing:border-box }
  .pay { background:#14110f; color:#fff; margin-bottom:10px }
  .cancel { background:transparent; color:#14110f; border:1px solid #d8d2c8 }
  .note { margin:20px 0 0; font-size:13px; color:#8a8177 }
</style></head>
<body>
  <main class="card">
    <div class="tag">Тестовый платёж</div>
    <div class="sum">${esc(eur(ticket.amount))}</div>
    <div class="ref">Заказ ${esc(ticket.orderRef)}</div>
    <a class="btn pay" href="${esc(payHref)}">Оплатить</a>
    <a class="btn cancel" href="${esc(failHref)}">Отменить</a>
    <p class="note">Настоящие деньги не списываются. Эта страница заменяет банк,
      пока магазин не подключён к Montonio.</p>
  </main>
</body></html>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
