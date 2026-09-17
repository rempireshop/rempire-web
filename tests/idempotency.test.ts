/**
 * «Сделать один раз» — src/lib/idempotency.ts and
 * db/migrations/180_idempotency.sql. Runs on PGlite, no server needed.
 *
 * What this covers:
 *   - the first call runs the work and answers with its own result
 *   - the same key again does NOT run the work and gives back the ORIGINAL
 *     status and body, because the client treats a replay as the real answer
 *   - a different key runs the work again
 *   - a second call while the first is still in flight runs nothing and says
 *     so — the two taps two seconds apart that this whole thing exists for
 *   - two DIFFERENT keys with IDENTICAL bodies both run. This is the warehouse
 *     case (audit finding 3): two «+1 приход» in a row are two real bottles,
 *     and any dedupe that looked at the body instead of the key would lose one
 *   - the same key with a different body, or on a different route, is refused
 *     rather than answered with somebody else's result
 *   - a failed call leaves nothing behind, so the corrected retry works
 *   - a key wedged by a killed function is taken over once its lease is up
 *   - rows older than the retention window are swept
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import {
  deleteOldIdempotencyKeys,
  fingerprintOf,
  IDEMPOTENCY_HEADER,
  isValidIdempotencyKey,
  KEY_MAX,
  LEASE_MS,
  readIdempotencyKey,
  releaseIdempotencyKey,
  runOnce,
  type IdempotentAnswer,
} from "@/lib/idempotency";
import { setupDb, teardownDb } from "./helpers";

const ROUTE = "POST /api/admin/inventory/moves";

/* Keys are uuid-shaped, like the ones a client mints. */
const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

/** A counted piece of work: the test asks how many times it actually ran. */
function counter(answer: IdempotentAnswer = { status: 201, body: { ok: true, n: 1 } }) {
  const calls = { count: 0 };
  const work = async (): Promise<IdempotentAnswer> => {
    calls.count += 1;
    return answer;
  };
  return { calls, work };
}

/** A promise the test resolves by hand — one call held mid-flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function rowFor(key: string) {
  const rows = await query<{ key: string; route: string; state: string; status: number | null }>(
    "select key, route, state, status from idempotency_keys where key = $1",
    [key],
  );
  return rows[0] ?? null;
}

beforeAll(async () => {
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  await query("delete from idempotency_keys");
});

describe("the key itself", () => {
  it("takes a uuid and refuses what could collide or bloat", () => {
    expect(isValidIdempotencyKey(KEY_A)).toBe(true);
    expect(isValidIdempotencyKey("order:2026-0001:1")).toBe(true);
    expect(isValidIdempotencyKey("1")).toBe(false); // a client bug, not a key
    expect(isValidIdempotencyKey("x".repeat(KEY_MAX + 1))).toBe(false);
    expect(isValidIdempotencyKey("has a space")).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
  });

  it("reads the header, and a malformed one reads as absent", () => {
    const withKey = new Request("https://rempire.ee/api/orders/", {
      headers: { [IDEMPOTENCY_HEADER]: ` ${KEY_A} ` },
    });
    expect(readIdempotencyKey(withKey)).toBe(KEY_A);
    const bad = new Request("https://rempire.ee/api/orders/", {
      headers: { [IDEMPOTENCY_HEADER]: "1" },
    });
    expect(readIdempotencyKey(bad)).toBe("");
    expect(readIdempotencyKey(new Request("https://rempire.ee/api/orders/"))).toBe("");
  });
});

describe("runOnce", () => {
  it("runs the work the first time and answers with its result", async () => {
    const { calls, work } = counter({ status: 201, body: { ok: true, move: "m1" } });
    const res = await runOnce({ key: KEY_A, route: ROUTE }, work);

    expect(calls.count).toBe(1);
    expect(res.outcome).toBe("ran");
    expect(res).toMatchObject({ status: 201, body: { ok: true, move: "m1" } });

    const row = await rowFor(KEY_A);
    expect(row).toMatchObject({ route: ROUTE, state: "done", status: 201 });
  });

  it("does not run the work again, and replays the original status and body", async () => {
    const { calls, work } = counter({ status: 201, body: { ok: true, move: "m1" } });
    await runOnce({ key: KEY_A, route: ROUTE }, work);

    /* The retry is a different piece of work on purpose: if the helper ran it,
       the answer below would be the 500, and the assertion would say so. */
    const second = await runOnce({ key: KEY_A, route: ROUTE }, async () => {
      calls.count += 1;
      return { status: 500, body: { ok: false, error: "should never run" } };
    });

    expect(calls.count).toBe(1);
    expect(second.outcome).toBe("replayed");
    expect(second).toMatchObject({ status: 201, body: { ok: true, move: "m1" } });
  });

  it("runs the work again under a different key", async () => {
    const { calls, work } = counter();
    const first = await runOnce({ key: KEY_A, route: ROUTE }, work);
    const second = await runOnce({ key: KEY_B, route: ROUTE }, work);

    expect(calls.count).toBe(2);
    expect(first.outcome).toBe("ran");
    expect(second.outcome).toBe("ran");
  });

  it("runs the work unprotected when there is no usable key", async () => {
    const { calls, work } = counter();
    await runOnce({ key: "", route: ROUTE }, work);
    await runOnce({ key: "", route: ROUTE }, work);

    expect(calls.count).toBe(2);
    const rows = await query("select key from idempotency_keys");
    expect(rows).toHaveLength(0);
  });
});

