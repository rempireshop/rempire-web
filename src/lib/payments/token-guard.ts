import { writeAuditSafe } from "@/lib/orders";
import { mapMontonioStatus, type MontonioOrderSnapshot } from "./montonio";
import type { PaymentProvider, VerifyResult } from "./types";

/**
 * The two documented token checks, asked as a question instead of answered as
 * a verdict — Dim's decision of 18.09.2026.
 *
 * Montonio's orders guide validates a returned order token with three
 * comparisons:
 *
 *   decoded.paymentStatus === 'PAID' &&
 *   decoded.uuid === montonioOrderId &&
 *   decoded.accessKey === 'MY_ACCESS_KEY'
 *
 * This shop did one and a half of them. `paymentStatus` was read and mapped;
 * `accessKey` was compared **only when the claim was present**, so a validly
 * signed token carrying none at all passed as ours; and `uuid` — Montonio's
 * own id for the order we started, which `POST /orders` gave us and which sits
 * in `orders.payment.ref` — was never compared with anything.
 *
 * The obvious fix is to refuse a token that fails either one. Dim turned it
 * down, and he is right: that trades a small hole for a bigger one. The small
 * hole needs our secret key to exploit, and with the secret key everything is
 * lost anyway. The bigger one is a customer who really has paid being told the
 * shop never got the money, silently, on the one path that matters — which is
 * exactly what would happen the day Montonio stopped putting `accessKey` on a
 * live token.
 *
 * So both checks are tightened, and a mismatch asks rather than refuses.
 * `fetchOrder()` — `GET /orders/:orderUuid`, «You can use it to double-check
 * the status of the order and its payment» — did not exist when the audit
 * wrote its recommendation and does now. The question goes to Montonio about
 * **our own** order uuid, with our own access key, so an answer of «paid» can
 * only ever be about this shop's order. The mismatch is written to the
 * journal either way, whichever way the answer goes.
 *
 * Fallbacks, when Montonio itself cannot be reached, are never weaker than the
 * behaviour this replaces: nothing is settled, and the webhook is asked to come
 * back (503 → Montonio retries for 48 hours, 13 times).
 */

/** A provider that can be asked what it thinks of an order. Montonio can. */
export interface OrderAskingProvider extends PaymentProvider {
  fetchOrder(orderUuid: string): Promise<MontonioOrderSnapshot | null>;
}

export function canAskProvider(
  p: PaymentProvider | null | undefined,
): p is OrderAskingProvider {
  return !!p && typeof (p as OrderAskingProvider).fetchOrder === "function";
}

/** Just enough of an order row to run the comparison. */
export interface GuardedOrder {
  id: string;
  number: string;
  status?: string | null;
  payment?: unknown;
}

export type GuardVerdict =
  /** Nothing to check, or everything matched. Settle exactly as before. */
  | "clear"
  /** Something did not match, and Montonio itself says the order is paid. */
  | "confirmed"
  /** Something did not match, and Montonio says this is not a paid order. */
  | "refused"
  /** Something did not match and Montonio could not be asked. Try again later. */
  | "unknown";

export interface GuardOutcome {
  verdict: GuardVerdict;
  /** Which of the documented checks failed — for the journal and the logs. */
  mismatches: string[];
  /** What Montonio answered, raw, when it was asked at all. */
  montonioStatus?: string;
  /**
   * The result to settle with. Identical to the one passed in for `clear`;
   * for `confirmed` it is rebuilt from Montonio's own answer, because the
   * answer — not the token — is what the shop is now acting on. That also
   * feeds the short-payment check in apply.ts from Montonio's `grandTotal`,
   * which is the figure its own help centre warns can be lowered by an order
   * reuse.
   */
  result: VerifyResult;
}

/** The provider reference the order already carries — `orders.payment.ref`. */
function storedRef(order: GuardedOrder): string {
  const p = order.payment;
  if (typeof p !== "object" || p === null) return "";
  const ref = (p as { ref?: unknown }).ref;
  return typeof ref === "string" ? ref.trim() : "";
}

const PAID_STATUSES = new Set(["paid", "shipped", "delivered", "refunded"]);

