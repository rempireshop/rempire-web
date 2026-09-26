/**
 * What a refund did to an order's points — the two ledger lines by name.
 *
 * A refunded (or cancelled, when there is no money to send back) order writes
 * up to two `adjust` rows for itself (src/lib/loyalty.ts refundLoyaltyPoints,
 * db/migrations/214_loyalty_refund_lines.sql):
 *
 *   back    the points the order SPENT, on the balance again
 *   revoke  the points the order EARNED, taken off again
 *
 * and an undo back to «оплачен» writes the same two with the other sign —
 * `undo`, when read. Imports nothing, so both loyalty.ts (which writes them)
 * and customers.ts (which loyalty.ts imports, and which sums them per order
 * for «Мои заказы») can read one definition.
 */

export const POINTS_BACK_REF = "loyalty-back:";
export const POINTS_REVOKE_REF = "loyalty-revoke:";

export type PointsLine = "back" | "revoke" | "undo";

/**
 * The line an `adjust` row of an order stands for, or null for any other row
 * (earn, redeem, a manual correction with no order). A row written before
 * 26.09.2026 carried the net of both halves and no ref: its sign says which
 * half it mostly was.
 */
export function pointsLineOf(row: {
  reason: string;
  orderId: string | null;
  ref: string | null;
  delta: number;
}): PointsLine | null {
  if (row.reason !== "adjust" || !row.orderId) return null;
  const ref = row.ref ?? "";
  if (ref.startsWith(POINTS_BACK_REF)) return row.delta >= 0 ? "back" : "undo";
  if (ref.startsWith(POINTS_REVOKE_REF)) return row.delta <= 0 ? "revoke" : "undo";
  if (ref) return null; // somebody else's ref — not a refund line
  return row.delta >= 0 ? "back" : "revoke";
}

/** The SQL twin of pointsLineOf() for a sum per order: `back` and `revoke` as they stand now. */
export const POINTS_LINES_SQL = {
  back: `coalesce(sum(delta) filter (where ref like '${POINTS_BACK_REF}%' or (ref is null and delta > 0)), 0)`,
  revoked: `coalesce(-sum(delta) filter (where ref like '${POINTS_REVOKE_REF}%' or (ref is null and delta < 0)), 0)`,
} as const;
