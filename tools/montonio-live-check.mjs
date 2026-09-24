/**
 * What the LIVE Montonio account can actually do — asked before a customer
 * can pay, with GET requests only. No order, no shipment, no refund, no money.
 *
 *   1. Put the live pair in `.env.montonio-live` in this folder (`.env*` is
 *      gitignored, so it cannot be committed):
 *        MONTONIO_ACCESS_KEY=…
 *        MONTONIO_SECRET_KEY=…
 *        MONTONIO_ENV=live
 *   2. node --env-file=.env.montonio-live tools/montonio-live-check.mjs
 *   3. Delete the file. The keys belong in Vercel and a password manager.
 *
 * It answers four questions the sandbox cannot (docs/montonio-untested.md):
 *
 *   · Do the keys open the live store at all (401 / 403 say which half is wrong)?
 *   · Which payment methods are on, and which banks per country — after the
 *     same EUR-only filter the checkout applies (src/lib/payments/methods.ts)?
 *   · Can the account book every carrier the checkout offers, per country and
 *     per delivery type? The offer is read straight out of public/shop2/app.js
 *     (CARRIERS_BY_COUNTRY for lockers, COURIER_CARRIERS for the door), so this
 *     compares what a shopper can pick with what Montonio will register. A
 *     locker card without points drops out of the checkout by itself; a
 *     courier card does not — it fails at «Создать этикетку».
 *   · Is the parcel-events webhook registered, at which address, with which
 *     events?
 *
 * Prices are a separate, equally read-only run with the same file:
 *   node --env-file=.env.montonio-live tools/fetch-montonio-tariffs.mjs --dry
 *
 * Exit code 1 when something the shop relies on is missing, 0 otherwise. The
 * access key is masked in everything printed.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WEBHOOK = "https://rempireshop.diipsolutions.eu/api/shipping/notify/";
/** src/lib/shipping/montonio.ts REQUIRED_SHIPMENT_EVENTS — the three the shop cannot do without.
    `shipment.labelsCreated` (tools/montonio-webhook.mjs EVENTS) is wanted but not required. */
const WANTED_EVENTS = ["shipment.registered", "shipment.registrationFailed", "shipment.statusUpdated"];

/* ---------- the checkout's own offer, read out of app.js ------------------ */

/** Same reader as tests/checkout-country.test.ts: balance the braces, evaluate the literal. */
export function appLiteral(src, name) {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if ((src[i] === "}" || src[i] === "]") && --depth === 0) {
      return new Function(`return ${src.slice(open, i + 1)};`)();
    }
  }
  throw new Error(`unbalanced literal for ${name}`);
}

/** { parcel: { EE: ["dpd", …] }, courier: { … } } — «EU» is a zone, not a country. */
export function shopOffer(src) {
  const drop = (o) => Object.fromEntries(Object.entries(o).filter(([cc, list]) => cc !== "EU" && list.length));
  return {
    parcel: drop(appLiteral(src, "CARRIERS_BY_COUNTRY")),
    courier: drop(appLiteral(src, "COURIER_CARRIERS")),
  };
}

/* ---------- comparisons, pure so a test can feed them --------------------- */

const lc = (v) => String(v ?? "").trim().toLowerCase();
const uc = (v) => String(v ?? "").trim().toUpperCase();

/**
 * `GET /shipping-methods` → { parcel: {EE: Set}, courier: {EE: Set} }.
 * Montonio's `novaPost` becomes the shop's `novapost`, like every other code.
 */
export function accountRoutes(body) {
  const out = { parcel: {}, courier: {} };
  for (const row of body?.countries ?? []) {
    const cc = uc(row?.countryCode);
    for (const c of row?.carriers ?? []) {
      for (const m of c?.shippingMethods ?? []) {
        const kind = m?.type === "pickupPoint" ? "parcel" : m?.type === "courier" ? "courier" : null;
        if (!kind || !cc) continue;
        (out[kind][cc] ??= new Set()).add(lc(c?.carrierCode));
      }
    }
  }
  return out;
}