/**
 * Run the two checks and, if either fails, ask Montonio.
 *
 * Both money routes call this between «the token verified» and «settle it»:
 * src/app/api/payments/notify/ and src/app/api/payments/return/. A provider
 * that reports no `tokenChecks` (the mock bank) and an order that carries no
 * stored reference yet are both `clear` — there is nothing to compare.
 */
export async function guardTokenChecks(
  order: GuardedOrder,
  result: VerifyResult,
  provider: PaymentProvider,
): Promise<GuardOutcome> {
  const checks = result.tokenChecks;
  /* `tokenChecks` is how a provider says «my token carries the claims that
     guide validates». Montonio's always does, so both checks below always run
     for it. The mock bank's ticket has neither an access key nor a Montonio
     uuid — its `providerRef` is the order number — so there is nothing to
     compare and nothing to ask anybody about. A provider added later must set
     this field, or it opts itself out of both checks. */
  if (!checks) return { verdict: "clear", mismatches: [], result };

  const stored = storedRef(order);
  const told = String(result.providerRef ?? "").trim();

  const mismatches: string[] = [];
  /* «Only when present» is gone: a token with no accessKey claim is now as
     much of a mismatch as one naming somebody else. What changes between the
     two is only how loud the log is — both ask Montonio. */
  if (checks.accessKey !== "ok") mismatches.push(`accessKey:${checks.accessKey}`);
  /* The check that was never made at all. Only meaningful when the order
     actually holds a reference: an order whose `POST /orders` answer was lost
     has nothing to disagree with, and inventing a disagreement there would
     refuse a real payment. */
  if (stored && told && stored !== told) mismatches.push("uuid");

  if (!mismatches.length) return { verdict: "clear", mismatches, result };

  const where = `${order.number} (${mismatches.join(", ")})`;

  /* A pending ticket moves nothing — applyPaymentResult() only records it — so
     there is no verdict to reach and no reason to spend a round trip on one.
     The mismatch is still worth a line in the log. */
  if (result.status === "pending") {
    console.error(`[payments] token checks failed on a pending ticket for ${where}`);
    return { verdict: "clear", mismatches, result };
  }

  const uuid = stored || told;
  const snapshot = canAskProvider(provider) && uuid ? await provider.fetchOrder(uuid) : null;

  if (!snapshot) {
    /* No answer. Not «no» — the shop simply does not know, and the one thing
       it must not do is decide. The caller asks for the webhook to be
       redelivered; Montonio retries for 48 hours, and the shopper's own return
       lands on «оплата проверяется» rather than on «не оплачено». */
    console.error(`[payments] token checks failed on ${where} and Montonio did not answer`);
    await journal(order, "unknown", mismatches, undefined);
    return { verdict: "unknown", mismatches, result };
  }

  const montonioStatus = snapshot.paymentStatus;
  const says = mapMontonioStatus(montonioStatus);
  if (says !== "paid") {
    console.error(`[payments] token checks failed on ${where}; Montonio says ${montonioStatus}`);
    await journal(order, "refused", mismatches, montonioStatus);
    return { verdict: "refused", mismatches, montonioStatus, result };
  }

  console.error(`[payments] token checks failed on ${where}; Montonio confirms ${montonioStatus}`);
  /* Not a repeat: an order already paid is one whose mismatch has been through
     here before (Montonio retries the same webhook 13 times), and Renat does
     not need thirteen identical rows in his journal for it. */
  if (!PAID_STATUSES.has(String(order.status ?? ""))) {
    await journal(order, "confirmed", mismatches, montonioStatus);
  }
  return {
    verdict: "confirmed",
    mismatches,
    montonioStatus,
    result: {
      ...result,
      status: "paid",
      providerRef: snapshot.uuid || told,
      amount: snapshot.grandTotal,
      currency: snapshot.currency || result.currency,
      detail: [result.detail, `Montonio: ${montonioStatus}`].filter(Boolean).join(" · "),
    },
  };
}

async function journal(
  order: GuardedOrder,
  verdict: GuardVerdict,
  mismatches: string[],
  montonioStatus: string | undefined,
): Promise<void> {
  await writeAuditSafe("system", "order.token_mismatch", {
    orderId: order.id,
    number: order.number,
    verdict,
    checks: mismatches,
    montonioStatus,
  });
}
