/**
 * The acceptance checklist behind /test/ — GET /api/testplan/, PUT
 * /api/testplan/ and the rules in src/lib/testplan.ts.
 *
 * What is worth testing here is not "does a save work" but the four ways it
 * could quietly not: a stranger writing answers, a save that replaces instead
 * of merges, a body big enough to be a denial of service, and an id the plan
 * does not have. Plus the one property the whole page rests on — the checklist
 * itself has to be readable with no session at all, because a tester whose
 * cookie expired must still be able to test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { getSettings, setSetting } from "@/lib/orders";
import {
  ANSWERS_KEY,
  cleanAnswers,
  getTestAnswers,
  mergeAnswers,
  MAX_ANSWERS,
  NOTE_MAX,
  PLAN,
  progress,
  saveTestAnswers,
  type AnswerMap,
} from "@/lib/testplan";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const BELL = String.fromCharCode(7); // a control character no keyboard types

let admin = "";

function put(body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/testplan/`, { method: "PUT", headers, body: JSON.stringify(body) });
}
function get(cookie?: string) {
  return new Request(`${ORIGIN}/api/testplan/`, { headers: cookie ? { cookie } : {} });
}

/** The first two items of whatever plan is shipped. Nothing in this file may
    hardcode an id: src/data/testplan.json is replaced wholesale. */
const FIRST = PLAN.items[0];
const SECOND = PLAN.items[1];

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

describe("src/data/testplan.json — the shape the page and the route agree on", () => {
  it("has areas and items, and every item names an area that exists", () => {
    expect(PLAN.version).toBe(1);
    expect(PLAN.areas.length).toBeGreaterThan(0);
    expect(PLAN.items.length).toBeGreaterThan(1);
    const areas = new Set(PLAN.areas.map((a) => a.id));
    for (const item of PLAN.items) expect(areas.has(item.area), `${item.id} → area "${item.area}"`).toBe(true);
  });

  it("keeps every id unique and kebab-case — an answer is keyed by it", () => {
    const seen = new Set<string>();
    for (const item of PLAN.items) {
      expect(seen.has(item.id), `duplicate id "${item.id}"`).toBe(false);
      expect(item.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      seen.add(item.id);
    }
  });

  it("fills in every field the page draws, with values it knows", () => {
    for (const item of PLAN.items) {
      expect(["renat", "dim", "both"], item.id).toContain(item.who);
      expect(["phone", "desktop", "any"], item.id).toContain(item.device);
      expect(["RU", "ET", "EN", "any"], item.id).toContain(item.lang);
      expect(["high", "med", "low"], item.id).toContain(item.risk);
      expect(typeof item.writes, item.id).toBe("boolean");
      expect(item.title.length, item.id).toBeGreaterThan(0);
      expect(item.expect.length, item.id).toBeGreaterThan(0);
      expect(item.why.length, item.id).toBeGreaterThan(0);
      expect(Array.isArray(item.steps) && item.steps.length > 0, item.id).toBe(true);
    }
  });

  it("marks at least one item as creating real data — that flag is the warning", () => {
    expect(PLAN.items.some((i) => i.writes)).toBe(true);
  });
});

describe("cleanAnswers — what the server is prepared to store", () => {
  it("keeps a well-formed answer and trims the rest", () => {
    const { answers, unknown, tooMany } = cleanAnswers({
      [FIRST.id]: { status: "ok", note: "  работает, но кнопка мелкая  ", at: "2026-09-08T10:00:00.000Z", by: "renat" },
    });
    expect(unknown).toEqual([]);
    expect(tooMany).toBe(false);
    expect(answers[FIRST.id]).toEqual({
      status: "ok",
      note: "работает, но кнопка мелкая",
      at: "2026-09-08T10:00:00.000Z",
      by: "renat",
    });
  });

  it("reports an id the plan does not have instead of storing it", () => {
    const { answers, unknown } = cleanAnswers({ "not-in-the-plan": { status: "ok", note: "x", at: "", by: "" } });
    expect(answers).toEqual({});
    expect(unknown).toEqual(["not-in-the-plan"]);
  });

  it("drops an unusable verdict, a control character and an over-long note", () => {
    const now = Date.parse("2026-09-08T12:00:00.000Z");
    const { answers } = cleanAnswers(
      {
        [FIRST.id]: {
          status: "excellent",
          note: `a${BELL}b`.padEnd(NOTE_MAX + 500, "x"),
          at: "not a date",
          by: "х".repeat(100),
        },
      },
      now,
    );
    const a = answers[FIRST.id];
    expect(a.status).toBe("skip"); // an unknown verdict is not a verdict
    expect(a.note).not.toContain(BELL);
    expect(a.note.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(a.at).toBe("2026-09-08T12:00:00.000Z"); // unparsable → the moment it arrived
    expect(a.by.length).toBeLessThanOrEqual(40);
  });

  it("refuses to let a phone with a fast clock win every future conflict", () => {
    const now = Date.parse("2026-09-08T12:00:00.000Z");
    const { answers } = cleanAnswers({ [FIRST.id]: { status: "ok", note: "", at: "2030-01-01T00:00:00.000Z", by: "" } }, now);
    expect(answers[FIRST.id].at).toBe("2026-09-08T12:00:00.000Z");
  });

  it("ignores a row that says nothing — no verdict and no comment", () => {
    const { answers } = cleanAnswers({ [FIRST.id]: { status: "", note: "   ", at: "", by: "renat" } });
    expect(answers).toEqual({});
  });

  it("refuses a body with more answers than any plan could have", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_ANSWERS; i++) many[`filler-${i}`] = { status: "ok", note: "x", at: "", by: "" };
    expect(cleanAnswers(many).tooMany).toBe(true);
  });
});