describe("two taps, two seconds apart", () => {
  it("tells the second call the first is still running, and runs nothing", async () => {
    const gate = deferred<void>();
    const started = deferred<void>();
    const calls = { count: 0 };

    const first = runOnce({ key: KEY_A, route: ROUTE }, async () => {
      calls.count += 1;
      started.resolve();
      await gate.promise;
      return { status: 201, body: { ok: true, order: "R-2026-0001" } };
    });

    /* The reservation is committed and the work is suspended inside it — the
       exact moment the shopper taps again. */
    await started.promise;

    const second = await runOnce({ key: KEY_A, route: ROUTE }, async () => {
      calls.count += 1;
      return { status: 201, body: { ok: true, order: "R-2026-0002" } };
    });

    expect(second).toEqual({ outcome: "in_flight" });
    expect(calls.count).toBe(1);

    gate.resolve();
    const done = await first;
    expect(done).toMatchObject({ outcome: "ran", status: 201 });

    /* And once it has landed, the same tap gets the first order back. */
    const third = await runOnce({ key: KEY_A, route: ROUTE }, async () => ({
      status: 500,
      body: { ok: false },
    }));
    expect(third).toMatchObject({
      outcome: "replayed",
      status: 201,
      body: { ok: true, order: "R-2026-0001" },
    });
    expect(calls.count).toBe(1);
  });
});

describe("«+1 приход» twice is two bottles", () => {
  it("runs both when the keys differ and the bodies are identical", async () => {
    /* The body a content-based dedupe would have collapsed. */
    const move = { productId: "davines-oi-shampoo", variant: "280 ml", delta: 1, reason: "приход" };
    const print = fingerprintOf(move);
    const calls = { count: 0 };
    const work = async (): Promise<IdempotentAnswer> => {
      calls.count += 1;
      return { status: 201, body: { ok: true, qty: calls.count } };
    };

    const first = await runOnce({ key: KEY_A, route: ROUTE, fingerprint: print }, work);
    const second = await runOnce({ key: KEY_B, route: ROUTE, fingerprint: print }, work);

    expect(calls.count).toBe(2);
    expect(first).toMatchObject({ outcome: "ran", body: { qty: 1 } });
    expect(second).toMatchObject({ outcome: "ran", body: { qty: 2 } });

    /* …and the SAME key twice is one bottle, same body and all. */
    const again = await runOnce({ key: KEY_A, route: ROUTE, fingerprint: print }, work);
    expect(again).toMatchObject({ outcome: "replayed", body: { qty: 1 } });
    expect(calls.count).toBe(2);
  });
});

describe("a key that belongs to something else", () => {
  it("refuses a key whose body has changed rather than running it", async () => {
    const { calls, work } = counter();
    await runOnce({ key: KEY_A, route: ROUTE, fingerprint: fingerprintOf({ delta: 1 }) }, work);

    const other = await runOnce(
      { key: KEY_A, route: ROUTE, fingerprint: fingerprintOf({ delta: 99 }) },
      work,
    );

    expect(other).toEqual({ outcome: "mismatch" });
    expect(calls.count).toBe(1);
  });

  it("refuses a key that arrives at a different route", async () => {
    const { calls, work } = counter();
    await runOnce({ key: KEY_A, route: ROUTE }, work);

    const elsewhere = await runOnce({ key: KEY_A, route: "POST /api/orders" }, work);

    expect(elsewhere).toEqual({ outcome: "mismatch" });
    expect(calls.count).toBe(1);
  });
});

describe("a call that failed", () => {
  it("leaves nothing behind when the work threw, so the retry runs", async () => {
    const calls = { count: 0 };
    await expect(
      runOnce({ key: KEY_A, route: ROUTE }, async () => {
        calls.count += 1;
        throw new Error("montonio is down");
      }),
    ).rejects.toThrow("montonio is down");

    expect(await rowFor(KEY_A)).toBeNull();

    const retry = await runOnce({ key: KEY_A, route: ROUTE }, async () => {
      calls.count += 1;
      return { status: 201, body: { ok: true } };
    });
    expect(retry.outcome).toBe("ran");
    expect(calls.count).toBe(2);
  });

  it("does not pin a refusal: the corrected order goes through on the same key", async () => {
    const first = await runOnce({ key: KEY_A, route: "POST /api/orders" }, async () => ({
      status: 400,
      body: { ok: false, error: "bad_address" },
    }));
    expect(first).toMatchObject({ outcome: "ran", status: 400 });
    expect(await rowFor(KEY_A)).toBeNull();

    const fixed = await runOnce({ key: KEY_A, route: "POST /api/orders" }, async () => ({
      status: 201,
      body: { ok: true, order: "R-2026-0007" },
    }));
    expect(fixed).toMatchObject({ outcome: "ran", status: 201 });
  });
});

