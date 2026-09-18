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
 * it takes the newest paid **bank-link** order that has a Montonio uuid and
 * asks `GET /orders/:orderUuid` about it. The method matters and the audit of
 * 18.09.2026 (F12) is why it is in the SQL: the reference's gloss is «will be
 * true if you enabled refunds in montonio **(and the user paid with a
 * refundable method)**», and the refunds guide says cards, wallets, MobilePay,
 * BLIK and BNPL are refundable by default while Payment Initiation needs «Bank
 * payment refunds» switched on separately. A card order therefore answers
 * `true` about cards and says nothing whatever about the product that caused
 * the three refused refunds of 18.09.2026 — and this row used to go green on
 * it and stay green. No bank-link order yet ⇒ «unknown», said plainly, with
 * the method it did see named.
 *
 * **Shipping: yes, properly.** `GET /carriers` carries `hasMontonioContract`
 * and the shop's own `contracts[]` per country, and `GET /webhooks` says
 * whether anybody ever registered the parcel-events URL — which is a manual
 * step nothing else in this shop can notice was skipped. Registered is not
 * enough: the url is compared with this shop's own, trailing slash included
 * (`trailingSlash: true`, so a POST without it is a 308), and the events are
 * checked against the two the notify route acts on (F13).
 *
 * **And when Montonio refuses the keys, it says so.** Every probe still fails
 * soft — a section that could not be asked must not take the screen down — but
 * failing soft is not the same as saying nothing. `401 STORE_NOT_FOUND` and
 * `403 INVALID_TOKEN` now reach the screen as «Montonio не узнал ключи»
 * instead of «Проверяем…» (F14). That is not a nicety: on Sunday 21.09.2026
 * the live keys are pasted in by hand, and half a pair produces exactly the
 * old screen — two grey rows and «как только пройдёт первая оплата», which
 * would never come, because `POST /orders` answers 401 too.
 *
 * The answer is also written to `settings.montonio_readiness` on every
 * successful call, so there is a dated record of what the shop believed it
 * could do — which is the whole point on a day when the thing that is off is
 * invisible.
 */
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  MONTONIO_BANK_METHOD,
  montonioReadinessRows,
  type ReadinessState,
} from "@/lib/montonio-problems";
import { PAID_ORDER_STATUSES, setSetting } from "@/lib/orders";
import { fetchEnabledPaymentMethods } from "@/lib/payments/methods";
import { MontonioProvider, montonioConfigFromEnv } from "@/lib/payments/montonio";
import { pendingRefunds } from "@/lib/payments/pending-refunds";
import {
  fetchMontonioCarrierContracts,
  fetchMontonioWebhooks,
  readWebhookSetup,
  shipmentWebhookUrl,
  type MontonioProbe,
} from "@/lib/shipping/montonio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The settings row that keeps the last answer, dated. */
export const MONTONIO_READINESS_SETTING = "montonio_readiness";

type Refundable = true | false | null;

/** One sampled order, and how Montonio itself says it was paid. */
interface RefundSample {
  number: string;
  ref: string;
  /** Our own `bank | card | wallet`, before Montonio has been asked. */
  method: string;
}

/**
 * The newest paid order that can answer «are bank-link refunds on» — a
 * **bank-link** one, and only if there is none does it fall back.
 *
 * Newest on purpose: the switch is a setting that can be turned on today, and
 * an order from March would answer about March. Bank-link on purpose: a card
 * order answers about cards, which are refundable by default, so it cannot
 * tell this screen anything about the one product it exists for (audit
 * 18.09.2026, F12). The fallback is kept so the screen still has something to
 * say — the row names the method it sampled and stays grey unless it was a
 * bank link.
 *
 * `payment ->> 'method'` is our own vocabulary (`bank | card | wallet`,
 * src/lib/payments/types.ts), never Montonio's; `paymentMethodType` off
 * `GET /orders/:orderUuid` is the authority and overrides it below.
 */
