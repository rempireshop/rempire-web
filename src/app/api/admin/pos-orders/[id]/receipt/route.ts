/**
 * GET /api/admin/pos-orders/<id>/receipt/?lang=RU|ET|EN — the printable slip
 * for an in-salon sale. `<id>` is the order uuid or its number (R-100042),
 * same convention as GET /api/admin/orders/<id>/.
 *
 * Standalone HTML, not part of the admin SPA — opened with
 * `target="_blank"` from the «Продажа в салоне» screen (see the receipt link
 * next to a channel:'pos' order in public/shop2/app.js), so `window.print()`
 * on it is the whole "print/download" story: the browser's own print dialog
 * offers "Save as PDF" everywhere that matters.
 *
 * Behind requireAdmin like every other order document (the shipping label
 * PDF is the precedent) — a receipt carries the customer's name and address.
 */
import { esc, normalizeLang } from "@/emails/layout";
import { requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const T = {
  ru: {
    title: "Чек",
    salon: "Салон Rempire",
    order: "Продажа №",
    date: "Дата",
    item: "Товар",
    qty: "Кол-во",
    price: "Цена",
    sum: "Сумма",
    discount: "Скидка",
    total: "Итого",
    payment: "Оплата",
    cash: "наличные",
    terminal: "терминал",
    customer: "Покупатель",
    thanks: "Спасибо за покупку!",
    print: "Печать",
  },
  et: {
    title: "Kviitung",
    salon: "Rempire salong",
    order: "Müük nr",
    date: "Kuupäev",
    item: "Toode",
    qty: "Kogus",
    price: "Hind",
    sum: "Summa",
    discount: "Allahindlus",
    total: "Kokku",
    payment: "Makseviis",
    cash: "sularaha",
    terminal: "kaardimakse",
    customer: "Klient",
    thanks: "Aitäh ostu eest!",
    print: "Prindi",
  },
  en: {
    title: "Receipt",
    salon: "Rempire salon",
    order: "Sale No.",
    date: "Date",
    item: "Item",
    qty: "Qty",
    price: "Price",
    sum: "Sum",
    discount: "Discount",
    total: "Total",
    payment: "Payment",
    cash: "cash",
    terminal: "card terminal",
    customer: "Customer",
    thanks: "Thank you for your purchase!",
    print: "Print",
  },
} as const;

function eur(n: number): string {
  return (Number(n) || 0).toFixed(2).replace(".", ",") + " €";
}
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function find(id: string) {
  return (await getOrder(id)) ?? (await getOrderByNumber(id));
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const url = new URL(req.url);

  let order;
  try {
    order = await find(id);
  } catch (err) {
    console.error("[api/admin/pos-orders/:id/receipt] lookup failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const lang = normalizeLang(url.searchParams.get("lang") || order.lang);
  const t = T[lang];
  const payment = (order.payment ?? {}) as { method?: unknown; provider?: unknown };
  const payMethod = payment.method === "terminal" ? t.terminal : payment.method === "cash" ? t.cash : String(payment.method ?? "");

  const rows = order.items
    .map((l) => {
      const name = esc((l.brand ? l.brand + " " : "") + l.title + (l.variant ? " — " + l.variant : ""));
      return `<tr><td>${name}</td><td class="num">${l.qty}</td><td class="num">${eur(l.price)}</td><td class="num">${eur(l.sum)}</td></tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)} ${esc(order.number)}</title>
<style>
  :root{color-scheme:light}
  body{font-family:'Golos Text',Arial,Helvetica,sans-serif;background:#edeae1;color:#1c1a00;margin:0;padding:24px}
  .slip{max-width:380px;margin:0 auto;background:#fff;border:1px solid #e5e1d6;padding:20px 22px}
  h1{font-family:'Oswald',Arial,sans-serif;font-size:18px;letter-spacing:.04em;margin:0 0 2px}
  .sub{color:#6f6b57;font-size:12.5px;margin:0 0 14px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0}
  th{text-align:left;color:#6f6b57;font-weight:500;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e5e1d6;padding:4px 2px}
  td{padding:6px 2px;border-bottom:1px solid #f1efe6;vertical-align:top}
  .num{text-align:right;white-space:nowrap}
  .row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0}
  .total{font-size:16px;font-weight:600;border-top:1px solid #1c1a00;margin-top:6px;padding-top:8px}
  .muted{color:#6f6b57}
  .foot{text-align:center;margin-top:18px;font-size:12.5px;color:#6f6b57}
  .print{display:block;width:100%;margin-top:18px;padding:10px;font-size:14px;background:#1c1a00;color:#fff;border:0;cursor:pointer}
  @media print{ body{background:#fff;padding:0} .slip{border:0;max-width:100%} .print{display:none} }
</style>
</head><body>
<div class="slip">
  <h1>${esc(t.salon)}</h1>
  <p class="sub">Mardi 1, 10145 Tallinn — Rempire Store OÜ</p>
  <div class="row"><span>${esc(t.order)}</span><span><b>${esc(order.number)}</b></span></div>
  <div class="row"><span>${esc(t.date)}</span><span>${esc(when(order.createdAt))}</span></div>
  ${order.name && order.name !== "Продажа в салоне" ? `<div class="row"><span>${esc(t.customer)}</span><span>${esc(order.name)}</span></div>` : ""}
  ${order.email ? `<div class="row muted"><span></span><span>${esc(order.email)}</span></div>` : ""}
  <table>
    <thead><tr><th>${esc(t.item)}</th><th class="num">${esc(t.qty)}</th><th class="num">${esc(t.price)}</th><th class="num">${esc(t.sum)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${order.discount ? `<div class="row"><span>${esc(t.discount)}${order.discountCode ? " · " + esc(order.discountCode) : ""}</span><span>−${eur(order.discount)}</span></div>` : ""}
  <div class="row total"><span>${esc(t.total)}</span><span>${eur(order.total)}</span></div>
  <div class="row muted"><span>${esc(t.payment)}</span><span>${esc(payMethod)}</span></div>
  <p class="foot">${esc(t.thanks)}</p>
  <button class="print" onclick="window.print()">${esc(t.print)}</button>
</div>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
