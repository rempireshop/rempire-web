/**
 * The go-live list behind /golive/ — GET /api/golive/, PUT /api/golive/ and
 * the rules in src/lib/golive.ts.
 *
 * Two things are worth testing here and they are not the same thing.
 *
 * The first is the one /test/ already taught us: the four ways a save could
 * quietly not happen — a stranger writing marks, a save that replaces instead
 * of merges, a body big enough to be a denial of service, an id the list does
 * not have — plus the property the whole page rests on, that the list itself
 * is readable with no session at all.
 *
 * The second is this page's own reason to exist: the lock on phase B. It is
 * the one rule on this page that a person under time pressure would otherwise
 * talk themselves past, so it is tested as a rule — locked while a blocking
 * row is open, open when they are all done, and indifferent to the rows
 * docs/go-live.md itself calls optional.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { getSettings, setSetting } from "@/lib/orders";
import {
  cleanStates,
  gate,
  getGoliveStates,
  holdUps,
  MAX_STATES,
  mergeStates,
  NOTE_MAX,
  phaseOf,
  PLAN,
  progress,
  saveGoliveStates,
  STATES_KEY,
  statusOf,
  STATUSES,
  type StateMap,
} from "@/lib/golive";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const BELL = String.fromCharCode(7); // a control character no keyboard types

let admin = "";

function put(body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/golive/`, { method: "PUT", headers, body: JSON.stringify(body) });
}
function get(cookie?: string) {
  return new Request(`${ORIGIN}/api/golive/`, { headers: cookie ? { cookie } : {} });
}

/* Nothing in this file may hardcode an item id: src/data/golive.json is
   rewritten whenever docs/go-live.md moves. Everything below is derived. */
const FIRST = PLAN.items[0];
const SECOND = PLAN.items[1];
const BLOCKING = PLAN.items.filter((i) => phaseOf(i) === "a" && i.blocking);
const AREA_PHASE = new Map(PLAN.areas.map((a) => [a.id, a.phase]));

/* Every timestamp in this file is deliberately in the PAST. `instant()` in
   src/lib/golive.ts clamps anything ahead of the server to the moment it
   arrived — a dated-tomorrow fixture would be rewritten under the test and
   stop asserting what it looks like it asserts. */

/** Every blocking phase-A row marked done, at one instant. */
function allClear(at = "2026-09-17T10:00:00.000Z"): StateMap {
  const out: StateMap = {};
  for (const item of BLOCKING) out[item.id] = { status: "done", note: "", at, by: "claude" };
  return out;
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});
afterAll(teardownDb);
beforeEach(async () => {
  resetRateLimits();
  await truncateAll();
});

