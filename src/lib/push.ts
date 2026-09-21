/**
 * Web Push — the owner's own «новый заказ» on his phone, from the «Админка»
 * he keeps on the Home Screen. Storage: db/migrations/200_push_subscriptions.sql,
 * worker: public/shop2/admin-sw.js, routes: src/app/api/admin/push/**.
 *
 * Renat, 20.09.2026, through Dim: «Notifications about order on the phone,
 * through app would be nice — apple and android.» This is the third channel
 * beside the two in src/lib/notify.ts, not a replacement for either: Telegram
 * is the fallback and always was, because a push permission is a thing a phone
 * update, a reinstall or a stray tap can take away without telling anybody.
 *
 * THE ENVIRONMENT, and these are the exact names:
 *
 *   VAPID_PUBLIC_KEY   the application server key, base64url, 87 characters.
 *                      The browser needs this one too — it is handed out by
 *                      GET /api/admin/push/ rather than baked into the panel,
 *                      because public/shop2/ is a plain static script and
 *                      never sees a NEXT_PUBLIC_* substitution.
 *   VAPID_PRIVATE_KEY  the other half, base64url, 43 characters. Server only.
 *   VAPID_SUBJECT      optional; a `mailto:` or `https:` URL the push service
 *                      can complain to. Defaults to the shop's own address.
 *
 * Both keys come out of one command — `npx web-push generate-vapid-keys` —
 * and they are a PAIR: replacing them invalidates every subscription in the
 * table at once, because the push service checks each request against the
 * public key the browser subscribed with. Generate them once, keep them.
 *
 * WITH NO KEYS CONFIGURED nothing here sends and nothing here throws — the
 * same bargain src/lib/notify.ts makes, and for the same reason: the order is
 * the contract, not the ping. sendPush() answers `{ok:false, configured:false}`
 * and the paid-order hook goes on.
 *
 * …but the SUBSCRIBE side refuses instead of degrading, and the difference is
 * deliberate. A shop that quietly accepted a device it can never send to would
 * show Renat «уведомления включены» and stay silent for ever, which is the
 * exact failure RESEND_TO once had (notify.ts). So GET /api/admin/push/
 * reports `configured` and the subscribe route answers 503 `not_configured`:
 * the button is never green on a shop that has no keys.
 *
 * WHAT THROWS AND WHAT DOES NOT, said plainly because it is not uniform:
 *
 *   sendPush()            never throws. It runs inside a paid order.
 *   the three that touch  may throw a database error, and their routes turn it
 *   the table             into a 503. A «включить» that failed must say so;
 *                         swallowing it is how a device goes missing silently.
 */
import { query } from "@/lib/db";

/* ---------- configuration ------------------------------------------------ */

/** The shop's own address (docs/accounts.md) — who the push service complains to. */
const DEFAULT_SUBJECT = "mailto:shop@rempireshop.com";

function vapid(): { subject: string; publicKey: string; privateKey: string } | null {
  const publicKey = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  if (!publicKey || !privateKey) return null;
  return { subject: (process.env.VAPID_SUBJECT ?? "").trim() || DEFAULT_SUBJECT, publicKey, privateKey };
}

/** True when this deployment can actually send. The panel asks before it offers the button. */
export function pushConfigured(): boolean {
  return vapid() !== null;
}

/**
 * The application server key the browser passes to `pushManager.subscribe()`.
 * Empty string when unconfigured — never null, so a caller that forgets to
 * check renders nothing rather than the word "null" in an attribute.
 */
export function pushPublicKey(): string {
  return vapid()?.publicKey ?? "";
}

/* ---------- the subscriptions -------------------------------------------- */

/** One device, as the panel's list shows it. The endpoint is its id. */
export interface PushDevice {
  endpoint: string;
  label: string;
  createdAt: string;
  /** When a push to it was last accepted; null until one is. */
  lastOkAt: string | null;
}

/** What the browser's PushSubscription carries, flattened. */
export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string;
}

