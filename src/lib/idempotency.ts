import { createHash } from "node:crypto";
import { jsonbParam, query } from "@/lib/db";

/**
 * «Сделать один раз» — server-side idempotency for the mutating POSTs.
 *
 * Storage: db/migrations/180_idempotency.sql, which carries the reasoning for
 * the table's shape. The short version: a POST that CREATES something has no
 * memory of having run, so when the answer is lost on the way back — a phone
 * that changes cell, an edge 502, a person tapping «Оформить заказ» again
 * because nothing has happened yet — the retry creates a second order, a
 * second POS sale, a second «+1 приход», a second article.
 *
 * INBOUND, and that is the difference from the two things in this codebase
 * with similar names. `mail.ts` idempotencyKey and `payments/refund.ts`
 * refundIdempotencyKey are keys the shop SENDS to Resend and to Montonio so
 * that THEY can recognise a retry. This module is the other direction: the key
 * a client sends to the shop, and the shop's own memory of having answered it.
 *
 * What a route does with it:
 *
 *   const key = readIdempotencyKey(req);
 *   const res = await runOnce(
 *     { key, route: "POST /api/orders", fingerprint: fingerprintOf(rawBody) },
 *     async () => {
 *       const order = await createOrder(input);
 *       return { status: 201, body: { ok: true, order } };
 *     },
 *   );
 *   if (res.outcome === "in_flight") {
 *     return Response.json({ ok: false, error: "in_progress" }, { status: 409 });
 *   }
 *   if (res.outcome === "mismatch") {
 *     return Response.json({ ok: false, error: "key_reused" }, { status: 409 });
 *   }
 *   return Response.json(res.body, { status: res.status });
 *
 * Three outcomes plus a refusal:
 *
 *   ran        the work ran here, now. Also what an unkeyed call gets — a
 *              request with no usable key is run exactly as it is today, so a
 *              route can be wired before its client learns to send one.
 *   replayed   this key finished earlier; `status` and `body` are the ones
 *              that were sent the first time, byte for byte, because the
 *              client is going to treat them as the real answer.
 *   in_flight  the same key is running right now, somewhere else. Nothing was
 *              run and there is nothing to answer with yet — the route says
 *              409 and the client asks again in a moment.
 *   mismatch   this key belongs to a different route, or to a different body.
 *              Refused rather than answered: see runOnce() below.
 *
 * Only a SUCCESSFUL answer is remembered. A 4xx/5xx and a thrown error both
 * release the key, so a shopper whose address was refused can fix it and send
 * the corrected order under the same key instead of being handed the old
 * complaint for two days. There is no second order to protect against when the
 * first one was never created.
 */

/* ---------- the key ------------------------------------------------------- */

/** The request header the client puts it in. Stripe's spelling, and Resend's. */
export const IDEMPOTENCY_HEADER = "idempotency-key";

/** Matches the length check on idempotency_keys.key (180_idempotency.sql). */
export const KEY_MIN = 8;
export const KEY_MAX = 200;

/* A uuid, or anything of that shape. Deliberately narrow: this value is a
   header, i.e. whatever the caller felt like sending, and it ends up in a
   primary key and in log lines. */
const KEY_RE = /^[A-Za-z0-9._:-]+$/;

export function isValidIdempotencyKey(key: unknown): boolean {
  const k = typeof key === "string" ? key.trim() : "";
  return k.length >= KEY_MIN && k.length <= KEY_MAX && KEY_RE.test(k);
}

/**
 * The key off a request, or "" when there is none the shop can use.
 *
 * A malformed key reads as absent rather than as an error: the protection
 * quietly does not apply, which is exactly today's behaviour, and a client
 * typo must not be a checkout that refuses to work. A route that would rather
 * refuse can ask isValidIdempotencyKey() itself.
 */
export function readIdempotencyKey(req: Request): string {
  const raw = (req.headers.get(IDEMPOTENCY_HEADER) ?? "").trim();
  return isValidIdempotencyKey(raw) ? raw : "";
}

/**
 * sha-256 of the request body, hex — the fingerprint runOnce() compares.
 *
 * A GUARD, never a dedupe, and the difference is the warehouse: two identical
 * «+1 приход» bodies are two real bottles and both must count. Different keys
 * are always different rows whatever the bodies say. This only asks the
 * opposite question — does the SAME key still carry the same body — which
 * catches a client that lost track of itself and makes a guessed key useless.
 *
 * Give it the raw text if the route has it (`await req.text()`); an object is
 * serialised, and two objects that differ only in key order hash differently,
 * which is why the raw text is the better argument where it exists.
 */
