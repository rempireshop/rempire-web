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
 * Since 08.09.2026 the file carries both languages: every row and every area
 * has an `en` beside its Russian, because Renat tests in Russian and Dim reads
 * English and the two of them answer the same ids into the same document. A
 * row with no English half is not a formatting slip — it is a check one of the
 * two testers cannot read, so it is pinned here exactly as hard as the rest.
 *
 * It is deliberately a plain data test with no database and no fetch: it must
 * stay fast enough that nobody is tempted to skip it while editing the plan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLAN_PATH = fileURLToPath(new URL("../src/data/testplan.json", import.meta.url));
const raw = readFileSync(PLAN_PATH, "utf8");

const PAGE_PATH = fileURLToPath(new URL("../public/test/index.html", import.meta.url));
const page = readFileSync(PAGE_PATH, "utf8");

/** The four closed lists the renderer switches on. */
const WHO = ["renat", "dim", "both"] as const;
const DEVICE = ["phone", "desktop", "any"] as const;
const LANG = ["RU", "ET", "EN", "any"] as const;
const RISK = ["high", "med", "low"] as const;

interface Area {
  id: string;
  name: string;
  note: string;
  en: { name: string; note: string };
}
interface Item {
  id: string;
  area: string;
  who: string;
  device: string;
  lang: string;
  title: string;
  steps: string[];
  expect: string[];
  why: string;
  risk: string;
  writes: boolean;
  en: { title: string; steps: string[]; expect: string[]; why: string };
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

  /* One page, two languages. Renat answers in Russian and Dim in English, and
     both write into the same document keyed by the same ids — so a row that is
     missing its English half is not "untranslated", it is a check one of the
     two testers cannot read. Hence: every row, every field, no exceptions and
     no blanks standing in for one. */
  it("says every area in English too", () => {
    for (const a of plan.areas) {
      expect(a.en, `area ${a.id} has no en`).toBeTruthy();
      expect(typeof a.en.name, `area ${a.id}.en.name`).toBe("string");
      expect(a.en.name.trim().length, `area ${a.id}.en.name is blank`).toBeGreaterThan(0);
      expect(typeof a.en.note, `area ${a.id}.en.note`).toBe("string");
      expect(a.en.note.trim().length, `area ${a.id}.en.note is blank`).toBeGreaterThan(0);
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
      expect(Array.isArray(it_.expect), `${it_.id}.expect`).toBe(true);
      expect(it_.expect.length, `${it_.id}.expect is empty`).toBeGreaterThan(0);
      for (const [i, e] of it_.expect.entries()) {
        expect(typeof e, `${it_.id}.expect[${i}]`).toBe("string");
        expect(e.trim().length, `${it_.id}.expect[${i}] is blank`).toBeGreaterThan(0);
      }
      expect(it_.why.trim().length, `${it_.id}.why is empty`).toBeGreaterThan(0);
    }
  });

  /* The step lists are checked against each other, not just for being
     non-empty: the page numbers the steps and the two testers compare notes by
     that number, so «step 3 fails» has to mean the same instruction in both
     languages. A translation that merged two steps into one silently renumbers
     everything after it. */
  it("gives every item the same steps in English, one for one", () => {
    for (const it_ of plan.items) {
      expect(it_.en, `${it_.id} has no en`).toBeTruthy();
      expect(it_.en.title.trim().length, `${it_.id}.en.title is blank`).toBeGreaterThan(0);
      expect(Array.isArray(it_.en.expect), `${it_.id}.en.expect`).toBe(true);
      expect(it_.en.expect.length, `${it_.id}.en.expect counts ${it_.en.expect.length}, Russian counts ${it_.expect.length}`).toBe(it_.expect.length);
      for (const [i, e] of it_.en.expect.entries()) {
        expect(typeof e, `${it_.id}.en.expect[${i}]`).toBe("string");
        expect(e.trim().length, `${it_.id}.en.expect[${i}] is blank`).toBeGreaterThan(0);
      }
      expect(it_.en.why.trim().length, `${it_.id}.en.why is blank`).toBeGreaterThan(0);
      expect(Array.isArray(it_.en.steps), `${it_.id}.en.steps`).toBe(true);
      expect(it_.en.steps.length, `${it_.id}.en.steps counts ${it_.en.steps.length}, Russian counts ${it_.steps.length}`).toBe(it_.steps.length);
      for (const [i, s] of it_.en.steps.entries()) {
        expect(typeof s, `${it_.id}.en.steps[${i}]`).toBe("string");
        expect(s.trim().length, `${it_.id}.en.steps[${i}] is blank`).toBeGreaterThan(0);
      }
    }
  });