type DeviceRow = { endpoint: string; label: string; created_at: string | Date; last_ok_at: string | Date | null };

function device(row: DeviceRow): PushDevice {
  return {
    endpoint: row.endpoint,
    label: row.label ?? "",
    createdAt: new Date(row.created_at as string).toISOString(),
    lastOkAt: row.last_ok_at ? new Date(row.last_ok_at as string).toISOString() : null,
  };
}

/* The column checks in the migration are the real bound; these trim to them so
   a body two characters too long is a saved row rather than a 500 out of
   Postgres. Nothing here decides whether the values are *valid* — only the
   push service can say that, and it does, on the first send. */
const MAX_ENDPOINT = 2000;
const MAX_KEY = 255;
const MAX_LABEL = 100;

/**
 * A request body → a subscription, or null when it is not one.
 *
 * Both shapes are taken: `JSON.stringify(pushSubscription)` nests the keys
 * under `keys`, and a panel that assembles the body by hand invariably
 * flattens them. Refusing the flat one would be a 400 nobody can read.
 *
 * The endpoint must parse as an https URL. It is the primary key of the table
 * and a row is only ever written from here, so this is the one place a typo,
 * a truncated paste or somebody else's string can be stopped before it becomes
 * a permanent row nothing will ever send to.
 */
