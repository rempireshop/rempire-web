/**
 * The manual test plan is data, not prose — `src/data/testplan.json` is read by
 * the page that renders the checklist, so a typo in it is a checkbox nobody can
 * tick rather than a sentence somebody misreads. These are the invariants that
 * page relies on: the file parses, every id is unique (the page keys its
 * checkboxes by id, and two rows with one id would tick each other), every
 * `area` exists in `areas`, every enum value is one the page can draw, and no
 * item is missing the two halves that make it a test — what the finger does and
 * what the screen must then show.
 *
 * It is deliberately a plain data test with no database and no fetch: it must
 * stay fast enough that nobody is tempted to skip it while editing the plan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLAN_PATH = fileURLToPath(new URL("../src/data/testplan.json", import.meta.url));
const raw = readFileSync(PLAN_PATH, "utf8");

/** The four closed lists the renderer switches on. */
const WHO = ["renat", "dim", "both"] as const;
const DEVICE = ["phone", "desktop", "any"] as const;
const LANG = ["RU", "ET", "EN", "any"] as const;
const RISK = ["high", "med", "low"] as const;

interface Area {
  id: string;
  name: string;
  note: string;
}
interface Item {
  id: string;
  area: string;
  who: string;
  device: string;
  lang: string;
  title: string;
  steps: string[];
  expect: string;
  why: string;
  risk: string;
  writes: boolean;
}
interface Plan {
  version: number;
  areas: Area[];
  items: Item[];
}

describe("testplan.json — the shape the checklist page reads", () => {
  let plan: Plan;

  it("parses as JSON with a version, areas and items", () => {
    expect(() => JSON.parse(raw)).not.toThrow();
    plan = JSON.parse(raw) as Plan;
    expect(plan.version).toBe(1);
    expect(Array.isArray(plan.areas)).toBe(true);
    expect(Array.isArray(plan.items)).toBe(true);
    expect(plan.areas.length).toBeGreaterThan(0);
    expect(plan.items.length).toBeGreaterThan(0);
  });

  it("gives every area an id, a name and a note, and never the same id twice", () => {
    const seen = new Set<string>();
    for (const a of plan.areas) {
      expect(typeof a.id, `area id ${JSON.stringify(a.id)}`).toBe("string");
      expect(a.id).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(a.id), `duplicate area id: ${a.id}`).toBe(false);
      seen.add(a.id);
      expect(a.name.trim().length, `area ${a.id} name`).toBeGreaterThan(0);
      expect(a.note.trim().length, `area ${a.id} note`).toBeGreaterThan(0);
    }
  });

  it("gives every item a unique kebab-case id", () => {
    const seen = new Set<string>();
    for (const it_ of plan.items) {
      expect(it_.id, `id ${JSON.stringify(it_.id)}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(it_.id), `duplicate item id: ${it_.id}`).toBe(false);
      seen.add(it_.id);
    }
  });

  it("points every item at an area that exists", () => {
    const areas = new Set(plan.areas.map((a) => a.id));
    for (const it_ of plan.items) {
      expect(areas.has(it_.area), `${it_.id} → unknown area ${it_.area}`).toBe(true);
    }
  });

  it("uses only legal enum values", () => {
    for (const it_ of plan.items) {
      expect(WHO, `${it_.id}.who`).toContain(it_.who);
      expect(DEVICE, `${it_.id}.device`).toContain(it_.device);
      expect(LANG, `${it_.id}.lang`).toContain(it_.lang);
      expect(RISK, `${it_.id}.risk`).toContain(it_.risk);
      expect(typeof it_.writes, `${it_.id}.writes`).toBe("boolean");
    }
  });

  it("gives every item steps a finger can follow and a result a screen can show", () => {
    for (const it_ of plan.items) {
      expect(it_.title.trim().length, `${it_.id}.title`).toBeGreaterThan(0);
      expect(Array.isArray(it_.steps), `${it_.id}.steps`).toBe(true);
      expect(it_.steps.length, `${it_.id}.steps is empty`).toBeGreaterThan(0);
      for (const [i, s] of it_.steps.entries()) {
        expect(typeof s, `${it_.id}.steps[${i}]`).toBe("string");
        expect(s.trim().length, `${it_.id}.steps[${i}] is blank`).toBeGreaterThan(0);
      }
      expect(it_.expect.trim().length, `${it_.id}.expect is empty`).toBeGreaterThan(0);
      expect(it_.why.trim().length, `${it_.id}.why is empty`).toBeGreaterThan(0);
    }
  });

  it("carries no field the renderer does not know about", () => {
    const keys = ["id", "area", "who", "device", "lang", "title", "steps", "expect", "why", "risk", "writes"];
    for (const it_ of plan.items) {
      expect(Object.keys(it_).sort(), `${it_.id} keys`).toEqual([...keys].sort());
    }
    for (const a of plan.areas) {
      expect(Object.keys(a).sort(), `area ${a.id} keys`).toEqual(["id", "name", "note"]);
    }
  });

  it("leaves no area without items, so the page never draws an empty heading", () => {
    for (const a of plan.areas) {
      const n = plan.items.filter((i) => i.area === a.id).length;
      expect(n, `area ${a.id} has no items`).toBeGreaterThan(0);
    }
  });

  it("keeps the items of one area together, so a tester can work top to bottom", () => {
    const order = plan.items.map((i) => i.area);
    const firstSeen: string[] = [];
    for (const a of order) if (firstSeen[firstSeen.length - 1] !== a) firstSeen.push(a);
    expect(new Set(firstSeen).size, "an area's items are split across the list").toBe(firstSeen.length);
  });
});