describe("src/data/golive.json — the shape the page and the route agree on", () => {
  it("has two phases, areas that belong to one of them, and items with a real area", () => {
    expect(PLAN.version).toBe(1);
    expect(PLAN.source).toBe("docs/go-live.md");
    expect(PLAN.phases.length).toBe(2);
    const phases = new Set(PLAN.phases.map((p) => p.id));
    for (const area of PLAN.areas) expect(phases.has(area.phase), `area "${area.id}" → phase "${area.phase}"`).toBe(true);
    const areas = new Set(PLAN.areas.map((a) => a.id));
    for (const item of PLAN.items) expect(areas.has(item.area), `${item.id} → area "${item.area}"`).toBe(true);
  });

  it("keeps every id unique and kebab-case — a mark is keyed by it", () => {
    const seen = new Set<string>();
    for (const item of PLAN.items) {
      expect(seen.has(item.id), `duplicate id "${item.id}"`).toBe(false);
      expect(item.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      seen.add(item.id);
    }
  });

  it("fills in every field the page draws, with values it knows", () => {
    for (const item of PLAN.items) {
      expect(STATUSES, item.id).toContain(item.status);
      expect(Array.isArray(item.who) && item.who.length > 0, item.id).toBe(true);
      for (const who of item.who) expect(["claude", "dim", "renat"], item.id).toContain(who);
      expect(item.title.length, item.id).toBeGreaterThan(0);
      expect(item.detail.length, item.id).toBeGreaterThan(0);
      expect(item.en.title.length, item.id).toBeGreaterThan(0);
      expect(item.en.detail.length, item.id).toBeGreaterThan(0);
    }
  });

  it("names a dependency that exists, is not itself, and is not in a later phase", () => {
    const ids = new Set(PLAN.items.map((i) => i.id));
    for (const item of PLAN.items) {
      for (const need of item.needs || []) {
        expect(ids.has(need), `${item.id} needs "${need}", which is not in the list`).toBe(true);
        expect(need, item.id).not.toBe(item.id);
        /* A phase-A row waiting on a phase-B row would be an unsatisfiable
           gate: phase B cannot start until phase A is done. */
        const dep = PLAN.items.find((i) => i.id === need)!;
        if (phaseOf(item) === "a") expect(phaseOf(dep), `${item.id} → ${need}`).toBe("a");
      }
    }
  });

  it("has no cycle in the dependencies", () => {
    const by = new Map(PLAN.items.map((i) => [i.id, i]));
    const state = new Map<string, "open" | "closed">();
    const walk = (id: string, trail: string[]): void => {
      if (state.get(id) === "closed") return;
      expect(state.get(id), `cycle: ${[...trail, id].join(" → ")}`).not.toBe("open");
      state.set(id, "open");
      for (const need of by.get(id)?.needs || []) walk(need, [...trail, id]);
      state.set(id, "closed");
    };
    for (const item of PLAN.items) walk(item.id, []);
  });

  it("keeps a blocking row in phase A only, and marks the optional ones as not blocking", () => {
    expect(BLOCKING.length).toBeGreaterThan(0);
    for (const item of PLAN.items) {
      if (item.optional) expect(item.blocking ?? false, item.id).toBe(false);
      if (item.blocking) expect(AREA_PHASE.get(item.area), item.id).toBe("a");
    }
  });
});

describe("statusOf — the committed status is the floor, a mark is the overlay", () => {
  it("reads the list's own status when nobody has said anything", () => {
    for (const item of PLAN.items) expect(statusOf(item, {}), item.id).toBe(item.status);
  });

  it("lets a mark override it", () => {
    const states: StateMap = { [FIRST.id]: { status: "done", note: "", at: "", by: "claude" } };
    expect(statusOf(FIRST, states)).toBe("done");
    expect(statusOf(SECOND, states)).toBe(SECOND.status);
  });
});

describe("gate — «all items done in the diipsolution environment» before the domain moves", () => {
  it("is locked on the list as shipped, and names what is holding it", () => {
    const { locked, blockers } = gate({});
    expect(locked).toBe(true);
    expect(blockers.length).toBeGreaterThan(0);
    // every blocker is a blocking phase-A row that is not done
    for (const id of blockers) {
      const item = PLAN.items.find((i) => i.id === id)!;
      expect(phaseOf(item)).toBe("a");
      expect(item.blocking).toBe(true);
      expect(statusOf(item, {})).not.toBe("done");
    }
  });

  it("opens only when every blocking phase-A row is done", () => {
    const clear = allClear();
    expect(gate(clear)).toEqual({ locked: false, blockers: [] });

    // put any single one back and the door shuts again
    const oneShort: StateMap = { ...clear };
    oneShort[BLOCKING[0].id] = { status: "doing", note: "", at: "2026-09-17T11:00:00.000Z", by: "dim" };
    const after = gate(oneShort);
    expect(after.locked).toBe(true);
    expect(after.blockers).toEqual([BLOCKING[0].id]);
  });

  it("is not held by an optional phase-A row, or by anything in phase B", () => {
    /* allClear() touches the blocking phase-A rows and NOTHING else, so every
       other row is still sitting at whatever docs/go-live.md said. The door is
       open anyway — that is the whole assertion, and it is only worth making
       while there really are open rows of both kinds left behind. */
    const clear = allClear();
    const optionalOpen = PLAN.items.filter((i) => phaseOf(i) === "a" && !i.blocking && statusOf(i, clear) !== "done");
    const phaseBOpen = PLAN.items.filter((i) => phaseOf(i) === "b" && statusOf(i, clear) !== "done");
    expect(optionalOpen.length, "docs/go-live.md has optional phase-A rows").toBeGreaterThan(0);
    expect(phaseBOpen.length, "phase B is not done before it starts").toBeGreaterThan(0);
    expect(gate(clear).locked).toBe(false);
  });
});

describe("holdUps — the dependencies, named", () => {
  it("lists a dependency that is not done and drops it once it is", () => {
    const withDep = PLAN.items.find((i) => (i.needs || []).length > 0)!;
    const dep = withDep.needs![0];
    expect(holdUps(withDep, {})).toContain(dep);

    const done: StateMap = {};
    for (const need of withDep.needs!) done[need] = { status: "done", note: "", at: "", by: "claude" };
    expect(holdUps(withDep, done)).toEqual([]);
  });
});

describe("cleanStates — what the server is prepared to store", () => {
  it("keeps a well-formed mark and trims the rest", () => {
    const { states, unknown, tooMany } = cleanStates({
      [FIRST.id]: { status: "done", note: "  снимок есть, проверил  ", at: "2026-09-17T10:00:00.000Z", by: "dim" },
    });
    expect(unknown).toEqual([]);
    expect(tooMany).toBe(false);
    expect(states[FIRST.id]).toEqual({
      status: "done",
      note: "снимок есть, проверил",
      at: "2026-09-17T10:00:00.000Z",
      by: "dim",
    });
  });

  it("reports an id the list does not have instead of storing it", () => {
    const { states, unknown } = cleanStates({ "not-in-the-list": { status: "done", note: "x", at: "", by: "" } });
    expect(states).toEqual({});
    expect(unknown).toEqual(["not-in-the-list"]);
  });

  it("falls back to the list's own status when the one sent is not a status", () => {
    /* A note with no verdict must not invent one. «I am writing down what is
       left, I am not saying it moved» has to survive the round trip. */
    const { states } = cleanStates({ [FIRST.id]: { status: "нормально", note: "ждём воскресенья", at: "", by: "dim" } });
    expect(states[FIRST.id].status).toBe(FIRST.status);
    expect(states[FIRST.id].note).toBe("ждём воскресенья");
  });

  it("drops a control character and an over-long note", () => {
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    const { states } = cleanStates(
      {
        [FIRST.id]: {
          status: "doing",
          note: `a${BELL}b`.padEnd(NOTE_MAX + 500, "x"),
          at: "not a date",
          by: "к".repeat(100),
        },
      },
      now,
    );
    const s = states[FIRST.id];
    expect(s.note).not.toContain(BELL);
    expect(s.note.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(s.at).toBe("2026-09-17T12:00:00.000Z"); // unparsable → the moment it arrived
    expect(s.by.length).toBeLessThanOrEqual(40);
  });

  it("refuses to let a device with a fast clock win every future conflict", () => {
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    const { states } = cleanStates({ [FIRST.id]: { status: "done", note: "", at: "2030-01-01T00:00:00.000Z", by: "" } }, now);
    expect(states[FIRST.id].at).toBe("2026-09-17T12:00:00.000Z");
  });

  it("ignores a row that says nothing — no status and no note", () => {
    expect(cleanStates({ [FIRST.id]: { status: "", note: "   ", at: "", by: "dim" } }).states).toEqual({});
  });

  it("refuses a body with more marks than any list could have", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_STATES; i++) many[`filler-${i}`] = { status: "done", note: "x", at: "", by: "" };
    expect(cleanStates(many).tooMany).toBe(true);
  });
});