export function cleanSubscription(raw: unknown, label?: unknown): PushSubscriptionInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as { endpoint?: unknown; keys?: unknown; p256dh?: unknown; auth?: unknown };
  const keys = (body.keys && typeof body.keys === "object" ? body.keys : body) as { p256dh?: unknown; auth?: unknown };

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (!endpoint || !p256dh || !auth) return null;
  if (endpoint.length > MAX_ENDPOINT || p256dh.length > MAX_KEY || auth.length > MAX_KEY) return null;

  try {
    if (new URL(endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { endpoint, p256dh, auth, label: typeof label === "string" ? label.trim().slice(0, MAX_LABEL) : "" };
}

/**
 * Add a device, or bring one back.
 *
 * Idempotent on the endpoint, which is what lets the panel call it on every
 * boot without asking whether it has called it before: the browser hands back
 * the same endpoint for the same profile, so a second tap of «включить»
 * updates the row it already has. `retired_at` is cleared here — the whole
 * point of a soft retirement is that the device can come back as itself.
 *
 * `created_at` is deliberately NOT refreshed: it is when this device was first
 * trusted with the shop's orders, and that is a fact about the past.
 */
export async function saveSubscription(input: PushSubscriptionInput): Promise<PushDevice> {
  const rows = await query<DeviceRow>(
    `insert into push_subscriptions (endpoint, p256dh, auth, label)
          values ($1, $2, $3, $4)
     on conflict (endpoint) do update
            set p256dh = excluded.p256dh,
                auth = excluded.auth,
                /* An empty label must not wipe the name the owner typed on
                   another day — the panel re-subscribes silently on boot and
                   has nothing to say about the device then. */
                label = case when excluded.label = '' then push_subscriptions.label else excluded.label end,
                retired_at = null,
                retired_reason = null
       returning endpoint, label, created_at, last_ok_at`,
    [
      String(input.endpoint).slice(0, MAX_ENDPOINT),
      String(input.p256dh).slice(0, MAX_KEY),
      String(input.auth).slice(0, MAX_KEY),
      String(input.label ?? "").trim().slice(0, MAX_LABEL),
    ],
  );
  return device(rows[0]);
}

/**
 * Turn one device off. `reason` is 'owner' when the button in the panel did
 * it; sendPush() writes 'gone' for the ones a push service disowned, in its
 * own batched statement rather than through here.
 *
 * False when no live row carried that endpoint — the panel can then say «это
 * устройство уже выключено» instead of claiming to have done something.
 */
export async function removeSubscription(endpoint: string, reason: string = "owner"): Promise<boolean> {
  const rows = await query<{ endpoint: string }>(
    `update push_subscriptions
        set retired_at = now(), retired_reason = $2
      where endpoint = $1 and retired_at is null
      returning endpoint`,
    [String(endpoint).slice(0, MAX_ENDPOINT), reason],
  );
  return rows.length > 0;
}

/** The live devices, oldest first — the order the panel's list shows them in. */
export async function listSubscriptions(): Promise<PushDevice[]> {
  const rows = await query<DeviceRow>(
    `select endpoint, label, created_at, last_ok_at
       from push_subscriptions
      where retired_at is null
      order by created_at`,
  );
  return rows.map(device);
}

/* ---------- sending ------------------------------------------------------ */

/** What lands on the phone. The worker reads exactly these four fields. */
export interface PushMessage {
  title: string;
  body: string;
  /**
   * Where a tap goes. A path on this shop, not an absolute URL — the worker
   * resolves it against its own origin, so a deployment under a different
   * host (a preview, the stand) opens ITS panel rather than production's.
   */
  url?: string;
  /**
   * The collapse key. Two pushes with one tag are one line in the shade: a
   * second notification about the SAME order replaces the first instead of
   * stacking. Different orders must carry different tags.
   */
  tag?: string;
}

export interface PushSendResult {
  /** At least one device took it. False for «nothing configured» too. */
  ok: boolean;
  configured: boolean;
  /** Live devices at the moment of the send. */
  devices: number;
  sent: number;
  /** Refused or unreachable — kept, and tried again on the next order. */
  failed: number;
  /** Gone for good (404/410); retired here and never sent to again. */
  gone: number;
}

const NOT_CONFIGURED: PushSendResult = { ok: false, configured: false, devices: 0, sent: 0, failed: 0, gone: 0 };

/**
 * How long one push may hold a paid order. The hook that calls this is inside
 * the payment callback, and a push service that has stopped answering must not
 * be able to hold the shop's own request open until the platform kills the
 * function. `web-push` uses node's https directly and has no timeout of its
 * own, so the timeout is here. A send that loses this race is counted as
 * failed — it may well arrive; what it may not do is make anybody wait.
 */
const SEND_TIMEOUT_MS = 5_000;

/**
 * How long the push service holds the message for a phone that is off. Four
 * weeks is the library's default and it is wrong for this shop: an order alert
 * that surfaces a fortnight late is not information, it is confusion. A day
 * covers a flat battery and an overnight flight, which is the case worth
 * covering — anything longer and the e-mail beside it has already told him.
 */
const TTL_SECONDS = 24 * 60 * 60;

/* The payload is encrypted before it goes, and the push services cap the
   ciphertext at 4 KB. These leave room for the encryption overhead and for a
   URL, with no arithmetic to get wrong: the body is a one-line summary, not a
   letter — the letter is already in his inbox. */
const MAX_TITLE = 100;
const MAX_BODY = 300;
const MAX_URL = 500;

function payloadOf(msg: PushMessage): string {
  return JSON.stringify({
    title: String(msg.title ?? "").slice(0, MAX_TITLE),
    body: String(msg.body ?? "").slice(0, MAX_BODY),
    url: String(msg.url ?? "").slice(0, MAX_URL),
    tag: String(msg.tag ?? "").slice(0, MAX_TITLE),
  });
}

type Outcome = "sent" | "gone" | "failed";
type WebPush = typeof import("web-push");

/**
 * `web-push` is CommonJS, and its `module.exports = { … }` has expressions for
 * values, which node's ESM loader cannot read named exports out of — so the
 * namespace arrives with everything under `default`, while webpack hands back
 * both. Whichever one carries the function wins.
 *
 * Worth a helper rather than a line, because the failure it prevents type-checks
 * perfectly: `(await import("web-push")).sendNotification` is `undefined` at
 * run time and `tsc` has no complaint about it.
 */
async function loadWebPush(): Promise<WebPush> {
  const mod = (await import("web-push")) as WebPush & { default?: WebPush };
  return mod.default ?? mod;
}

/**
 * 404 and 410 are the push services' way of saying «this subscription will
 * never work again» — the app was removed from the Home Screen, the profile
 * was wiped, the permission was revoked. Anything else (429, 500, a timeout, a
 * dead socket) is about THIS attempt and says nothing about the device.
 *
 * Retiring on the first 500 would silently disconnect Renat's phone the one
 * afternoon Apple has a bad hour; retrying a 410 for ever spends a request per
 * order, per dead device, for the life of the shop.
 */
function isGone(err: unknown): boolean {
  const code = (err as { statusCode?: unknown })?.statusCode;
  return code === 404 || code === 410;
}

async function sendOne(
  wp: WebPush,
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  details: { subject: string; publicKey: string; privateKey: string },
): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    /* A request that loses this race is abandoned, not cancelled — there is no
       way to un-send it, and it may well still arrive on the phone. What it
       cannot do is hold the order. */
    return await Promise.race([
      wp
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { vapidDetails: details, TTL: TTL_SECONDS, urgency: "high" },
        )
        .then(() => "sent" as const),
      new Promise<"failed">((resolve) => {
        timer = setTimeout(() => resolve("failed"), SEND_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    if (isGone(err)) return "gone";
    console.error("[push] a device refused the notification:", (err as { statusCode?: unknown })?.statusCode ?? err);
    return "failed";
  } finally {
    /* Or the timer keeps the function alive for five seconds after a send that
       took fifty milliseconds — the same reason src/lib/auth.ts clears its. */
    clearTimeout(timer);
  }
}

/**
 * Send one message to every live device. Never throws — see the file header.
 *
 * The keys are checked BEFORE the database is asked. A shop with no VAPID keys
 * is the ordinary state of a fresh deployment and of every test run, and it
 * must not spend a query per paid order proving it.
 */
export async function sendPush(msg: PushMessage): Promise<PushSendResult> {
  const details = vapid();
  if (!details) return NOT_CONFIGURED;

  try {
    const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `select endpoint, p256dh, auth
         from push_subscriptions
        where retired_at is null
        order by created_at`,
    );
    if (!subs.length) return { ...NOT_CONFIGURED, configured: true };

    const wp = await loadWebPush();
    const payload = payloadOf(msg);

    /* All of his devices at once, and one failure must not cost the others
       their notification — which is what allSettled buys over all(). Renat has
       three; this is not a batch job and needs no chunking. */
    const settled = await Promise.allSettled(subs.map((s) => sendOne(wp, s, payload, details)));

    const ok: string[] = [];
    const gone: string[] = [];
    let failed = 0;
    settled.forEach((r, i) => {
      const outcome: Outcome = r.status === "fulfilled" ? r.value : "failed";
      if (outcome === "sent") ok.push(subs[i].endpoint);
      else if (outcome === "gone") gone.push(subs[i].endpoint);
      else failed += 1;
    });

    /* Two statements, not two per device: the stamp and the retirement are
       each one `= any($1)`. A write that fails here is logged and swallowed —
       the notifications have already arrived, and a paid order must not fail
       over bookkeeping about them. */
    if (ok.length) {
      await query("update push_subscriptions set last_ok_at = now() where endpoint = any($1::text[])", [ok]);
    }
    if (gone.length) {
      await query(
        `update push_subscriptions
            set retired_at = now(), retired_reason = 'gone'
          where endpoint = any($1::text[]) and retired_at is null`,
        [gone],
      );
      console.warn(`[push] ${gone.length} subscription(s) retired — the push service says they are gone.`);
    }

    return { ok: ok.length > 0, configured: true, devices: subs.length, sent: ok.length, failed, gone: gone.length };
  } catch (err) {
    console.error("[push] send failed", err);
    return { ok: false, configured: true, devices: 0, sent: 0, failed: 0, gone: 0 };
  }
}
