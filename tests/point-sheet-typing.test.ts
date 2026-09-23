/**
 * Typing in the parcel-point search — the owner on staging, 23.09.2026:
 *
 *   «When I type roma the modal blinks a lot and many times, so typing is
 *   hard. Same with Poland … almost impossible to finish typing your number.
 *   At some point it stops blinking; I type 91-433, choose the first one in
 *   the list but it's not selected.»
 *   «When I start typing Helsinki, the modal for the parcels starts blinking,
 *   throwing my cursor to the beginning of the text, sometimes losing text —
 *   searching is impossible. It touches all modals where lockers are
 *   searched.»
 *
 * One sheet serves the checkout and the account, so the four promises below
 * are held on that one sheet:
 *
 *   1. the search box is never rebuilt while the sheet is open — typing, the
 *      server's answers, the feeds and render() move the list and nothing else;
 *   2. the server is asked once the typing pauses (POINT_Q_MS), not per key;
 *   3. an answer to an older query never replaces the list for a newer one;
 *   4. a tapped row is the point chosen — even when an answer lands between
 *      the press and the click, and when the row came from the server's
 *      search rather than the first slice this browser holds.
 *
 * The storefront's own functions, sliced out of public/shop2/app.js and run
 * over a stand-in document: each element keeps its identity until something
 * writes the HTML around it, which is exactly the thing being counted. Time
 * is a hand-driven clock, and every request is answered by hand, in any order.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

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
function literal<T>(name: string): T {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if ((src[i] === "}" || src[i] === "]") && --depth === 0) {
      return new Function(`return ${src.slice(open, i + 1)};`)() as T;
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}
function numberVar(name: string): number {
  const m = src.match(new RegExp(`var ${name} = (\\d+);`));
  if (!m) throw new Error(`public/shop2/app.js no longer has var ${name} = <number>`);
  return Number(m[1]);
}

const Q_MS = numberVar("POINT_Q_MS");
const HOLD_MS = numberVar("POINT_HOLD_MS");

const SHEET = [
  "openPointSheet", "repaintPicker", "paintPointSheet", "pointSheetWanted", "pointSheet", "pointRows",
  "pointCountText", "pointTooManyHTML", "patchPointList", "pointPatch", "pointResultsChanged", "pointQueryTyped",
  "pointListPress", "pointListRelease", "pointsSearch", "pointsSearchPending", "pointsFind", "pointsFoundArrived",
  "pointsMatching", "pointsFiltered", "pointsList", "pointsKey", "coPointsKey", "pointsForAcct", "pointsHaveMap",
  "pointGeo", "pointsMixed", "carrierLabel", "pointKind", "pointKindLine", "pointChosen", "pointById", "pickPoint",
  "searchPoints", "matchesWords", "isPostcodeQuery", "normZip", "pointZip", "rankByPostcode", "orderCountry",
  "esc", "points", "pl",
];

type P = { id: string; name: string; address: string; city: string; zip: string; type?: string; lat?: null; lng?: null };
const pt = (id: string, name: string, city: string, zip: string): P =>
  ({ id, name, address: name, city, zip, type: "parcel_machine", lat: null, lng: null });

/* Poland's first slice — what the browser holds of 33 603. No Kraków in it. */
const SLICE = [
  pt("lodz-a", "ŁÓDŹ, FRANCISZKAŃSKA 31A", "ŁÓDŹ", "91433"),
  pt("waw", "WARSZAWA, MARSZAŁKOWSKA 10", "WARSZAWA", "00950"),
  pt("zn", "ŻNIN, 700-LECIA 7A", "ŻNIN", "88400"),
];
const KRK = pt("krk", "KRAKÓW, JANA PAWŁA II 5", "KRAKÓW", "30444");
const KRK2 = pt("krk2", "KRAKÓW, FLORIAŃSKA 1", "KRAKÓW", "31019");
const LODZ_NEW = pt("lodz-new", "ŁÓDŹ, PIOTRKOWSKA 91", "ŁÓDŹ", "91433");

type FakeNode = { id: string; innerHTML: string };

