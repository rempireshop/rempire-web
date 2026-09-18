/**
 * GET /api/admin/montonio/ — «что Montonio умеет прямо сейчас».
 *
 * The screen that has to exist because of what the owner found on 18.09.2026:
 * in Montonio's Partner System, **«Refundable bank payments» is a separate
 * product** from «Bank payments», and it cannot even be switched on in test
 * mode («Product activation unavailable in test mode. Switch to live mode to
 * proceed»). A shop whose bank payments are on and whose *refundable* bank
 * payments are not looks perfect — orders are taken, money arrives, letters go
 * out — right up to the first customer who asks for money back.
 *
 * ## Does Montonio expose which products are active?
 *
 * **Payments: partly, and not the one that matters.**
 * `GET /stores/payment-methods` returns only the methods the store has
 * enabled, each as a key of `paymentMethods` — so the key list IS the
 * activation list, and its guide says as much about an empty answer: «if empty
 * that means the paymentMethods have not been enabled for you store». But the
 * API reference documents six paths in total — `/stores/payment-methods`,
 * `/orders`, `/orders/:orderUuid`, `/refunds`, `/payment-links`, `/sessions` —
 * and **no store, product or activation resource among them**. Refundable bank
 * payments has no endpoint. Its only trace anywhere in the API is one boolean
 * on one order:
 *
 *   «"isRefundableType": false, // will be true if you enabled refunds in
 *   montonio (and the user paid with a refundable method)»
 *   — API reference § Get Order by UUID
 *
 * So that is what this route does instead of asking a question with no answer:
 * it takes the newest paid order that has a Montonio uuid and asks
 * `GET /orders/:orderUuid` about it. `isRefundableType: false` on a real paid
 * bank-link order is the switch being off, and it is the only evidence that
 * exists. No paid order yet ⇒ «unknown», said plainly, not guessed.
 *
 * **Shipping: yes, properly.** `GET /carriers` carries `hasMontonioContract`
 * and the shop's own `contracts[]` per country, and `GET /webhooks` says
 * whether anybody ever registered the parcel-events URL — which is a manual
 * step nothing else in this shop can notice was skipped.
 *
 * Everything here is read-only and every probe fails soft: a section that
 * could not be asked says so (`null`) instead of taking the screen down. The
 * answer is also written to `settings.montonio_readiness` on every successful
 * call, so there is a dated record of what the shop believed it could do —
 * which is the whole point on a day when the thing that is off is invisible.
 */
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { montonioReadinessRows } from "@/lib/montonio-problems";
import { PAID_ORDER_STATUSES, setSetting } from "@/lib/orders";
import { fetchEnabledPaymentMethods } from "@/lib/payments/methods";
import { MontonioProvider, montonioConfigFromEnv } from "@/lib/payments/montonio";
import { pendingRefunds } from "@/lib/payments/pending-refunds";
import { fetchMontonioCarrierContracts, fetchMontonioWebhooks } from "@/lib/shipping/montonio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The settings row that keeps the last answer, dated. */
export const MONTONIO_READINESS_SETTING = "montonio_readiness";

/**
 * Bank links are the method most of this shop's customers use, so they are the
 * method whose refundability decides whether «Вернуть деньги» works at all.
 * `paymentInitiation` is Montonio's name for them.
 */
const BANK_METHOD = "paymentInitiation";

type Refundable = true | false | null;

/**
 * The newest paid order carrying a Montonio order uuid — the one real sample
 * `isRefundableType` can be read from. Newest on purpose: the switch is a
 * setting that can be turned on today, and an order from March would answer
 * about March.
 */