export function fingerprintOf(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/* ---------- the lease, the retention ------------------------------------- */

/**
 * How long a 'running' row is believed. Longer than the longest budget any
 * route in this shop asks for (`maxDuration = 60`), so a slow-but-alive
 * request is never stolen from; short enough that a key wedged by a killed
 * function clears while the person is still on the page.
 */
export const LEASE_MS = 90_000;

/** A retry that arrives a day after the tap is not a retry of anything. */
export const RETENTION_HOURS = 48;

/**
 * How often a finished call also sweeps. Not the 1-in-2000 the analytics
 * beacon uses (src/lib/events.ts): this shop takes a handful of orders a day,
 * not a thousand page views an hour, and one in two thousand would fire about
 * once a year — on a table whose rows are rubbish after two days.
 */
export const SWEEP_ODDS = 1 / 20;

/**
 * The most a remembered answer may weigh. An answer this module stores is an
 * order number or a stock level, never a listing; something far bigger is a
 * route that should not have been wired here, and it is better to say so and
 * leave the key unprotected than to park a megabyte for two days.
 */
const MAX_RESPONSE_BYTES = 100_000;

export async function deleteOldIdempotencyKeys(hours = RETENTION_HOURS): Promise<number> {
  const rows = await query<{ key: string }>(
    "delete from idempotency_keys where started_at < now() - make_interval(hours => $1) returning key",
    [Math.max(1, Math.trunc(hours) || RETENTION_HOURS)],
  );
  return rows.length;
}

/**
 * Retention with no schedule to wire up — the same belt-and-suspenders shape
 * as src/lib/events.ts maybeSweepOldEvents(), called from runOnce() itself.
 * Errors are swallowed: a maintenance sweep must never fail somebody's order.
 */
export async function sweepIdempotencyKeys(
  hours = RETENTION_HOURS,
  odds = SWEEP_ODDS,
): Promise<void> {
  if (Math.random() >= odds) return;
  try {
    await deleteOldIdempotencyKeys(hours);
  } catch (err) {
    console.error("[idempotency] retention sweep failed:", err);
  }
}

/* ---------- running it once ----------------------------------------------- */

/** What the work hands back: the status and the body the route will answer. */
export interface IdempotentAnswer<T = unknown> {
  status: number;
  body: T;
}

export type IdempotentResult<T = unknown> =
  | { outcome: "ran"; status: number; body: T }
  | { outcome: "replayed"; status: number; body: T }
  | { outcome: "in_flight" }
  | { outcome: "mismatch" };

export interface RunOnceOptions {
  /** From readIdempotencyKey(). "" runs the work unprotected. */
  key: string;
  /** Which route is claiming it, e.g. "POST /api/orders". Stored, never looked up by. */
  route: string;
  /** fingerprintOf(rawBody), when the route has a body worth guarding. */
  fingerprint?: string | null;
}

type KeyRow = {
  route: string;
  state: string;
  started_at: string | Date;
  status: number | string | null;
  response: unknown;
  fingerprint: string | null;
};

/**
 * Which ATTEMPT holds the key: `started_at` as text, handed back by whichever
 * statement won it and quoted by the two statements that end it.
 *
 * Without it, a request that ran past its lease and was taken over could still
 * stamp its answer onto the row of the attempt that replaced it — and then the
 * replacement's own answer would be the one silently dropped, so a later replay
 * would hand back a result from the wrong run. As text, not as a timestamp: a
 * JS Date is milliseconds and `now()` is microseconds, so a Date round-trip
 * would never compare equal to the row it came from.
 */
type Token = string;

/** The reservation. One statement, committed on its own — see below. */
async function claim(
  key: string,
  route: string,
  fingerprint: string | null,
): Promise<Token | null> {
  const rows = await query<{ token: Token }>(
    `insert into idempotency_keys (key, route, fingerprint) values ($1, $2, $3)
     on conflict (key) do nothing
     returning started_at::text as token`,
    [key, route, fingerprint],
  );
  return rows.length ? rows[0].token : null;
}

/** Takes over a 'running' row nobody is going to finish. Only one taker wins. */
async function takeOver(
  key: string,
  route: string,
  fingerprint: string | null,
): Promise<Token | null> {
  const rows = await query<{ token: Token }>(
    `update idempotency_keys
        set route = $2, fingerprint = $3, started_at = now(),
            state = 'running', status = null, response = null, finished_at = null
      where key = $1
        and state = 'running'
        and started_at < now() - make_interval(secs => $4)
      returning started_at::text as token`,
    [key, route, fingerprint, LEASE_MS / 1000],
  );
  return rows.length ? rows[0].token : null;
}

/**
 * The key is free again: the work failed, so there is nothing to remember.
 *
 * `token` is the one runOnce() was given when it won the key. Without one this
 * releases whatever is running under that key, which is what a route doing its
 * own bookkeeping wants and what the tests use.
 */
export async function releaseIdempotencyKey(key: string, token?: Token): Promise<void> {
  if (token) {
    await query(
      "delete from idempotency_keys where key = $1 and state = 'running' and started_at::text = $2",
      [key, token],
    );
    return;
  }
  await query("delete from idempotency_keys where key = $1 and state = 'running'", [key]);
}

async function finish(key: string, token: Token, status: number, body: unknown): Promise<void> {
  await query(
    `update idempotency_keys
        set state = 'done', status = $3, response = $4::jsonb, finished_at = now()
      where key = $1 and state = 'running' and started_at::text = $2`,
    [key, token, status, jsonbParam(body)],
  );
}

/**
 * Run `work` once for this key; hand back what it answered if it has run.
 *
 * The reservation goes in FIRST, on its own, before the work starts — not
 * inside whatever transaction the work opens. That is the whole design and the
 * migration argues it at length: a reservation held inside the work's
 * transaction would make the second tap BLOCK on the unique index for the
 * entire length of an order instead of being told, in one round trip, that its
 * twin is already running.
 *
 * A `mismatch` is refused rather than run, both ways round. A key that belongs
 * to another route would otherwise be answered with somebody else's result; a
 * key whose body has changed is a client that lost track of itself, and
 * running the work would be creating a second thing under a key that was
 * supposed to prevent exactly that.
 *
 * The loop is for the one honest race: between our insert and our read of the
 * winner's row, that winner can fail and release the key, leaving nothing to
 * read. Three attempts, then in_flight — the client asks again in a moment
 * either way.
 */
export async function runOnce<T = unknown>(
  opts: RunOnceOptions,
  work: () => Promise<IdempotentAnswer<T>>,
): Promise<IdempotentResult<T>> {
  const key = typeof opts.key === "string" ? opts.key.trim() : "";
  const route = typeof opts.route === "string" ? opts.route.trim().slice(0, 200) : "";
  const fingerprint = opts.fingerprint ? String(opts.fingerprint).slice(0, 128) : null;

  /* No key, or nothing this shop can store: run it exactly as today. */
  if (!isValidIdempotencyKey(key) || !route) {
    const answer = await work();
    return { outcome: "ran", status: Number(answer?.status) || 200, body: answer?.body as T };
  }

  let token: Token | null = null;
  for (let attempt = 0; attempt < 3 && !token; attempt++) {
    token = await claim(key, route, fingerprint);
    if (token) break;

    const rows = await query<KeyRow>(
      `select route, state, started_at, status, response, fingerprint
         from idempotency_keys where key = $1`,
      [key],
    );
    /* Gone between the insert and the read — the holder failed and released it. */
    if (!rows.length) continue;
    const row = rows[0];

    if (row.route !== route) return { outcome: "mismatch" };
    if (fingerprint && row.fingerprint && row.fingerprint !== fingerprint) {
      return { outcome: "mismatch" };
    }

    if (row.state === "done") {
      return {
        outcome: "replayed",
        status: Number(row.status) || 200,
        body: row.response as T,
      };
    }

    const startedAt = new Date(row.started_at as string).getTime();
    if (Number.isFinite(startedAt) && Date.now() - startedAt < LEASE_MS) {
      return { outcome: "in_flight" };
    }
    /* The lease is up: whoever started this is not coming back. One taker
       wins the update; a loser goes round and reads the winner's row. */
    token = await takeOver(key, route, fingerprint);
  }

  if (!token) return { outcome: "in_flight" };

  let answer: IdempotentAnswer<T>;
  try {
    answer = await work();
  } catch (err) {
    await releaseIdempotencyKey(key, token).catch(() => {
      /* The key ages out on its own in RETENTION_HOURS; the caller's error
         matters more than tidying up after it. */
    });
    throw err;
  }

  const status = Number(answer?.status) || 200;
  const body = answer?.body as T;

  /* Only a successful answer is worth remembering — see the header. */
  if (status >= 400) {
    await releaseIdempotencyKey(key, token).catch((err) => {
      console.error("[idempotency] could not release a failed key:", err);
    });
    return { outcome: "ran", status, body };
  }

  const serialised = jsonbParam(body);
  if (serialised.length > MAX_RESPONSE_BYTES) {
    console.warn(
      `[idempotency] ${route}: a ${serialised.length}-byte answer is too big to remember; ` +
        "the key is released and a retry will run the work again.",
    );
    await releaseIdempotencyKey(key, token).catch(() => {});
    return { outcome: "ran", status, body };
  }

  try {
    await finish(key, token, status, body);
  } catch (err) {
    /* The work is done and the person must be told so. A key that could not be
       closed is left running and expires with its lease, which costs one extra
       run of the work on a retry — the failure this module exists to prevent,
       but only in the case where the database refused to record it. */
    console.error("[idempotency] could not record the answer:", err);
    return { outcome: "ran", status, body };
  }

  await sweepIdempotencyKeys();
  return { outcome: "ran", status, body };
}