describe("mergeStates — a phone and a terminal, one document", () => {
  const older = { status: "doing", note: "старое", at: "2026-09-17T10:00:00.000Z", by: "dim" } as const;
  const newer = { status: "done", note: "новое", at: "2026-09-17T11:00:00.000Z", by: "claude" } as const;

  it("keeps the newer mark whichever side it is on", () => {
    expect(mergeStates({ [FIRST.id]: older }, { [FIRST.id]: newer })[FIRST.id]).toEqual(newer);
    expect(mergeStates({ [FIRST.id]: newer }, { [FIRST.id]: older })[FIRST.id]).toEqual(newer);
  });

  it("never drops a mark the incoming copy simply does not carry", () => {
    const stored: StateMap = { [SECOND.id]: newer };
    expect(mergeStates(stored, { [FIRST.id]: older })).toEqual({ [SECOND.id]: newer, [FIRST.id]: older });
  });
});

describe("progress — counted the same way on both sides", () => {
  it("counts a phase off the committed statuses when nothing is marked", () => {
    const a = progress({}, "a");
    expect(a.total).toBe(PLAN.items.filter((i) => phaseOf(i) === "a").length);
    expect(a.done + a.doing + a.blocked + a.todo).toBe(a.total);
    expect(progress({}).total).toBe(PLAN.items.length);
  });

  it("moves a row between the counts when it is marked", () => {
    const before = progress({}, phaseOf(FIRST));
    const after = progress({ [FIRST.id]: { status: "done", note: "", at: "", by: "" } }, phaseOf(FIRST));
    expect(after.total).toBe(before.total);
    if (FIRST.status !== "done") expect(after.done).toBe(before.done + 1);
  });
});