describe("mergeAnswers — two phones, one document", () => {
  const older = { status: "bad", note: "старое", at: "2026-09-08T10:00:00.000Z", by: "renat" } as const;
  const newer = { status: "ok", note: "новое", at: "2026-09-08T11:00:00.000Z", by: "dim" } as const;

  it("keeps the newer answer whichever side it is on", () => {
    expect(mergeAnswers({ [FIRST.id]: older }, { [FIRST.id]: newer })[FIRST.id]).toEqual(newer);
    expect(mergeAnswers({ [FIRST.id]: newer }, { [FIRST.id]: older })[FIRST.id]).toEqual(newer);
  });

  it("never drops an answer the incoming copy simply does not carry", () => {
    const stored: AnswerMap = { [SECOND.id]: newer };
    expect(mergeAnswers(stored, { [FIRST.id]: older })).toEqual({ [SECOND.id]: newer, [FIRST.id]: older });
  });
});

describe("GET /api/testplan/", () => {
  it("hands the checklist to a reader with no session at all", async () => {
    const { GET } = await import("@/app/api/testplan/route");
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.signedIn).toBe(false);
    expect(body.plan.items.length).toBe(PLAN.items.length);
    expect(body.answers).toEqual({});
  });

  it("adds the answers once there is a session, and never before", async () => {
    const { PUT, GET } = await import("@/app/api/testplan/route");
    await PUT(put({ answers: { [FIRST.id]: { status: "bad", note: "видно только своим", at: "", by: "renat" } } }, admin));

    const anonymous = await (await GET(get())).json();
    expect(anonymous.answers).toEqual({});

    const signedIn = await (await GET(get(admin))).json();
    expect(signedIn.signedIn).toBe(true);
    expect(signedIn.answers[FIRST.id].note).toBe("видно только своим");
  });
});

