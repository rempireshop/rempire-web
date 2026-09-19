#!/usr/bin/env node
/**
 * Makes one order that was paid for with too little money, so «Заказ, за
 * который заплатили не полностью» can be tested on the stand.
 *
 * Why a script exists for this at all. Montonio lets a customer re-open an old
 * payment link and pay a smaller amount than the order is worth — its own
 * documentation says so — and since Dim's decision of 18.09.2026 the shop
 * holds such an order instead of fulfilling it: nothing off the shelf, no gift
 * cards minted, no receipt, and a warning naming both sums. That is the one
 * scenario nobody can produce by hand: it needs Montonio to underpay, and the
 * sandbox will not. On 19.09.2026 the owner wrote against that check: «Cannot
 * test - please create me such order so I can test this.»
 *
 * So the state is written directly. The order is a COPY of a real one on the
 * same database — same items, same customer, same totals — with a new id and
 * number, put back to `new` and given the payment blob that a short payment
 * leaves behind (src/lib/payments/apply.ts, shortPayment / HeldPayment). The
 * copy is made with a temporary table, so this script never has to know the
 * columns of `orders` and cannot fall behind a migration that adds one.
 *
 *   DATABASE_URL=… node tools/seed-held-order.mjs --yes
 *   DATABASE_URL=… node tools/seed-held-order.mjs --yes --from R-100042 --paid 5
 *
 * `--from` is the order to copy (the most recent paid one by default) and
 * `--paid` how much "arrived" (half the total by default). It writes one row
 * and touches nothing else — no stock, no cards, no mail.
 */
import { randomUUID } from "node:crypto";
import { sslFor } from "./migrate.mjs";

function arg(name, fallback = null) {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function connect() {
  /* The same escape hatch every other tool here has: a PGlite file, so the
     copy can be exercised without a server. */
  if (process.env.DB_DRIVER === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(process.env.PGLITE_PATH || undefined);
    return { db, close: () => db.close() };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in .env.local — see docs/backend.md.");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  await client.connect();
  return { db: client, close: () => client.end() };
}

async function main() {
  /* This writes to whatever DATABASE_URL points at, and that may be the shop
     the customers use. It asks out loud, and it prints the host it is about to
     write to, because «which database was that terminal on» is a question
     nobody answers correctly at eleven at night. */
  if (!process.argv.includes("--yes")) {
    const host =
      process.env.DB_DRIVER === "pglite"
        ? `a PGlite file (${process.env.PGLITE_PATH || "in memory"})`
        : (process.env.DATABASE_URL || "").replace(/^[^@]*@/, "").split("/")[0] || "(unknown host)";
    console.error(`This writes a new order to ${host}. Re-run with --yes if that is the right database.`);
    process.exit(1);
  }

  const { db, close } = await connect();
  try {
    const from = arg("--from");
    const src = await db.query(
      from
        ? "select id, number, total, currency, payment from orders where number = $1"
        : `select id, number, total, currency, payment from orders
            where status in ('paid','shipped','delivered') order by created_at desc limit 1`,
      from ? [from] : [],
    );
    const row = src.rows[0];
    if (!row) {
      console.error(from ? `No order numbered ${from}.` : "No paid order to copy — place one first.");
      process.exit(1);
    }

    const total = Math.round(Number(row.total) * 100) / 100;
    const paid = Math.round(Number(arg("--paid", String(Math.max(0.05, total / 2)))) * 100) / 100;
    if (!(paid >= 0) || paid >= total) {
      console.error(`--paid must be less than the order's total (${total}).`);
      process.exit(1);
    }

    const id = randomUUID();
    const number = `R-H${String(Date.now()).slice(-6)}`;
    const at = new Date().toISOString();
    const currency = row.currency || "EUR";
    /* Exactly what applyPaymentResult() writes when Montonio's ticket says
       «paid» and the money is short: the provider reference is kept, because
       «Вернуть деньги» has to work on this order and the owner has to be able
       to find the payment in Montonio's own panel. */
    const payment = {
      ...(row.payment && typeof row.payment === "object" ? row.payment : {}),
      status: "pending",
      amount: paid,
      currency,
      at,
      held: {
        reason: "underpaid",
        expected: total,
        got: paid,
        shortfall: Math.round((total - paid) * 100) / 100,
        currency,
        paidCurrency: currency,
        at,
        providerStatus: "paid",
      },
    };

    await db.query("begin");
    await db.query("create temp table _seed_held on commit drop as select * from orders where id = $1", [row.id]);
    await db.query(
      `update _seed_held set id = $1, number = $2, status = 'new', payment = $3::jsonb,
                             created_at = now(), updated_at = now()`,
      [id, number, JSON.stringify(payment)],
    );
    await db.query("insert into orders select * from _seed_held");
    await db.query("commit");

    console.log(`Copied ${row.number} → ${number}: ${paid} ${currency} arrived, ${total} ${currency} owed.`);
    console.log("Open «Заказы» in the panel — it is the one with the «Заплатили меньше» warning.");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
