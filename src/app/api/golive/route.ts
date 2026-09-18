/**
 * The go-live list at `/golive/` — its data and its marks.
 *
 *   GET  /api/golive/   → { ok, plan, signedIn, states, gate }
 *   PUT  /api/golive/   ← { states: { "<item-id>": {status, note, at, by} } }
 *
 * Shaped after /api/testplan/, one route and one audience:
 *
 *   · GET requires the admin session. It used to be public, on the argument
 *     that the page has to be usable before anyone signs in — that being the
 *     point of the localStorage half (public/golive/index.html) — and that the
 *     list is our own words about our own launch. The audit of 18.09.2026
 *     (F18) read what those words actually say: that a failed payment
 *     notification raises no alarm and looks exactly like «заказов нет», which
 *     variables are unset and fail closed silently, that the live database is
 *     the same Railway instance as the stand's, that refunds did not work on
 *     18.09, and that the domain sits at ASCIO — which is where a transfer
 *     phishing call starts. No credential, but a map, published during the one
 *     week it is worth the most. The «works before sign-in» case is the page's
 *     own cached copy: it needs the list on the device, not in the world, and
 *     `public/golive/index.html` already falls back to that cache when this
 *     route gives it no plan.
 *   · PUT requires the same session (src/lib/auth.ts) — the one the panel
 *     uses, so «signed in» is the same person on both ends, and the same
 *     cookie is what lets Claude tick an item off from a terminal.
 *
 * `gate` travels on both answers, computed by src/lib/golive.ts from the
 * states this response is returning. The page mirrors that function rather
 * than leaning on this field — it has to be right offline and in the second
 * between a tap and a save, the same way /test/ mirrors mergeAnswers — so
 * what this field is really for is everyone who is NOT the page: a curl, a
 * script, Claude marking an item off from a terminal. It is how a caller
 * learns that the thing it just ticked was the last one holding the door,
 * without re-deriving the owner's rule from the list.
 *
 * The lock now BINDS those callers as well as the page. Until 19.09.2026 the
 * owner's rule — «before that switch to live domain, we need to get all items
 * done in the diipsolution environment» — was enforced in one place, the
 * page's own JavaScript, and a PUT could mark a phase-B row done over the top
 * of it. A rule that lives only in the screen is a rule the terminal does not
 * have, so a phase-B row cannot be moved to `done` or `doing` while a
 * blocking phase-A row is open. A PUT that closes the last phase-A row and
 * opens phase B in the same body is fine: the gate is computed on the result.
 *
 * The states live in one `settings` row and a save merges rather than
 * replaces; src/lib/golive.ts says why, and owns every validation rule this
 * file applies.
 */
import { clientIp, isAdmin, rateLimit, requireAdmin } from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";
import { cleanStates, gate, getGoliveStates, phaseOfId, PLAN, saveGoliveStates } from "@/lib/golive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The list's own items cap the body far more tightly than this does; the byte
   cap is here for the request that never went near the page. A note is clamped
   to 1000 characters and there are a few dozen items, so a legitimate save is
   a handful of kilobytes even in Cyrillic (two bytes a letter over the wire). */
const MAX_BYTES = 128_000;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  if (!isAdmin(req)) {
    /* No database touched and no list handed over. `isAdmin` rather than
       `requireAdmin` because the page polls this while signed out, waiting for
       the owner to come back from the login screen, and a denial that writes
       an audit row would fill the journal with his own waiting. */
    return Response.json(
      { ok: false, error: "forbidden", signedIn: false },
      { status: 401, headers: NO_STORE },
    );
  }
  try {
    const states = await getGoliveStates();
    return Response.json(
      { ok: true, plan: PLAN, signedIn: true, states, gate: gate(states) },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/golive] read failed:", err);
    /* The list still travels. `states: null` is how the page tells «nothing
       saved yet» apart from «could not read what was saved» — and it must
       tell them apart, because the second one is the case where the lock on
       screen is not the lock on the server. */
    return Response.json(
      { ok: false, error: "db_unavailable", plan: PLAN, signedIn: true, states: null, gate: gate({}) },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function PUT(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  /* Per IP, for the owner's phone and Claude's terminal together: the page
     debounces its saves to one every second and a half of typing, and a
     scripted run marks items one at a time. A refused save is not a lost save
     — the page keeps its states in localStorage and retries. */
  if (rateLimit("golive", clientIp(req), 60, 60_000)) {
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

  const { states, unknown, tooMany } = cleanStates(body.states);
  if (tooMany) return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  if (unknown.length) {
    /* Named, not swallowed. The page filters its outgoing map against the list
       it just loaded, so this can only be a request that did not come from it
       — a hand-written curl with a typo in the id, most likely — and answering
       «ok» to a body we did not store is how a launch item gets ticked off in
       a terminal and stays open on the page. */
    return Response.json({ ok: false, error: "unknown_item", detail: unknown }, { status: 400, headers: NO_STORE });
  }

  try {
    /* The owner's rule, applied where it binds every caller and not only the
       screen. `gate()` reads phase A only, so a body that finishes phase A
       unlocks phase B in the same breath — which is why this is computed on
       the merge and not on what is stored. `status` is the only thing refused:
       a note on a phase-B row, or moving one back, stays allowed, because
       writing down what is waiting is exactly what a locked phase is for. */
    const stored = await getGoliveStates();
    const ahead = gate({ ...stored, ...states });
    if (ahead.locked) {
      const early = Object.keys(states).filter(
        (id) => phaseOfId(id) === "b" && (states[id].status === "done" || states[id].status === "doing"),
      );
      if (early.length) {
        return Response.json(
          { ok: false, error: "phase_b_locked", detail: early, gate: ahead },
          { status: 409, headers: NO_STORE },
        );
      }
    }

    const merged = await saveGoliveStates(states);
    const after = gate(merged);
    /* Ids and counts, not the notes. What is worth knowing later is which rows
       were touched and — the one line anybody will ever come back for — when
       the lock on phase B came off and what was the last thing to lift it. */
    await writeAuditSafe("admin", "golive.save", {
      ids: Object.keys(states).slice(0, 20),
      total: Object.keys(merged).length,
      locked: after.locked,
      blockers: after.blockers.length,
    });
    return Response.json({ ok: true, states: merged, gate: after }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/golive] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