async function newestPaidRef(): Promise<RefundSample | null> {
  try {
    const rows = await query<{ number: string; ref: string; method: string | null }>(
      `select number, payment ->> 'ref' as ref, payment ->> 'method' as method
         from orders
        where status = any($1)
          and coalesce(payment ->> 'ref', '') <> ''
        order by (payment ->> 'method' = 'bank') desc, created_at desc
        limit 1`,
      [[...PAID_ORDER_STATUSES]],
    );
    return rows.length && rows[0].ref
      ? { number: rows[0].number, ref: rows[0].ref, method: rows[0].method ?? "" }
      : null;
  } catch (err) {
    console.error("[api/admin/montonio] could not find a paid order:", err);
    return null;
  }
}

/** Our own stored method word in Montonio's spelling, for the row's sentence. */
function montonioMethodName(ours: string): string {
  if (ours === "bank") return MONTONIO_BANK_METHOD;
  if (ours === "card" || ours === "wallet") return "cardPayments";
  return "";
}

/**
 * Did Montonio accept the keys?
 *
 * Read off the two shipping probes, which is the only place a status survives:
 * the Shipping API shares the Payments key pair (montonioShippingConfig() is
 * montonioConfigFromEnv()), so a 401 there is a 401 everywhere. A 2xx from any
 * probe — including `GET /stores/payment-methods`, which can only say «answered
 * or not» — proves the pair works, and that is what the green row claims.
 *
 * Deliberately not claimed: that the *shipping product itself* is switched on.
 * Whether a valid key with no Shipping product answers 200-with-nothing or 403
 * is not in the reference, and guessing is what this whole file is against —
 * `carriers: 0` gets its own row and its own sentence instead.
 */