/** A document of ids: writing an element's HTML makes new elements of every id inside it. */
function fakeDom() {
  const byId: Record<string, FakeNode> = {};
  const writes: Record<string, number> = {};
  let box: object | null = null;
  const make = (id: string): FakeNode => {
    let html = "";
    return {
      id,
      get innerHTML() { return html; },
      set innerHTML(v: string) {
        html = v;
        writes[id] = (writes[id] ?? 0) + 1;
        if (id === "pointslot") {
          for (const k of Object.keys(byId)) if (k !== "pointslot") delete byId[k];
          // the search box is a new element whenever the slot is written
          box = v.includes("data-pointq") ? { searchBox: true } : null;
        }
        for (const m of v.matchAll(/id="([^"]+)"/g)) byId[m[1]] = make(m[1]);
      },
    };
  };
  byId.pointslot = make("pointslot");
  return {
    document: { getElementById: (id: string) => byId[id] ?? null },
    writes,
    box: () => box,
    html: (id: string) => byId[id]?.innerHTML ?? "",
  };
}

/** A clock that moves only when told to. */
function handClock() {
  let now = 0, seq = 0;
  const due: Array<{ id: number; at: number; fn: () => void }> = [];
  return {
    setTimeout: (fn: () => void, ms?: number) => { due.push({ id: ++seq, at: now + (ms ?? 0), fn }); return seq; },
    clearTimeout: (id: number) => { const k = due.findIndex((t) => t.id === id); if (k >= 0) due.splice(k, 1); },
    advance(ms: number) {
      now += ms;
      for (;;) {
        due.sort((a, b) => a.at - b.at);
        const t = due[0];
        if (!t || t.at > now) break;
        due.shift();
        t.fn();
      }
    },
  };
}

