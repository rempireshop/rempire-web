/**
 * «Обзор» and «Аналитика» keep the figures they already have when a refresh
 * fails — the numbers from a minute ago are worth more than an empty screen,
 * and that rule stays. What was missing is the line that says they are from a
 * minute ago: `err` was set only when there was nothing to keep, so a failed
 * refresh was indistinguishable from a fresh answer and the owner read stale
 * takings as this minute's (audit).
 *
 * Both loaders are cut out of app.js by source text and driven against a
 * stubbed apiJson, the way tests/admin-panel-truth.test.ts does it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

type Answer = { status: number; body?: Record<string, unknown> } | "network";
type Rec = { data: unknown; err: string | null; at: number };

const SRV: { admin: boolean | null } = { admin: true };
let ANALYTICS: Record<string, Rec>;
let OVERVIEW: { data: unknown; err: string | null; asked: boolean; at: number };
let answer: Answer;

function apiJson() {
  return answer === "network" ? Promise.reject(new Error("offline")) : Promise.resolve(answer);
}

function build(name: string) {
  return new Function(
    "SRV",
    "ANALYTICS",
    "OVERVIEW",
    "ADM_TTL",
    "apiJson",
    "render",
    `${slice(name)}\nreturn ${name};`,
  )(SRV, ANALYTICS, OVERVIEW, 30000, apiJson, () => {});
}

describe("a refresh that failed says so over the numbers it kept", () => {
  beforeEach(() => {
    SRV.admin = true;
    ANALYTICS = {};
    OVERVIEW = { data: null, err: null, asked: false, at: 0 };
  });

  it("«Аналитика» keeps the figures AND marks them", async () => {
    ANALYTICS["7d"] = { data: { kpi: "old" }, err: null, at: 0 };
    answer = { status: 503, body: { ok: false, error: "db_unavailable" } };
    await (build("loadAnalytics") as (r: string, f: boolean) => unknown)("7d", true);
    await Promise.resolve();

    expect(ANALYTICS["7d"].data, "the old figures stay on screen").toEqual({ kpi: "old" });
    expect(ANALYTICS["7d"].err, "…and the screen now has something to draw «Повторить» from").toBe("db_unavailable");
  });

  it("«Аналитика» marks a refresh the network swallowed too", async () => {
    ANALYTICS["7d"] = { data: { kpi: "old" }, err: null, at: 0 };
    answer = "network";
    await (build("loadAnalytics") as (r: string, f: boolean) => unknown)("7d", true);
    await new Promise((r) => setTimeout(r, 0));

    expect(ANALYTICS["7d"].data).toEqual({ kpi: "old" });
    expect(ANALYTICS["7d"].err).toBe("offline");
  });

  it("«Аналитика» clears the mark when an answer finally arrives", async () => {
    ANALYTICS["7d"] = { data: { kpi: "old" }, err: "offline", at: 0 };
    answer = { status: 200, body: { ok: true, kpi: "new" } };
    await (build("loadAnalytics") as (r: string, f: boolean) => unknown)("7d", true);
    await Promise.resolve();

    expect(ANALYTICS["7d"].err).toBeNull();
    expect((ANALYTICS["7d"].data as { kpi: string }).kpi).toBe("new");
  });

  it("«Обзор» keeps its summary AND marks it", async () => {
    OVERVIEW.data = { today: 1 };
    OVERVIEW.asked = false;
    answer = { status: 503, body: { ok: false, error: "db_unavailable" } };
    await (build("loadOverview") as (f: boolean) => unknown)(true);
    await Promise.resolve();

    expect(OVERVIEW.data).toEqual({ today: 1 });
    expect(OVERVIEW.err).toBe("db_unavailable");
  });

  it("an expired cookie is still a sign-in, not an outage", async () => {
    ANALYTICS["7d"] = { data: { kpi: "old" }, err: null, at: 0 };
    answer = { status: 401, body: { ok: false, error: "unauthorized" } };
    await (build("loadAnalytics") as (r: string, f: boolean) => unknown)("7d", true);
    await Promise.resolve();

    expect(SRV.admin).toBe(false);
    expect(ANALYTICS["7d"].err, "no error card behind the login card").toBeNull();
  });

  /* The card itself: one expression, drawn whether or not there is data under
     it. Both sentences already existed and are already translated. */
  it("the screen draws the card above figures it kept", () => {
    const screen = slice("admStatsScreen");
    expect(screen).toContain("head += statsErr;");
    expect(screen).toContain("Аналитика сейчас не отвечает — попробуйте позже.");
  });
});