describe("a key nobody is going to finish", () => {
  it("is taken over once its lease is up", async () => {
    await query("insert into idempotency_keys (key, route) values ($1, $2)", [KEY_A, ROUTE]);
    await query(
      "update idempotency_keys set started_at = now() - make_interval(secs => $2) where key = $1",
      [KEY_A, LEASE_MS / 1000 + 30],
    );

    const { calls, work } = counter({ status: 201, body: { ok: true, order: "R-2026-0009" } });
    const res = await runOnce({ key: KEY_A, route: ROUTE }, work);

    expect(calls.count).toBe(1);
    expect(res).toMatchObject({ outcome: "ran", status: 201 });
    expect(await rowFor(KEY_A)).toMatchObject({ state: "done", status: 201 });
  });

  it("is still believed while the lease is running", async () => {
    await query("insert into idempotency_keys (key, route) values ($1, $2)", [KEY_A, ROUTE]);
    const { calls, work } = counter();

    expect(await runOnce({ key: KEY_A, route: ROUTE }, work)).toEqual({ outcome: "in_flight" });
    expect(calls.count).toBe(0);
  });

  it("a call that was taken over cannot stamp its answer on the row that replaced it", async () => {
    const slowGate = deferred<void>();
    const slowStarted = deferred<void>();
    const takerGate = deferred<void>();
    const takerStarted = deferred<void>();

    /* The pathological case the lease exists for: a call that outlives it. */
    const slow = runOnce({ key: KEY_A, route: ROUTE }, async () => {
      slowStarted.resolve();
      await slowGate.promise;
      return { status: 201, body: { ok: true, order: "the one that was too slow" } };
    });
    await slowStarted.promise;
    await query(
      "update idempotency_keys set started_at = now() - make_interval(secs => $2) where key = $1",
      [KEY_A, LEASE_MS / 1000 + 30],
    );

    /* The taker is still running when the slow one lands — which is the whole
       point: both finish against a row that is 'running', and only the one
       that owns this attempt may write to it. */
    const taker = runOnce({ key: KEY_A, route: ROUTE }, async () => {
      takerStarted.resolve();
      await takerGate.promise;
      return { status: 201, body: { ok: true, order: "the one that took over" } };
    });
    await takerStarted.promise;

    slowGate.resolve();
    expect(await slow).toMatchObject({
      outcome: "ran",
      body: { order: "the one that was too slow" },
    });
    /* It told its own caller, and wrote nothing: the row is still the taker's. */
    expect(await rowFor(KEY_A)).toMatchObject({ state: "running", status: null });

    takerGate.resolve();
    await taker;

    const replay = await runOnce({ key: KEY_A, route: ROUTE }, async () => ({
      status: 500,
      body: { ok: false },
    }));
    expect(replay).toMatchObject({
      outcome: "replayed",
      status: 201,
      body: { ok: true, order: "the one that took over" },
    });
  });

  it("releaseIdempotencyKey frees a running row and leaves a finished one alone", async () => {
    await query("insert into idempotency_keys (key, route) values ($1, $2)", [KEY_A, ROUTE]);
    await releaseIdempotencyKey(KEY_A);
    expect(await rowFor(KEY_A)).toBeNull();

    const { work } = counter();
    await runOnce({ key: KEY_B, route: ROUTE }, work);
    await releaseIdempotencyKey(KEY_B);
    expect(await rowFor(KEY_B)).toMatchObject({ state: "done" });
  });
});

describe("retention", () => {
  it("sweeps what is older than the window and keeps the rest", async () => {
    const { work } = counter();
    await runOnce({ key: KEY_A, route: ROUTE }, work);
    await runOnce({ key: KEY_B, route: ROUTE }, work);
    await query("update idempotency_keys set started_at = now() - interval '3 days' where key = $1", [
      KEY_A,
    ]);

    const deleted = await deleteOldIdempotencyKeys(48);

    expect(deleted).toBe(1);
    expect(await rowFor(KEY_A)).toBeNull();
    expect(await rowFor(KEY_B)).not.toBeNull();
  });
});

describe("the table's own rules", () => {
  it("refuses a finished row that cannot answer", async () => {
    await query("insert into idempotency_keys (key, route) values ($1, $2)", [KEY_A, ROUTE]);
    await expect(
      query("update idempotency_keys set state = 'done' where key = $1", [KEY_A]),
    ).rejects.toThrow();
  });

  it("refuses a key short enough to collide by accident", async () => {
    await expect(
      query("insert into idempotency_keys (key, route) values ($1, $2)", ["1", ROUTE]),
    ).rejects.toThrow();
  });
});