describe("GET /api/golive/", () => {
  it("hands a reader with no session nothing at all — not even the list", async () => {
    /* This test asserted the opposite until 19.09.2026, and the route was
       written to match: the list was public because the page had to work
       before anyone signed in. Audit F18 read what the rows actually say —
       which safeguards are unset and fail silently, that the live database is
       the stand's, where the domain is registered — and that is not a list to
       publish in launch week. The page's «before sign-in» case is its own
       localStorage copy, which this route never had to feed. */
    const { GET } = await import("@/app/api/golive/route");
    const res = await GET(get());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("forbidden");
    expect(body.signedIn).toBe(false);
    expect(body.plan).toBeUndefined();
    expect(body.states).toBeUndefined();
  });

  it("adds the marks once there is a session, and never before", async () => {
    const { PUT, GET } = await import("@/app/api/golive/route");
    await PUT(put({ states: { [FIRST.id]: { status: "doing", note: "видно только своим", at: "", by: "dim" } } }, admin));

    const anonymous = await (await GET(get())).json();
    expect(anonymous.states).toBeUndefined();

    const signedIn = await (await GET(get(admin))).json();
    expect(signedIn.signedIn).toBe(true);
    expect(signedIn.states[FIRST.id].note).toBe("видно только своим");
  });

  it("reports the door open once every blocking row is done", async () => {
    const { PUT, GET } = await import("@/app/api/golive/route");
    await PUT(put({ states: allClear() }, admin));
    const body = await (await GET(get(admin))).json();
    expect(body.gate).toEqual({ locked: false, blockers: [] });
  });
});

