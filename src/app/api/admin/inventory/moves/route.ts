/**
 * GET  /api/admin/inventory/moves/?productId=&reason=&since=&limit= — the ledger
 * POST /api/admin/inventory/moves/ — one stock change, always through here
 *
 * Two request shapes, both admin-only:
 *   { productId, variant?, delta, reason, ref? }  — a relative move: the
 *     scanner's «+1 приход» / «−1 продажа», goods-in, a return.
 *   { productId, variant?, qty, reason?, ref? }   — an absolute set: «останется
 *     N штук» after a physical count. reason defaults to 'adjust'.
 * `actor` is always "admin" here — the assistant's stock_adjust/stock_set
 * actions write "assistant" instead, straight through src/lib/inventory.ts.
 *
 * A RETRY AND A REAL REPEAT LOOK IDENTICAL HERE, and that is the whole reason
 * this route takes an `Idempotency-Key`. `delta` is relative: two «+1 приход»
 * in a row are two real bottles on the shelf and both must count, so nothing
 * in the request can tell a second bottle from a second tap for the first one.
 * Only the client knows — it minted one key for this movement and sends that
 * same key again when the answer did not come back (stockMoveSend() in
 * public/shop2/app.js).
 *
 * The `fingerprint` below is therefore a GUARD and never a dedupe: it only
 * asks whether the same KEY still carries the same body. Two different keys
 * with byte-identical bodies are two rows and both run — that is the
 * behaviour the shelf needs, and tests/idempotency-routes.test.ts pins it so
 * that nobody later "improves" this into a hash of the body.
 */
import { requireAdmin } from "@/lib/auth";
import { fingerprintOf, type IdempotentAnswer, readIdempotencyKey, runOnce } from "@/lib/idempotency";
import { InventoryError, LEDGER_REASONS, MOVE_REASONS, listMoves, move, setQty, shelfKey, type LedgerReason, type MoveReason } from "@/lib/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the key is stored against — see src/lib/idempotency.ts `mismatch`. */
const ROUTE = "POST /api/admin/inventory/moves";
const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const reasonRaw = url.searchParams.get("reason");
  /* Reading allows 'edit' — the card corrections setLevel() records — while
     writing below still only allows MOVE_REASONS: a change to a barcode or a
     threshold is not something a caller may post as a movement of goods. */
  const reason = reasonRaw && (LEDGER_REASONS as readonly string[]).includes(reasonRaw) ? (reasonRaw as LedgerReason) : undefined;

  try {
    const moves = await listMoves({
      productId: url.searchParams.get("productId") || undefined,
      reason,
      since: url.searchParams.get("since") || undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });
    return Response.json({ ok: true, moves }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/inventory/moves] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  /* The raw text rather than req.json(): fingerprintOf() wants the bytes the
     client actually sent, and two objects that differ only in key order hash
     differently once they have been through a parse and a re-serialise. */
  let raw: string;
  let body: Record<string, unknown>;
  try {
    raw = await req.text();
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  const productId = String(body.productId ?? body.product_id ?? "").trim();
  if (!productId) return Response.json({ ok: false, error: "bad_id" }, { status: 400 });
  /* THE SHELF ROW, NOT THE WORD THE CALLER HAPPENED TO SEND. A body with no
     size at all used to be written through as '' , which for the twenty-nine
     products sold in one named volume is a row that db/migrations/194 exists
     to have removed: it comes back the moment somebody counts into it, and
     «Склад» shows one bottle twice while every web sale of it, keyed to the
     label, is skipped as untracked. The panel's own «Остаток» and the scanner
     always send the label; the assistant's «приход 6 штук Touchable» cannot,
     because the model is never shown a rung for these. The read side has
     resolved this since 18.09.2026 and the write side had not — this is the
     same rule, on the same ladder (audit 18.09.2026, F9). A named size is
     passed through untouched, as before. */
  const variant = await shelfKey(productId, body.variant == null ? "" : String(body.variant));
  const ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim().slice(0, 200) : null;

  /* At most once per key — and a DIFFERENT key with this very same body is a
     different bottle, which runs. See the header. */
  const done = await runOnce({ key: readIdempotencyKey(req), route: ROUTE, fingerprint: fingerprintOf(raw) }, async (): Promise<IdempotentAnswer> => {
    try {
      if (body.qty !== undefined) {
        const reason =
          typeof body.reason === "string" && (MOVE_REASONS as readonly string[]).includes(body.reason)
            ? (body.reason as MoveReason)
            : "adjust";
        /* null / "" / true all coerce to a number the shelf would obey — Number(null)
           is 0 — so an emptied field used to wipe the count with «Сохранено ✓». */
        const qty = Number(body.qty);
        if (body.qty === null || body.qty === "" || typeof body.qty === "boolean" || !Number.isFinite(qty)) {
          return { status: 400, body: { ok: false, error: "bad_qty" } };
        }
        const result = await setQty(productId, variant, qty, { reason, ref, actor: "admin" });
        return { status: 200, body: { ok: true, result } };
      }

      if (body.delta === undefined) {
        return { status: 400, body: { ok: false, error: "bad_body" } };
      }
      if (typeof body.reason !== "string" || !(MOVE_REASONS as readonly string[]).includes(body.reason)) {
        return { status: 400, body: { ok: false, error: "bad_reason" } };
      }
      const delta = Number(body.delta);
      if (body.delta === null || body.delta === "" || typeof body.delta === "boolean" || !Number.isFinite(delta)) {
        return { status: 400, body: { ok: false, error: "bad_delta" } };
      }
      const result = await move({
        productId,
        variant,
        delta,
        reason: body.reason as MoveReason,
        ref,
        actor: "admin",
      });
      return { status: 200, body: { ok: true, result } };
    } catch (err) {
      /* Caught rather than thrown on: a refusal releases the key, so the
         corrected move goes through under a key of its own. */
      if (err instanceof InventoryError) {
        return { status: 400, body: { ok: false, error: err.code, detail: err.detail } };
      }
      console.error("[api/admin/inventory/moves] write failed:", err);
      return { status: 503, body: { ok: false, error: "db_unavailable" } };
    }
  });

  /* The same movement is being written right now by the tap before this one.
     Nothing ran here, and the panel says «подождите», not «не сохранилось». */
  if (done.outcome === "in_flight") {
    return Response.json({ ok: false, error: "in_progress" }, { status: 409, headers: NO_STORE });
  }
  /* This key already carried a different body. Refused rather than applied to
     the shelf under a key that was supposed to stop exactly that. */
  if (done.outcome === "mismatch") {
    return Response.json({ ok: false, error: "key_reused" }, { status: 409, headers: NO_STORE });
  }
  /* A REPLAY is not a movement, and the till has to be able to tell. The key
     is minted from the request body, so a second scan of the same bottle sends
     a byte-identical body under the same key and gets this answer back — the
     shelf did not move, and the screen used to say «Приход +1 ✓» all the same.
     Six identical bottles could be counted as five, cheerfully (audit F6). The
     shop cannot know which of the two it was, so it keeps under-counting — a
     shelf that overstates sells what is not there — and says so instead of
     claiming a movement. The stored body is untouched; the flag rides the
     response only. */
  const answer =
    done.outcome === "replayed" && done.status === 200 && done.body && typeof done.body === "object"
      ? { ...(done.body as Record<string, unknown>), replayed: true }
      : done.body;
  return Response.json(answer, { status: done.status, headers: NO_STORE });
}