/** Every request the sheet makes, each answered (or refused) by hand. */
function handFetch() {
  const asked: Array<{ url: string; q: string; answer: (points: P[]) => void; fail: () => void }> = [];
  const fetch = (url: string) =>
    new Promise((resolve, reject) => {
      asked.push({
        url,
        q: new URL(url, "https://x").searchParams.get("q") ?? "",
        answer: (points) => resolve({ ok: true, json: () => Promise.resolve({ ok: true, points }) }),
        fail: () => reject(new TypeError("Failed to fetch")),
      });
    });
  return { fetch, asked };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

type Api = {
  open: (who?: string) => void;
  type: (v: string) => void;
  press: () => void;
  release: () => void;
  tap: (id: string) => unknown;
  rows: () => string[];
  paint: () => boolean;
  arrived: () => void;
  state: () => { point: unknown; open: boolean; machine: string; calls: string[] };
};

/** The checkout (or, with `acct`, the account) with Poland's DPD behind the sheet. */
function sheet(owner: "co" | "acct" = "co") {
  const dom = fakeDom(), clock = handClock(), net = handFetch();
  const body = `
    var S = {
      screen: OWNER === "acct" ? "account" : "checkout", lang: "RU", country: "EU", countryIso: "PL",
      ship: { method: "parcel", carrier: "dpd", point: null }, shipPicked: false,
      acctForm: { ship: { country: "PL", method: "parcel", carrier: "dpd", machine: "" } },
      acctSt: { ship: "" }, pointOpen: false, pointFor: ""
    };
    var POINTS = { by: {}, empty: {}, loading: {}, err: {}, q: "", view: "list", big: {}, found: {}, finding: {}, failed: {}, rows: [] };
    var CALLS = [];
    var POINT_Q_MS = QMS, POINT_HOLD_MS = HOLDMS;
    var pointQT = 0, pointQFor = "", pointPaint = {}, pointSheetOn = "";
    var pointListHeld = false, pointListPending = false, pointListT = 0;
    var pmap = null;
    ${SHEET.map(slice).join("\n")}
    function translateTree() {}
    function patchDelivery() { CALLS.push("delivery"); }
    function patchSummary() { CALLS.push("summary"); }
    function patchAcctPoint() { CALLS.push("acctpoint"); }
    function refocus() {} function settleModalFocus() {} function openPointMap() {}
    function paintPointMarkers() {} function pointMapCenter() { return [0, 0]; }
    function loadPoints() { CALLS.push("loadPoints"); }
    function loadPointsFor(c, cc) { CALLS.push("load:" + c + ":" + cc); }
    function acctShipChanged() { CALLS.push("save"); }
    function matchAcctPoint() { return false; }
    function methods() { return [{ pm: "dpd" }]; }
    function acctIdx() { return 0; }
    function acctShipCountry() { return "PL"; }
    function acctPointsKey() { return "dpd:PL"; }
    function shipCarrier() { return "dpd"; }
    POINTS.by["dpd:PL"] = SLICE; POINTS.big["dpd:PL"] = 33603;
    /* what the document's input listener does on every keystroke */
    return {
      open: function (who) { openPointSheet(who || ""); },
      type: function (v) { pointQueryTyped(v); },
      press: function () { pointListPress({ target: { closest: function (sel) { return sel === "#pointlist" ? {} : null; } } }); },
      release: function () { pointListRelease(); },
      tap: function (id) { var p = pointById(id); if (p) pickPoint(p); return p; },
      rows: function () { return POINTS.rows.map(function (p) { return p.id; }); },
      paint: function () { return paintPointSheet(); },
      arrived: function () { patchPointList(); },
      state: function () {
        return { point: S.ship.point, open: S.pointOpen, machine: S.acctForm.ship.machine, calls: CALLS };
      }
    };
  `;
  const env: Record<string, unknown> = {
    document: dom.document, fetch: net.fetch, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    CARRIER_NAMES: literal("CARRIER_NAMES"), POINT_KIND: literal("POINT_KIND"), COUNTRIES: literal("COUNTRIES"),
    SLICE, OWNER: owner, QMS: Q_MS, HOLDMS: HOLD_MS,
  };
  const names = Object.keys(env);
  // The body is this repository's own source plus fixed stub text — no input
  // of any kind is interpolated into it.
  const api = new Function(...names, body)(...names.map((n) => env[n])) as Api;
  if (owner === "acct") api.open("acct"); else api.open();
  return { api, dom, clock, net };
}

/** The keystrokes of typing `word`, one prefix per key, `gap` ms apart. */
function typeOut(h: ReturnType<typeof sheet>, word: string, gap = 60) {
  for (let i = 1; i <= word.length; i++) { h.api.type(word.slice(0, i)); h.clock.advance(gap); }
}

/* ------------------------------------------------------------------------ */

describe("1 · the search box is never rebuilt while the sheet is open", () => {
  for (const owner of ["co", "acct"] as const) {
    it(`typing, answering and re-rendering move the list only (${owner === "co" ? "checkout" : "account"})`, async () => {
      const h = sheet(owner);
      const box = h.dom.box();
      expect(box, "the sheet did not mount a search box").not.toBeNull();
      expect(h.dom.writes.pointslot).toBe(1);

      typeOut(h, "krak");
      h.clock.advance(Q_MS);
      expect(h.net.asked).toHaveLength(1);
      h.net.asked[0].answer([KRK, KRK2]);
      await settle();
      h.api.arrived();          // a carrier feed landing
      h.api.paint();            // what every render() now does
      h.api.paint();

      expect(h.dom.box(), "the search box was replaced under the caret").toBe(box);
      expect(h.dom.writes.pointslot, "the sheet was mounted again").toBe(1);
      expect(h.dom.writes.pointlist).toBeGreaterThan(0);
      expect(h.dom.html("pointlist")).toContain('data-pointpick="krk"');
    });
  }

  it("nothing that draws the blocks around it can reach it", () => {
    /* The checkout's delivery block and the account's slot are what the
       feeds, the rules, the logos and render() rewrite — the sheet used to
       live in both. */
    expect(slice("deliveryPicker")).not.toContain("pointSheet()");
    expect(slice("acctPointHTML")).not.toContain("pointSheet()");
    expect(slice("paintPointSheet")).toContain('document.getElementById("pointslot")');
    expect(src).toContain('<div id="pointslot"></div>');
    // and the one place the typing lands only patches
    expect(slice("pointQueryTyped")).not.toMatch(/repaintPicker|render\(|patchDelivery/);
  });

  it("a repaint that changes nothing writes nothing", () => {
    const h = sheet();
    const before = h.dom.writes.pointlist ?? 0;
    h.api.arrived();
    h.api.arrived();
    expect(h.dom.writes.pointlist ?? 0).toBe(before);
  });

  it("closing unmounts it, opening mounts it once more", () => {
    const h = sheet();
    h.api.tap("waw");
    expect(h.api.state().open).toBe(false);
    expect(h.dom.box()).toBeNull();
    h.api.open();
    expect(h.dom.box()).not.toBeNull();
    expect(h.dom.writes.pointslot).toBe(3);
  });
});

describe("2 · the server is asked when the typing pauses", () => {
  it("six keystrokes of a postcode are one request, for the whole postcode", () => {
    const h = sheet();
    typeOut(h, "91-433", 80);
    expect(h.net.asked, "a request went out mid-word").toHaveLength(0);
    h.clock.advance(Q_MS);
    expect(h.net.asked).toHaveLength(1);
    expect(h.net.asked[0].q).toBe("91-433");
    expect(h.net.asked[0].url).toContain("country=PL&carrier=dpd");
  });

  it("the same words are not asked twice, and a repaint does not push the request back", () => {
    const h = sheet();
    h.api.type("helsinki");
    h.clock.advance(Q_MS - 50);
    h.api.arrived();            // a repaint reads the search again
    h.clock.advance(60);
    expect(h.net.asked).toHaveLength(1);
    h.api.type("helsinki");
    h.clock.advance(Q_MS * 3);
    expect(h.net.asked).toHaveLength(1);
  });

  it("while it waits the list says «Ищем…», not «Ничего не нашли»", () => {
    const h = sheet();
    h.api.type("roma");
    expect(h.dom.html("pointlist")).toContain("Ищем…");
    expect(h.dom.html("pointlist")).not.toContain("Ничего не нашли");
  });

  it("a refused search says so once, and is not retried every 300 ms", async () => {
    const h = sheet();
    h.api.type("zzzz");
    h.clock.advance(Q_MS);
    h.net.asked[0].fail();
    await settle();
    expect(h.dom.html("pointlist")).toContain("Ничего не нашли");
    h.api.arrived();
    h.clock.advance(Q_MS * 20);
    expect(h.net.asked).toHaveLength(1);
  });
});

describe("3 · an older answer never replaces a newer query's list", () => {
  it("«kra» answering after «krak» is kept, not shown", async () => {
    const h = sheet();
    h.api.type("kra");
    h.clock.advance(Q_MS);
    h.api.type("krak");
    h.clock.advance(Q_MS);
    expect(h.net.asked.map((a) => a.q)).toEqual(["kra", "krak"]);

    h.net.asked[1].answer([KRK]);
    await settle();
    expect(h.api.rows()).toEqual(["krk"]);
    const writes = h.dom.writes.pointlist;

    h.net.asked[0].answer([KRK2, LODZ_NEW]);   // late, for the old words
    await settle();
    expect(h.dom.writes.pointlist, "the late answer repainted the list").toBe(writes);
    expect(h.api.rows()).toEqual(["krk"]);
    expect(h.dom.html("pointlist")).not.toContain("krk2");

    // …and a backspace to «kra» finds it without asking again
    h.api.type("kra");
    expect(h.api.rows()).toEqual(["krk2", "lodz-new"]);
    h.clock.advance(Q_MS);
    expect(h.net.asked).toHaveLength(2);
  });
});

describe("4 · a tapped row is the point chosen", () => {
  it("the first row of a search answer — not in the first slice — is selected", async () => {
    const h = sheet();
    h.api.type("91-433");
    h.clock.advance(Q_MS);
    h.net.asked[0].answer([LODZ_NEW, SLICE[0]]);
    await settle();
    expect(h.api.rows()[0]).toBe("lodz-new");
    h.api.tap("lodz-new");
    expect(h.api.state().point).toEqual(LODZ_NEW);
    expect(h.api.state().open).toBe(false);
  });

  it("an answer landing between the press and the click does not swap the row out", async () => {
    const h = sheet();
    h.api.type("91-433");                       // the local ranking shows first
    expect(h.api.rows()[0]).toBe("lodz-a");
    h.api.press();                              // finger down on that row…
    h.clock.advance(Q_MS);
    h.net.asked[0].answer([LODZ_NEW]);          // …the server answers meanwhile…
    await settle();
    const writes = h.dom.writes.pointlist;
    expect(h.api.rows()[0], "the list moved under the finger").toBe("lodz-a");
    h.api.release();
    h.api.tap("lodz-a");                        // …and the click lands on what was pressed
    expect(h.api.state().point).toEqual(SLICE[0]);
    expect(h.dom.writes.pointlist).toBe(writes);
  });

  it("a press that becomes a scroll lets the waiting repaint through, once", async () => {
    const h = sheet();
    h.api.type("91-433");
    h.api.press();
    h.clock.advance(Q_MS);
    h.net.asked[0].answer([LODZ_NEW]);
    await settle();
    expect(h.api.rows()[0]).toBe("lodz-a");
    h.api.release();                            // pointercancel / pointerup, no click
    h.clock.advance(HOLD_MS);
    expect(h.api.rows()).toEqual(["lodz-new"]);
    expect(h.dom.html("pointlist")).toContain('data-pointpick="lodz-new"');
  });

  it("in the account's sheet the tap is the default's locker, and the order is untouched", async () => {
    const h = sheet("acct");
    h.api.type("krak");
    h.clock.advance(Q_MS);
    h.net.asked[0].answer([KRK]);
    await settle();
    h.api.tap("krk");
    const st = h.api.state();
    expect(st.machine).toBe(KRK.name);
    expect(st.point).toBeNull();
    expect(st.calls).toContain("save");
  });
});