describe("PUT /api/golive/", () => {
  it("401s without the admin cookie, and stores nothing", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const res = await PUT(put({ states: { [FIRST.id]: { status: "done", note: "чужой", at: "", by: "" } } }));
    expect(res.status).toBe(401);
    expect(await getGoliveStates()).toEqual({});
  });

  it("401s on a forged cookie too", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const forged = `${ADMIN_COOKIE}=v1.${Date.now() + 60_000}.notasignature`;
    expect((await PUT(put({ states: {} }, forged))).status).toBe(401);
  });

  it("marks an item done into the one settings row and answers with the new gate", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const res = await PUT(
      put(
        { states: { [FIRST.id]: { status: "done", note: "готово", at: "2026-09-17T10:00:00.000Z", by: "claude" } } },
        admin,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.states[FIRST.id]).toEqual({ status: "done", note: "готово", at: "2026-09-17T10:00:00.000Z", by: "claude" });
    expect(body.gate.blockers).not.toContain(FIRST.id);

    // one row, not a new table — and a key /api/overrides does not publish
    const settings = await getSettings();
    expect(Object.keys(settings)).toEqual([STATES_KEY]);
    expect(await getGoliveStates()).toEqual(body.states);
  });

  /* The lock on phase B lived only in public/golive/index.html until
     19.09.2026, so the terminal the route header invites — «a curl, a script,
     Claude marking an item off» — could walk straight past the owner's one
     rule. These three say the rule is the route's now. */
  it("refuses to mark a phase-B row done while a blocking phase-A row is open", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const phaseB = PLAN.items.find((i) => phaseOf(i) === "b");
    expect(phaseB).toBeDefined();
    const res = await PUT(
      put({ states: { [phaseB!.id]: { status: "done", note: "", at: "2026-09-17T10:00:00.000Z", by: "claude" } } }, admin),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("phase_b_locked");
    expect(body.detail).toContain(phaseB!.id);
    expect(body.gate.locked).toBe(true);
    expect(await getGoliveStates()).toEqual({});
  });

  it("still takes a note on a phase-B row while it is locked — that is what a locked phase is for", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const phaseB = PLAN.items.find((i) => phaseOf(i) === "b")!;
    const res = await PUT(
      put({ states: { [phaseB.id]: { status: "todo", note: "ждём ключи", at: "2026-09-17T10:00:00.000Z", by: "dim" } } }, admin),
    );
    expect(res.status).toBe(200);
    expect((await getGoliveStates())[phaseB.id].note).toBe("ждём ключи");
  });

  it("lets one body close the last phase-A row and open phase B in the same breath", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const phaseB = PLAN.items.find((i) => phaseOf(i) === "b")!;
    const res = await PUT(
      put(
        {
          states: {
            ...allClear(),
            [phaseB.id]: { status: "doing", note: "", at: "2026-09-17T10:00:00.000Z", by: "claude" },
          },
        },
        admin,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gate.locked).toBe(false);
    expect(body.states[phaseB.id].status).toBe("doing");
  });

  it("merges instead of replacing — Claude's terminal does not erase the owner's phone", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    await PUT(put({ states: { [FIRST.id]: { status: "done", note: "Дима", at: "2026-09-17T10:00:00.000Z", by: "dim" } } }, admin));
    /* Claude's script loaded before the owner marked anything, so its map does
       not carry his mark at all. A replace would lose it. */
    const res = await PUT(
      put({ states: { [SECOND.id]: { status: "doing", note: "Клод", at: "2026-09-17T10:05:00.000Z", by: "claude" } } }, admin),
    );
    const body = await res.json();
    expect(body.states[FIRST.id].by).toBe("dim");
    expect(body.states[SECOND.id].by).toBe("claude");
  });

  it("keeps the newer mark when both sides touched the same item", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    await PUT(put({ states: { [FIRST.id]: { status: "done", note: "позже", at: "2026-09-17T12:00:00.000Z", by: "claude" } } }, admin));
    await PUT(put({ states: { [FIRST.id]: { status: "todo", note: "раньше", at: "2026-09-17T09:00:00.000Z", by: "dim" } } }, admin));
    expect((await getGoliveStates())[FIRST.id].note).toBe("позже");
  });

  it("413s an oversized body without storing any of it", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const huge = "я".repeat(200_000);
    const res = await PUT(put({ states: { [FIRST.id]: { status: "done", note: huge, at: "", by: "" } } }, admin));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("too_large");
    expect(await getGoliveStates()).toEqual({});
  });

  it("400s an id the list does not have, names it, and stores nothing at all", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const res = await PUT(
      put(
        {
          states: {
            [FIRST.id]: { status: "done", note: "хороший", at: "2026-09-17T10:00:00.000Z", by: "claude" },
            "made-up-item": { status: "done", note: "плохой", at: "2026-09-17T10:00:00.000Z", by: "claude" },
          },
        },
        admin,
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unknown_item");
    expect(body.detail).toEqual(["made-up-item"]);
    // all or nothing: the good half of a refused body is not half-saved
    expect(await getGoliveStates()).toEqual({});
  });

  it("400s a body that is not an object of marks", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    expect((await PUT(put([1, 2, 3], admin))).status).toBe(400);
    const broken = new Request(`${ORIGIN}/api/golive/`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin },
      body: "{not json",
    });
    expect((await PUT(broken)).status).toBe(400);
  });

  it("429s a caller that hammers it, and loses nothing already stored", async () => {
    const { PUT } = await import("@/app/api/golive/route");
    const mark = { states: { [FIRST.id]: { status: "doing", note: "раз", at: "2026-09-17T10:00:00.000Z", by: "dim" } } };
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      if ((await PUT(put(mark, admin))).status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    expect((await getGoliveStates())[FIRST.id].note).toBe("раз");
  });

  it("survives a row somebody else overwrote with rubbish", async () => {
    /* PUT /api/admin/settings can write any key, so this row is one careless
       request away from holding anything at all. A phone must not have to
       defend against that — the read does it here. */
    await setSetting(STATES_KEY, { v: 1, states: { [FIRST.id]: "not a mark", "ghost-item": { status: "done" } } });
    expect(await getGoliveStates()).toEqual({});
    const merged = await saveGoliveStates(
      cleanStates({ [FIRST.id]: { status: "done", note: "снова", at: "2026-09-17T10:00:00.000Z", by: "dim" } }).states,
    );
    expect(merged[FIRST.id].note).toBe("снова");
  });
});