/** What the shop offers and the account cannot book — and the reverse, for information. */
export function compareRoutes(offer, account) {
  const missing = [];
  const unused = [];
  for (const kind of ["parcel", "courier"]) {
    for (const [cc, carriers] of Object.entries(offer[kind])) {
      for (const c of carriers) if (!account[kind][cc]?.has(c)) missing.push(`${kind} ${cc} ${c}`);
    }
    for (const [cc, set] of Object.entries(account[kind])) {
      for (const c of set) if (!(offer[kind][cc] ?? []).includes(c)) unused.push(`${kind} ${cc} ${c}`);
    }
  }
  return { missing: missing.sort(), unused: unused.sort() };
}

/** Takes EUR, or did not say — the rule mapBanks() applies since 23.09.2026. */
const takesEur = (v) => !Array.isArray(v) || !v.length || v.some((c) => uc(c) === "EUR");

/** `GET /stores/payment-methods` → enabled keys, EUR banks per country, and what the filter drops. */
export function paymentSummary(body) {
  const pm = body?.paymentMethods ?? {};
  const setup = pm.paymentInitiation?.setup ?? {};
  const banks = {};
  const dropped = [];
  for (const [country, group] of Object.entries(setup)) {
    const cc = uc(country);
    for (const b of group?.paymentMethods ?? []) {
      const code = String(b?.code ?? "").trim();
      if (!code) continue;
      if (!takesEur(group?.supportedCurrencies) || !takesEur(b?.supportedCurrencies)) {
        dropped.push(`${cc} ${code}`);
        continue;
      }
      (banks[cc] ??= []).push(code);
    }
  }
  return { enabled: Object.keys(pm).sort(), banks, dropped };
}