function readKeyVerdict(
  methods: string[] | null,
  ...probes: Array<MontonioProbe<unknown>>
): { keys: ReadinessState["keys"]; keyStatus: number | null } {
  if (probes.some((p) => p.ok) || methods !== null) return { keys: "ok", keyStatus: null };

  const statuses = probes.map((p) => (p.ok ? null : p.status)).filter((s): s is number => s !== null);
  if (statuses.includes(401)) return { keys: "bad_access_key", keyStatus: 401 };
  if (statuses.includes(403)) return { keys: "bad_secret_key", keyStatus: 403 };
  if (statuses.length) return { keys: "refused", keyStatus: statuses[0] };
  /* No status anywhere: either nothing answered, or nothing was asked. */
  return probes.length ? { keys: "unreachable", keyStatus: null } : { keys: null, keyStatus: null };
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
          keys: null,
          bankPayments: null,
          refundableBankPayments: null,
          refundSampleMethod: null,
          carriers: null,
          webhook: null,
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
     never reject here. The two shipping probes answer with a MontonioProbe
     rather than `null`, because a refusal and a timeout are different news
     and the `.catch(() => null)` that merged them is F14. */
  const [methods, carriers, webhooks, snapshot, stuck] = await Promise.all([
    fetchEnabledPaymentMethods().catch(() => null),
    fetchMontonioCarrierContracts().catch((err) => {
      console.error("[api/admin/montonio] carriers probe threw:", err);
      return { ok: false as const, status: null, code: "unreachable" as const };
    }),
    fetchMontonioWebhooks().catch((err) => {
      console.error("[api/admin/montonio] webhooks probe threw:", err);
      return { ok: false as const, status: null, code: "unreachable" as const };
    }),
    sample ? provider.fetchOrder(sample.ref).catch(() => null) : Promise.resolve(null),
    pendingRefunds({ limit: 50 }).catch(() => []),
  ]);

  const { keys, keyStatus } = readKeyVerdict(methods, carriers, webhooks);

  /* Which method the sampled order really used. Montonio's own
     `paymentMethodType` is the authority; our stored `bank | card | wallet`
     is the fallback for an answer that did not carry it, translated into
     Montonio's spelling so the row prints one vocabulary. */
  const sampleMethod = sample
    ? snapshot?.paymentMethodType || montonioMethodName(sample.method) || ""
    : "";
  const sampledBank = sampleMethod === MONTONIO_BANK_METHOD;

  /* `isRefundableType` is deliberately three-valued. Absent means the field
     was not in the answer and «мы не знаем» is the honest report; only an
     explicit `false` says the product is off. See fetchOrder().
     And it is only read at all from a BANK-LINK order: on a card one it is
     Montonio answering about cards, which are refundable by default, and
     reporting that as «возвраты включены» is F12. */
  const refundable: Refundable =
    sampledBank && snapshot && typeof snapshot.isRefundableType === "boolean"
      ? snapshot.isRefundableType
      : null;

  const payments = methods
    ? {
        enabled: methods,
        bankPayments: methods.includes(MONTONIO_BANK_METHOD),
        cardPayments: methods.includes("cardPayments"),
      }
    : null;

  const refunds = {
    /* true / false / null — and null is not a failure, it is «нечего было
       спросить»: a shop with no bank-link order yet cannot know. */
    refundableBankPayments: refundable,
    checkedOrder: sample?.number ?? null,
    /* What that order was paid with, so the panel's own sentence and this
       JSON agree about why the answer is or is not usable. */
    checkedMethod: sampleMethod || null,
    availableForRefund: snapshot?.availableForRefund ?? null,
    montonioStatus: snapshot?.paymentStatus ?? null,
    /* Said out loud so nobody looks for an endpoint that is not there. */
    source: "GET /orders/:orderUuid · isRefundableType — Montonio has no product-activation endpoint",
  };

  /* A registered parcel-events webhook is what closes orders by itself, and
     nothing else in this shop notices that it was never set up — nor that it
     still points at the host we moved off, nor that the one event we need was
     left unticked. `readWebhookSetup()` is what looks. */
  const webhook = webhooks.ok ? readWebhookSetup(webhooks.data, shipmentWebhookUrl()) : null;

  const shipping = {
    carriers: carriers.ok ? carriers.data : null,
    webhooks: webhooks.ok ? webhooks.data : null,
    webhook,
    /* Kept for the stored snapshot and anything reading the raw JSON: «есть
       хоть один» — which is exactly the question that used to be enough. */
    webhookRegistered: webhooks.ok ? webhooks.data.length > 0 : null,
  };

  /* The screen's own rows, in all three languages, built here rather than in
     public/shop2/app.js: these sentences are about Montonio's state and change
     when Montonio does, and the storefront dictionary cannot be kept in step
     with an API. The panel prints `sub[<its language>]` and adds no literals
     of its own — see montonioReadinessRows(). */
  const rows = montonioReadinessRows({
    configured: true,
    env: config.env,
    keys,
    keyStatus,
    bankPayments: payments ? payments.bankPayments : null,
    refundableBankPayments: refundable,
    refundSampleMethod: sampleMethod || null,
    carriers: carriers.ok ? carriers.data.length : null,
    webhook,
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
      /* The Sunday record: what Montonio said about the keys, not only what
         we managed to read with them. */
      keys,
      keyStatus,
      enabledMethods: methods,
      refundableBankPayments: refundable,
      checkedOrder: refunds.checkedOrder,
      checkedMethod: refunds.checkedMethod,
      availableForRefund: refunds.availableForRefund,
      carriers: carriers.ok ? carriers.data.map((c) => c.code) : null,
      webhookRegistered: shipping.webhookRegistered,
      webhookState: webhook?.state ?? null,
      webhookUrls: webhook?.urls ?? null,
      webhookExpectedUrl: webhook?.expectedUrl || null,
      webhookMissingEvents: webhook?.missingEvents ?? null,
      pendingRefunds: stuck.length,
      overdueRefunds: stuck.filter((r) => r.overdue).length,
    });
  } catch (err) {
    console.error("[api/admin/montonio] could not record the readiness snapshot:", err);
  }

  return Response.json({ ok: true, ...data }, { headers: NO_STORE });
}
