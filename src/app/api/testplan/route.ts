/**
 * The acceptance checklist at `/test/` — its data and its answers.
 *
 *   GET  /api/testplan/   → { ok, plan, signedIn, answers }
 *   PUT  /api/testplan/   ← { answers: { "<item-id>": {status, note, at, by} } }
 *
 * One route, two audiences, on purpose:
 *
 *   · GET is PUBLIC, because the page has to be usable before anyone signs in
 *     — that is the whole point of the localStorage half (public/test/index.html).
 *     What it publishes is the committed checklist, which is our own words
 *     about our own shop and is no more secret than /guide/. `answers` comes
 *     back only for an admin; for everyone else it is `{}` and `signedIn` is
 *     false, and the page says so in as many words.
 *   · PUT requires the admin session (src/lib/auth.ts) — Renat is already
 *     signed into the panel on his phone, and there is exactly one admin
 *     password, so "signed in" is the same person on both ends.
 *
 * The answers live in one `settings` row and a save merges rather than
 * replaces; src/lib/testplan.ts says why, and owns every validation rule this
 * file applies.
 */
import { clientIp, isAdmin, rateLimit, requireAdmin } from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";
import { cleanAnswers, getTestAnswers, PLAN, saveTestAnswers } from "@/lib/testplan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The plan's own items cap the body far more tightly than this does; the byte
   cap is here for the request that never went near the page. A note is clamped
   to 1000 characters and there are a few dozen items, so a legitimate save is
   a handful of kilobytes even in Cyrillic (two bytes a letter over the wire). */
const MAX_BYTES = 128_000;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const signedIn = isAdmin(req);
  if (!signedIn) {
    /* No database touched at all for a signed-out reader: the checklist is a
       file, and a phone with no session is exactly the case that has to keep
       working when the database does not. */
    return Response.json({ ok: true, plan: PLAN, signedIn: false, answers: {} }, { headers: NO_STORE });
  }
  try {
    return Response.json(
      { ok: true, plan: PLAN, signedIn: true, answers: await getTestAnswers() },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/testplan] read failed:", err);
    /* The plan still travels. A tester whose database is down can go on
       testing — the page keeps his answers locally and syncs them later —
       and `answers: null` is how the page tells "nothing saved yet" apart
       from "could not read what was saved". */
    return Response.json(
      { ok: false, error: "db_unavailable", plan: PLAN, signedIn: true, answers: null },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function PUT(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  /* Two testers can share one salon Wi-Fi, so the limit is per IP for both of
     them together: the page debounces its saves to one every second and a half
     of typing, which no pair of humans can push past 60 a minute. A save that
     is refused is not a save that is lost — the page keeps the answers in
     localStorage and retries. */
  if (rateLimit("testplan", clientIp(req), 60, 60_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });
  }

  const { answers, unknown, tooMany } = cleanAnswers(body.answers);
  if (tooMany) return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  if (unknown.length) {
    /* Named, not swallowed. The page filters its outgoing map against the plan
       it just loaded, so this can only be a request that did not come from it —
       and answering "fine" to a body we did not store is how an answer goes
       missing without anybody noticing. */
    return Response.json({ ok: false, error: "unknown_item", detail: unknown }, { status: 400, headers: NO_STORE });
  }

  try {
    const merged = await saveTestAnswers(answers);
    /* Counts, never the answers themselves. PUT /api/admin/settings writes its
       whole payload into admin_audit, which is right for a setting changed
       twice a month and wrong for a document saved after every sentence
       somebody types — it would store the growing checklist a hundred times
       over. What is worth knowing later is that a save happened and how big
       the document is now. */
    await writeAuditSafe("admin", "testplan.save", { saved: Object.keys(answers).length, total: Object.keys(merged).length });
    return Response.json({ ok: true, answers: merged }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/testplan] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
