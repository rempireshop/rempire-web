/**
 * Customer letters held for ten seconds, so «Вернуть» can still stop them.
 *
 * Admin redesign 1a, rule 3 (design_handoff_admin_ux README § 1–2) and Dim's
 * answer of 25.09.2026 (q3): «Отправлен», «Отменить заказ», «Отправить счёт
 * ещё раз» and the owner's own letter from «Написать клиенту» change the order
 * AT ONCE — other devices, the lists and the counters see the new state the
 * moment the owner taps — but the letter to the customer leaves ten seconds
 * later, from the server, and only if nobody took the change back in between.
 * The toast's «Вернуть» (six seconds, ADM_UNDO_MS in app.js) therefore lands
 * inside the hold, and an undone step never reaches the customer's inbox.
 *
 * Why the server and not the browser (gap analysis F8, option A): a PATCH
 * that waits in the phone for ten seconds is lost when the phone locks or the
 * tab closes, and every other device would see the old state meanwhile. A
 * cron cannot do it either — the Hobby plan runs crons once a day. `after()`
 * (next/server) is the pattern already used by src/app/api/admin/ai/text: it
 * runs once the response has been sent and keeps the function alive until the
 * work lands (the routes that hold a letter declare `maxDuration = 60`).
 *
 * THE STATE lives on the order, not in memory: the undo is a second request
 * and may land on another function instance. `orders.shipping.letterHold` is a
 * map `{ <token>: { kind, at } }` — one entry per letter waiting. No migration:
 * the shipping jsonb already carries the order's fulfilment stamps
 * (deliveredAt, shippedAt, returnRequest), every writer of it merges in SQL
 * (`coalesce(shipping, '{}') || …`), and the customer's own «Мои заказы»
 * unpacks the two stamps it needs and never carries the rest.
 *
 *   hold     a token is written, and a task is scheduled for LETTER_HOLD_MS;
 *   undo     a status change voids every held status letter the new status
 *            no longer justifies (dropStatusLetters) — «Отправлен» taken back
 *            to «оплачен», a cancel taken back to what it was; a letter with
 *            no status of its own (the invoice, a reply) is dropped by its
 *            token (cancelLetter, PATCH { letterCancel });
 *   send     when the time is up the task CLAIMS its token — one atomic
 *            UPDATE that removes it and returns the order — and only a claim
 *            that came back sends. So an undo and the send can never both
 *            win, and an undo followed by a redo inside the ten seconds sends
 *            exactly one letter (the redo's): the first token was dropped by
 *            the undo, so its task finds nothing to claim.
 *
 * A letter whose status went FORWARD in the meantime still goes: «Отправлен»
 * and then «Доставлен» within ten seconds is a parcel that left, and the
 * customer is owed «Заказ отправлен» (LETTER_STATUSES).
 */
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { query } from "@/lib/db";
import { getOrder, mapOrder, type Order } from "@/lib/orders";

/** How long a customer letter waits before it leaves. */
export const LETTER_HOLD_MS = 10_000;

/** The letters that are held. «refunded» is not: a refund is money, it goes
    through its own confirm and is sent at once (Dim, q3). */
export type LetterKind = "shipped" | "cancelled" | "invoice" | "reply";

/** For a letter that follows a status: the statuses under which it still
    makes sense to send it. Anything else is an undo. */
export const LETTER_STATUSES: Partial<Record<LetterKind, readonly string[]>> = {
  shipped: ["shipped", "delivered"],
  cancelled: ["cancelled"],
};

/** What the routes answer with, so the panel's toast can say «письмо уйдёт
    через 10 с» and its «Вернуть» can name the letter. */
export type LetterHeld = { held: true; kind: LetterKind; token: string; ms: number };

/**
 * The clock the hold waits on. A field of an object rather than a bare
 * setTimeout so the tests can hand the hold a fake clock and step it by hand
 * (tests/letter-hold.test.ts) — the ten seconds are the behaviour under test,
 * and a suite that really waited them would be a suite nobody runs.
 */