/** Which registered webhook is ours, and which of the wanted events it lacks. */
export function webhookSummary(body, expectedUrl) {
  const norm = (u) => String(u ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const rows = (body?.data ?? []).map((w) => ({
    url: String(w?.url ?? ""),
    events: Array.isArray(w?.enabledEvents) ? w.enabledEvents.map(String) : [],
  }));
  const mine = rows.filter((w) => norm(w.url) === norm(expectedUrl));
  const have = new Set(mine.flatMap((w) => w.events.map(lc)));
  return {
    urls: rows.map((w) => w.url),
    ours: mine.length > 0,
    slashMissing: mine.some((w) => !w.url.trim().endsWith("/")),
    missingEvents: mine.length ? WANTED_EVENTS.filter((e) => !have.has(lc(e))) : [...WANTED_EVENTS],
  };
}

/* ---------- the network half ----------------------------------------------- */

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** `Bearer` HS256 of `{ accessKey, exp }` — the GET recipe both Montonio APIs document. */
function bearer(accessKey, secretKey) {
  const enc = (o) => b64url(Buffer.from(JSON.stringify(o)));
  const input = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ accessKey, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${input}.${b64url(createHmac("sha256", secretKey).update(input).digest())}`;
}

function config() {
  const accessKey = process.env.MONTONIO_ACCESS_KEY?.trim();
  const secretKey = process.env.MONTONIO_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) return null;
  const live = process.env.MONTONIO_ENV?.trim() === "live";
  return {
    accessKey,
    secretKey,
    env: live ? "live" : "sandbox",
    payments: live ? "https://stargate.montonio.com/api" : "https://sandbox-stargate.montonio.com/api",
    shipping: live ? "https://shipping.montonio.com/api/v2" : "https://sandbox-shipping.montonio.com/api/v2",
  };
}

/** GET only. Never a throw: { ok, status, body } with a readable reason on failure. */
async function get(cfg, base, p) {
  try {
    const res = await fetch(`${base}${p}`, {
      headers: { accept: "application/json", authorization: `Bearer ${bearer(cfg.accessKey, cfg.secretKey)}` },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: null, body: { raw: String(err?.message ?? err) } };
  }
}

function why(r) {
  if (r.status === 401) return "401 — the access key does not open a store in this environment (sandbox key on live?)";
  if (r.status === 403) return "403 — the secret key does not belong to this access key";
  if (r.status === null) return `Montonio did not answer: ${r.body?.raw ?? ""}`;
  return `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`;
}

async function main() {
  const cfg = config();
  if (!cfg) {
    console.error("No MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY. Run:\n  node --env-file=.env.montonio-live tools/montonio-live-check.mjs");
    process.exit(2);
  }
  const mask = (s) => String(s).split(cfg.accessKey).join("***");
  const say = (...a) => console.log(mask(a.join(" ")));
  const problems = [];
  const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
  const webhookUrl = arg("--webhook") || DEFAULT_WEBHOOK;

  say(`Montonio ${cfg.env.toUpperCase()} — read-only check, ${new Date().toISOString()}`);
  if (cfg.env !== "live") say("  ! MONTONIO_ENV is not «live» — this is asking the SANDBOX");

  /* payments */
  say("\n1. Payments — GET /stores/payment-methods");
  const pay = await get(cfg, cfg.payments, "/stores/payment-methods");
  if (!pay.ok) {
    problems.push("payment methods unreadable");
    say("  ✗", why(pay));
  } else {
    const p = paymentSummary(pay.body);
    say("  enabled:", p.enabled.join(", ") || "(nothing — ask Montonio support)");
    for (const need of ["paymentInitiation", "cardPayments"]) {
      if (!p.enabled.includes(need)) {
        problems.push(`${need} off`);
        say(`  ✗ ${need} is not enabled`);
      }
    }
    for (const [cc, list] of Object.entries(p.banks).sort()) say(`  ${cc}: ${list.length} banks — ${list.join(", ")}`);
    if (p.dropped.length) say("  hidden by the EUR-only rule:", p.dropped.join(", "));
    say("  «Refundable bank payments» has no endpoint — read it in the Partner System (must say Completed).");
  }

  /* shipping */
  say("\n2. Carriers — GET /carriers");
  const car = await get(cfg, cfg.shipping, "/carriers");
  if (!car.ok) {
    problems.push("carriers unreadable");
    say("  ✗", why(car));
  } else {
    for (const c of car.body?.carriers ?? []) {
      const own = (c?.contracts ?? []).map((x) => uc(x?.country)).filter(Boolean);
      say(`  ${lc(c?.code).padEnd(12)} Montonio contract: ${c?.hasMontonioContract === true ? "yes" : "no"}${own.length ? `, own: ${own.join(" ")}` : ""}`);
    }
  }

  say("\n3. Routes — GET /shipping-methods against what the checkout offers");
  const methods = await get(cfg, cfg.shipping, "/shipping-methods");
  if (!methods.ok) {
    problems.push("shipping methods unreadable");
    say("  ✗", why(methods));
  } else {
    const offer = shopOffer(readFileSync(path.join(ROOT, "public", "shop2", "app.js"), "utf8"));
    const { missing, unused } = compareRoutes(offer, accountRoutes(methods.body));
    const offered = ["parcel", "courier"].reduce((n, k) => n + Object.values(offer[k]).flat().length, 0);
    if (missing.length) {
      problems.push(`${missing.length} offered routes not bookable`);
      say(`  ✗ the checkout offers ${missing.length} of its ${offered} routes that this account cannot book:`);
      for (const m of missing) say("     ", m);
    } else {
      say(`  ✓ all ${offered} routes the checkout offers are bookable`);
    }
    if (unused.length) say(`  (the account also has ${unused.length} routes the shop does not offer: ${unused.join("; ")})`);
  }

  say(`\n4. Parcel webhook — GET /webhooks, expected ${webhookUrl}`);
  const hooks = await get(cfg, cfg.shipping, "/webhooks");
  if (!hooks.ok) {
    problems.push("webhooks unreadable");
    say("  ✗", why(hooks));
  } else {
    const w = webhookSummary(hooks.body, webhookUrl);
    say("  registered:", w.urls.join(", ") || "(none)");
    if (!w.ours) {
      problems.push("webhook not registered");
      say("  ✗ not registered at the expected address — orders will never close by themselves");
    } else if (w.missingEvents.length) {
      problems.push("webhook events missing");
      say("  ✗ missing events:", w.missingEvents.join(", "));
    } else {
      say("  ✓ registered with every event the shop reads");
    }
    if (w.slashMissing) say("  ! no trailing slash — the POST becomes a 308 and is lost");
  }

  say(`\n${problems.length ? `✗ ${problems.length} to fix: ${problems.join("; ")}` : "✓ nothing missing"}`);
  say("Prices: node --env-file=.env.montonio-live tools/fetch-montonio-tariffs.mjs --dry");
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