async function newestPaidRef(): Promise<{ number: string; ref: string } | null> {
  try {
    const rows = await query<{ number: string; ref: string }>(
      `select number, payment ->> 'ref' as ref
         from orders
        where status = any($1)
          and coalesce(payment ->> 'ref', '') <> ''
        order by created_at desc
        limit 1`,
      [[...PAID_ORDER_STATUSES]],
    );
    return rows.length && rows[0].ref ? { number: rows[0].number, ref: rows[0].ref } : null;
  } catch (err) {
    console.error("[api/admin/montonio] could not find a paid order:", err);
    return null;
  }
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const config = montonioConfigFromEnv();
  if (!config) {
    return Response.json(
      {
        ok: true,
        configured: false,
        env: null,
        payments: null,
        refunds: null,
        shipping: null,
        pending: [],
        rows: montonioReadinessRows({
          configured: false,
          env: null,
          bankPayments: null,
          refundableBankPayments: null,
          carriers: null,
          webhookRegistered: null,
          pendingRefunds: 0,
          overdueRefunds: 0,
        }),
      },
      { headers: NO_STORE },
    );
  }

  const provider = new MontonioProvider(config);
  const sample = await newestPaidRef();

  /* Five independent questions, asked at once, none of which may take the
     others down with it — every one carries its own `catch`, so `all` can
     never reject here. */
  const [methods, carriers, webhooks, snapshot, stuck] = await Promise.all([
    fetchEnabledPaymentMethods().catch(() => null),
    fetchMontonioCarrierContracts().catch(() => null),
    fetchMontonioWebhooks().catch(() => null),
    sample ? provider.fetchOrder(sample.ref).catch(() => null) : Promise.resolve(null),
    pendingRefunds({ limit: 50 }).catch(() => []),
  ]);

  /* `isRefundableType` is deliberately three-valued. Absent means the field
     was not in the answer and «мы не знаем» is the honest report; only an
     explicit `false` says the product is off. See fetchOrder(). */
  const refundable: Refundable =
    snapshot && typeof snapshot.isRefundableType === "boolean" ? snapshot.isRefundableType : null;

  const payments = methods
    ? {
        enabled: methods,
        bankPayments: methods.includes(BANK_METHOD),
        cardPayments: methods.includes("cardPayments"),
      }
    : null;

  const refunds = {
    /* true / false / null — and null is not a failure, it is «нечего было
       спросить»: a shop with no paid order yet cannot know. */
    refundableBankPayments: refundable,
    checkedOrder: sample?.number ?? null,
    availableForRefund: snapshot?.availableForRefund ?? null,
    montonioStatus: snapshot?.paymentStatus ?? null,
    /* Said out loud so nobody looks for an endpoint that is not there. */
    source: "GET /orders/:orderUuid · isRefundableType — Montonio has no product-activation endpoint",
  };

  const shipping = {
    carriers,
    webhooks,
    /* A registered parcel-events webhook is what closes orders by itself.
       Nothing else in this shop notices that it was never set up. */
    webhookRegistered: webhooks === null ? null : webhooks.length > 0,
  };

  /* The screen's own rows, in all three languages, built here rather than in
     public/shop2/app.js: these sentences are about Montonio's state and change
     when Montonio does, and the storefront dictionary cannot be kept in step
     with an API. The panel prints `sub[<its language>]` and adds no literals
     of its own — see montonioReadinessRows(). */
  const rows = montonioReadinessRows({
    configured: true,
    env: config.env,
    bankPayments: payments ? payments.bankPayments : null,
    refundableBankPayments: refundable,
    carriers: carriers ? carriers.length : null,
    webhookRegistered: shipping.webhookRegistered,
    pendingRefunds: stuck.length,
    overdueRefunds: stuck.filter((r) => r.overdue).length,
  });

  const data = {
    configured: true,
    env: config.env,
    payments,
    refunds,
    shipping,
    pending: stuck,
    rows,
    checkedAt: new Date().toISOString(),
  };

  /* The dated record — the «startup or settings-screen check that at least
     records what the shop believes it can do». Facts only: the rows above are
     derived from exactly these and would be four kilobytes of prose rewritten
     on every page view. A probe that answered nothing is still worth
     recording — «в этот день мы не смогли спросить» is information too — and
     a write that fails must not fail the screen. */
  try {
    await setSetting(MONTONIO_READINESS_SETTING, {
      checkedAt: data.checkedAt,
      env: config.env,
      enabledMethods: methods,
      refundableBankPayments: refundable,
      checkedOrder: refunds.checkedOrder,
      availableForRefund: refunds.availableForRefund,
      carriers: carriers ? carriers.map((c) => c.code) : null,
      webhookRegistered: shipping.webhookRegistered,
      pendingRefunds: stuck.length,
      overdueRefunds: stuck.filter((r) => r.overdue).length,
    });
  } catch (err) {
    console.error("[api/admin/montonio] could not record the readiness snapshot:", err);
  }

  return Response.json({ ok: true, ...data }, { headers: NO_STORE });
}
