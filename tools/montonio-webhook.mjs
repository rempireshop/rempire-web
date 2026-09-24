/**
 * The parcel-events webhook at Montonio — list it, register it, remove it.
 *
 * Montonio's Partner System has NO screen for this: the shipping guide
 * (docs.montonio.com/api/shipping-v2/guides/webhooks, read 23.09.2026) knows
 * one way only, `POST /webhooks` with the store's own keys. Without it parcels
 * are delivered and orders never close by themselves, and nothing complains.
 * Montonio's advice: ONE webhook with every event you need (10 per store max).
 *
 *   node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs list
 *   node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs register https://rempireshop.diipsolutions.eu/api/shipping/notify/
 *   node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs delete <id>
 *
 * At the domain move: `register` the rempireshop.com address, then `delete`
 * the diipsolutions one. The trailing slash is required — `trailingSlash` is on
 * in next.config.ts and a POST without it becomes a 308 that Montonio does not
 * follow.
 *
 * The events: the four src/app/api/shipping/notify/ acts on. Montonio's full
 * enum (support, 24.09.2026) is six — these plus `labelFile.ready` and
 * `labelFile.creationFailed`, which are about a label PDF: the shop makes its
 * labels synchronously and the route only acknowledges them, so they are not
 * subscribed. `shipment.labelsCreated` joined on 24.09.2026 (it keeps the
 * stored status current); a webhook registered before that has three events
 * and must be registered again to get it — `register`, then `delete` the old
 * id that `list` shows (Montonio has no update call; for the minutes both
 * exist, an event arrives twice and the route is idempotent).
 */
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

export const EVENTS = [
  "shipment.registered",
  "shipment.registrationFailed",
  "shipment.statusUpdated",
  "shipment.labelsCreated",
];

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function bearer(accessKey, secretKey) {
  const enc = (o) => b64url(Buffer.from(JSON.stringify(o)));
  const input = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ accessKey, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${input}.${b64url(createHmac("sha256", secretKey).update(input).digest())}`;
}

/** An address Montonio can deliver to, and that this shop answers on. */
export function checkUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "not a URL";
  }
  if (u.protocol !== "https:") return "must be https";
  if (u.pathname !== "/api/shipping/notify/") return "path must be exactly /api/shipping/notify/ (slash included)";
  return null;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const accessKey = process.env.MONTONIO_ACCESS_KEY?.trim();
  const secretKey = process.env.MONTONIO_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) {
    console.error("No keys. Run with: node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs list");
    process.exit(2);
  }
  const live = process.env.MONTONIO_ENV?.trim() === "live";
  const base = live ? "https://shipping.montonio.com/api/v2" : "https://sandbox-shipping.montonio.com/api/v2";
  const mask = (s) => String(s).split(accessKey).join("***");
  const call = async (method, p, body) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearer(accessKey, secretKey)}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text: mask(text) };
  };
  console.log(`Montonio ${live ? "LIVE" : "SANDBOX"} shipping webhooks`);

  if (cmd === "register") {
    const bad = checkUrl(arg);
    if (bad) {
      console.error(`Refused: ${bad}`);
      process.exit(2);
    }
    const r = await call("POST", "/webhooks", { url: arg, enabledEvents: EVENTS });
    console.log(r.ok ? "registered:" : `✗ ${r.status}:`, r.text.slice(0, 500));
    if (!r.ok) process.exit(1);
  } else if (cmd === "delete") {
    if (!arg) {
      console.error("delete needs the webhook id from `list`");
      process.exit(2);
    }
    const r = await call("DELETE", `/webhooks/${encodeURIComponent(arg)}`);
    console.log(r.ok ? `deleted ${arg}` : `✗ ${r.status}: ${r.text.slice(0, 300)}`);
    if (!r.ok) process.exit(1);
  } else if (cmd !== "list") {
    console.error("Commands: list | register <url> | delete <id>");
    process.exit(2);
  }

  const r = await call("GET", "/webhooks");
  if (!r.ok) {
    console.log(`✗ ${r.status}: ${r.text.slice(0, 300)}`);
    process.exit(1);
  }
  const rows = JSON.parse(r.text).data ?? [];
  if (!rows.length) console.log("  (none registered)");
  for (const w of rows) console.log(`  ${w.id}  ${w.url}  [${(w.enabledEvents ?? []).join(", ")}]`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