  /* The reason `expect` is a list at all. On 08.09.2026 the owner read the
     first check and could not follow it: six things to verify, joined by
     commas into one 34-word sentence, read on a phone while looking at the
     shop. Splitting it fixes that only for as long as nobody writes the
     sentence back in — so the shape is held here rather than in a style note
     nobody opens. The numbers are deliberately generous: they catch a line
     that has turned back into a paragraph, not a line that is a few words
     longer than its neighbours. */
  it("keeps every expected result short enough to check at a glance", () => {
    for (const it_ of plan.items) {
      expect(it_.expect.length, `${it_.id}.expect has ${it_.expect.length} lines — split the check instead`).toBeLessThanOrEqual(6);
      for (const [lang, lines] of [["ru", it_.expect], ["en", it_.en.expect]] as const) {
        for (const [i, e] of lines.entries()) {
          const words = e.trim().split(/\s+/).length;
          expect(words, `${it_.id}.${lang} expect[${i}] runs ${words} words: ${e}`).toBeLessThanOrEqual(16);
          /* Two commas a line are ignored on purpose, and so are two whole
             classes of comma that are not list commas at all: the one inside
             a Russian price (5,47 €), and everything after a colon, because
             «Не возим: Норвегия, Швейцария, …» is one fact however many
             countries it names. What is left is the shape that made the plan
             unreadable — several different checks strung together. */
          const flat = e.replace(/(\d),(\d)/g, "$1.$2");
          const head = flat.includes(":") ? flat.slice(0, flat.indexOf(":")) : flat;
          const commas = (head.match(/,/g) ?? []).length;
          expect(commas, `${it_.id}.${lang} expect[${i}] packs several checks into one line: ${e}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("carries no field the renderer does not know about", () => {
    const keys = ["id", "area", "who", "device", "lang", "title", "steps", "expect", "why", "risk", "writes", "en"];
    for (const it_ of plan.items) {
      expect(Object.keys(it_).sort(), `${it_.id} keys`).toEqual([...keys].sort());
      expect(Object.keys(it_.en).sort(), `${it_.id}.en keys`).toEqual(["expect", "steps", "title", "why"]);
    }
    for (const a of plan.areas) {
      expect(Object.keys(a).sort(), `area ${a.id} keys`).toEqual(["en", "id", "name", "note"]);
      expect(Object.keys(a.en).sort(), `area ${a.id}.en keys`).toEqual(["name", "note"]);
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

/**
 * The page's own words exist twice: once written into the markup — which is
 * what a browser shows before the script has run, and the reason a tester
 * whose phone blocked the script still gets a Russian checklist — and once in
 * the `TEXT` dictionary the language switch paints from. Two copies of one
 * sentence drift, and the way this pair would drift is invisible: the page
 * looks right until somebody switches to English and back, and comes back
 * reading something slightly different from what they started with.
 *
 * So they are compared here rather than trusted. Text, not implementation:
 * the markup is HTML and the dictionary is an ES5 object literal, and the only
 * thing that has to be true of both is the sentence.
 */
describe("public/test/index.html — one Russian, written twice", () => {
  const ruBlock = page.slice(page.indexOf("    ru: {"), page.indexOf("    en: {"));
  const enBlock = page.slice(page.indexOf("    en: {"), page.indexOf("  /** One string in the language"));

  it("says the same thing in the markup and in the dictionary", () => {
    expect(ruBlock.length, "the ru dictionary was not found").toBeGreaterThan(1000);
    expect(enBlock.length, "the en dictionary was not found").toBeGreaterThan(1000);

    /* Every node the switch repaints — `data-t="key"`, always the last
       attribute, always a leaf with plain text in it. */
    const nodes = [...page.matchAll(/data-t="([\w.]+)"[^>]*>([^<]+)</g)];
    expect(nodes.length, "no data-t nodes found — did the markup change shape?").toBeGreaterThan(15);

    for (const [, key, text] of nodes) {
      /* Dotted keys reach into the small maps: `who.renat` is written
         `renat: "Ренат"` inside `who: { … }`. */
      const leaf = key.split(".").pop() as string;
      const entry = `${leaf}: ${JSON.stringify(text)}`;
      expect(ruBlock, `«${text}» is in the markup as ${key} but not in TEXT.ru`).toContain(entry);
      expect(enBlock, `${key} has no English`).toContain(`${leaf}: "`);
    }
  });

  it("keeps the default Russian and the two keys the answers live under", () => {
    /* A default of anything but Russian would hand Renat a page he cannot read
       and a switch he cannot find; the language key is separate from the
       answers on purpose, so clearing a preference never touches an answer. */
    expect(page).toContain('lang: "ru",         // Renat is the primary tester');
    expect(page).toContain('var LS_LANG = "rempire-testplan-lang";');
    expect(page).toContain('var LS_ANSWERS = "rempire-testplan-v1";');
    expect(page).toContain('state.lang = TEXT[value] ? value : "ru";');
  });
});