export const letterClock = {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

type HoldRow = Parameters<typeof mapOrder>[0];

const TOKEN_RE = /^[0-9a-f-]{16,64}$/i;

/** Writes one waiting letter onto the order; returns its token. */
export async function holdLetter(orderId: string, kind: LetterKind): Promise<string> {
  const token = randomUUID();
  const rows = await query<{ id: string }>(
    `update orders
        set shipping = coalesce(shipping, '{}'::jsonb) || jsonb_build_object('letterHold',
              coalesce(shipping -> 'letterHold', '{}'::jsonb)
                || jsonb_build_object($2::text, jsonb_build_object('kind', $3::text, 'at', now())))
      where id = $1
      returning id`,
    [orderId, token, kind],
  );
  if (!rows.length) throw new Error("order_not_found");
  return token;
}

/**
 * Takes the letter: removes its token and returns the order as it is NOW —
 * or null when the token is gone (undone, cancelled, or already taken). One
 * statement, so two takers can never both get it.
 */
export async function claimLetter(orderId: string, token: string): Promise<Order | null> {
  const rows = await query<HoldRow>(
    `update orders
        set shipping = shipping #- array['letterHold', $2::text]
      where id = $1 and (shipping -> 'letterHold' -> $2::text) is not null
      returning *`,
    [orderId, token],
  );
  return rows.length ? mapOrder(rows[0]) : null;
}

/** «Вернуть» on a letter with no status of its own: true when it had not left yet. */
export async function cancelLetter(orderId: string, token: string): Promise<boolean> {
  if (!TOKEN_RE.test(token)) return false;
  return (await claimLetter(orderId, token)) != null;
}

/**
 * After a status change: every held status letter the new status no longer
 * justifies is dropped. The invoice and the reply are not status letters and
 * stay where they are.
 */
export async function dropStatusLetters(orderId: string, status: string): Promise<number> {
  const voided = Object.entries(LETTER_STATUSES)
    .filter(([, ok]) => !(ok ?? []).includes(status))
    .map(([kind]) => kind);
  if (!voided.length) return 0;
  const rows = await query<{ n: string | number }>(
    `with before as (
       select id, shipping -> 'letterHold' as held from orders
        where id = $1 and jsonb_typeof(shipping -> 'letterHold') = 'object'
     ), kept as (
       select b.id,
              coalesce((select jsonb_object_agg(e.key, e.value)
                          from jsonb_each(b.held) e
                         where coalesce(e.value ->> 'kind', '') <> all($2::text[])), '{}'::jsonb) as held,
              (select count(*) from jsonb_each(b.held) e
                where coalesce(e.value ->> 'kind', '') = any($2::text[])) as n
         from before b
     )
     update orders o
        set shipping = o.shipping || jsonb_build_object('letterHold', k.held)
       from kept k
      where o.id = k.id and k.n > 0
     returning k.n`,
    [orderId, voided],
  );
  return rows.length ? Number(rows[0].n) || 0 : 0;
}

/** The letters still waiting on an order, by kind — what the card can show. */
export function heldLetters(order: { shipping?: unknown } | null | undefined): Array<{ token: string; kind: string }> {
  const sh = order && order.shipping && typeof order.shipping === "object" ? (order.shipping as Record<string, unknown>) : null;
  const held = sh && sh.letterHold && typeof sh.letterHold === "object" ? (sh.letterHold as Record<string, { kind?: unknown }>) : null;
  if (!held) return [];
  return Object.keys(held).map((token) => ({ token, kind: String((held[token] && held[token].kind) || "") }));
}

/**
 * Schedules `task` for when the hold is up. Inside a request it rides
 * `after()`, which keeps the function alive until it has run. Outside one (a
 * unit test calling the route directly) `after()` throws, and the task runs
 * as a detached promise on the same clock instead — never inline, because the
 * route must answer now, not in ten seconds.
 */
export function afterHold(task: () => Promise<void>, ms = LETTER_HOLD_MS): void {
  const run = async (): Promise<void> => {
    await letterClock.sleep(ms);
    const p = (async () => {
      try {
        await task();
      } catch (err) {
        console.error("[letter-hold] a held letter failed:", err);
      }
    })();
    running.add(p);
    void p.finally(() => running.delete(p));
    await p;
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** The holds whose time is up and whose letter is being taken and sent. */
const running = new Set<Promise<void>>();
/** Resolves once every hold whose time is up has run to its end — what a test
    awaits after stepping its fake clock past the ten seconds. A hold still
    waiting is not waited for. */
export async function lettersSettled(): Promise<void> {
  do {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.all([...running]);
  } while (running.size);
}

/**
 * The whole hold in one call: write the token, and when the time is up claim
 * it and — if the order is still in a state that justifies this letter —
 * send it with the order as it is at that moment (a tracking code that
 * arrived in the meantime is in it).
 *
 * If the token cannot be written (the database hiccuped between the status
 * change and here) the letter goes at once, as it did before the hold existed
 * — a letter that is late to be stoppable is better than a letter that never
 * goes — and the answer says it was not held.
 */
export async function holdAndSend(
  orderId: string,
  kind: LetterKind,
  send: (order: Order) => Promise<unknown>,
): Promise<LetterHeld | { held: false }> {
  let token: string;
  try {
    token = await holdLetter(orderId, kind);
  } catch (err) {
    console.error(`[letter-hold] could not hold the «${kind}» letter, sending it now:`, err);
    const now = await getOrder(orderId);
    if (now) await send(now);
    return { held: false };
  }
  afterHold(async () => {
    const order = await claimLetter(orderId, token);
    if (!order) return;                                    // taken back in time
    const ok = LETTER_STATUSES[kind];
    if (ok && !ok.includes(order.status)) return;          // the status moved on to something else
    await send(order);
  });
  return { held: true, kind, token, ms: LETTER_HOLD_MS };
}