describe("PUT /api/testplan/", () => {
  it("401s without the admin cookie, and stores nothing", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    const res = await PUT(put({ answers: { [FIRST.id]: { status: "ok", note: "чужой", at: "", by: "" } } }));
    expect(res.status).toBe(401);
    expect(await getTestAnswers()).toEqual({});
  });

  it("401s on a forged cookie too", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    const forged = `${ADMIN_COOKIE}=v1.${Date.now() + 60_000}.notasignature`;
    expect((await PUT(put({ answers: {} }, forged))).status).toBe(401);
  });

  it("saves an answer into the one settings row and reads it back", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    const res = await PUT(
      put(
        { answers: { [FIRST.id]: { status: "ok", note: "но кнопка мелкая", at: "2026-09-08T10:00:00.000Z", by: "renat" } } },
        admin,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answers[FIRST.id].note).toBe("но кнопка мелкая");

    // one row, not a new table — and a key /api/overrides does not publish
    const settings = await getSettings();
    expect(Object.keys(settings)).toEqual([ANSWERS_KEY]);
    expect(await getTestAnswers()).toEqual(body.answers);
  });

  it("merges instead of replacing — the second phone does not erase the first", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    await PUT(put({ answers: { [FIRST.id]: { status: "ok", note: "Ренат", at: "2026-09-08T10:00:00.000Z", by: "renat" } } }, admin));
    /* Dim's phone loaded before Renat answered, so its map does not carry
       Renat's answer at all. A replace would lose it. */
    const res = await PUT(
      put({ answers: { [SECOND.id]: { status: "bad", note: "Дима", at: "2026-09-08T10:05:00.000Z", by: "dim" } } }, admin),
    );
    const body = await res.json();
    expect(body.answers[FIRST.id].by).toBe("renat");
    expect(body.answers[SECOND.id].by).toBe("dim");
    expect(progress(body.answers).answered).toBe(2);
  });

  it("keeps the newer answer when both phones answered the same item", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    await PUT(put({ answers: { [FIRST.id]: { status: "ok", note: "позже", at: "2026-09-08T12:00:00.000Z", by: "dim" } } }, admin));
    await PUT(put({ answers: { [FIRST.id]: { status: "bad", note: "раньше", at: "2026-09-08T09:00:00.000Z", by: "renat" } } }, admin));
    expect((await getTestAnswers())[FIRST.id].note).toBe("позже");
  });

  it("413s an oversized body without storing any of it", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    const huge = "я".repeat(200_000);
    const res = await PUT(put({ answers: { [FIRST.id]: { status: "ok", note: huge, at: "", by: "" } } }, admin));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("too_large");
    expect(await getTestAnswers()).toEqual({});
  });

  it("400s an id the plan does not have, names it, and stores nothing at all", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    const res = await PUT(
      put(
        {
          answers: {
            [FIRST.id]: { status: "ok", note: "хороший", at: "2026-09-08T10:00:00.000Z", by: "renat" },
            "made-up-item": { status: "ok", note: "плохой", at: "2026-09-08T10:00:00.000Z", by: "renat" },
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
    expect(await getTestAnswers()).toEqual({});
  });

  it("400s a body that is not an object of answers", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    expect((await PUT(put([1, 2, 3], admin))).status).toBe(400);
    const broken = new Request(`${ORIGIN}/api/testplan/`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin },
      body: "{not json",
    });
    expect((await PUT(broken)).status).toBe(400);
  });

  it("429s a caller that hammers it, and loses nothing already stored", async () => {
    const { PUT } = await import("@/app/api/testplan/route");
    const answer = { answers: { [FIRST.id]: { status: "ok", note: "раз", at: "2026-09-08T10:00:00.000Z", by: "renat" } } };
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      if ((await PUT(put(answer, admin))).status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    expect((await getTestAnswers())[FIRST.id].note).toBe("раз");
  });

  it("survives a row somebody else overwrote with rubbish", async () => {
    /* PUT /api/admin/settings can write any key, so this row is one careless
       request away from holding anything at all. The page must not have to
       defend against that on a phone — the read does it here. */
    await setSetting(ANSWERS_KEY, { v: 1, answers: { [FIRST.id]: "not an answer", "ghost-item": { status: "ok" } } });
    expect(await getTestAnswers()).toEqual({});
    const merged = await saveTestAnswers(
      cleanAnswers({ [FIRST.id]: { status: "ok", note: "снова", at: "2026-09-08T10:00:00.000Z", by: "dim" } }).answers,
    );
    expect(merged[FIRST.id].note).toBe("снова");
  });
});
