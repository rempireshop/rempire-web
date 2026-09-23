/**
 * «Доставка по умолчанию», the owner's «bad» of 19.09.2026:
 *
 *   «In Account I get text "Пакомат для этой страны выбирается при оформлении
 *   заказа — их слишком много для списка." — not good UX. Even if I chose
 *   Italy in account, at checkout I still need to choose country.» (Dim)
 *
 * Four things were behind those two sentences, and each has its own block:
 *
 *   1. **Big countries had no picker.** Italy, Poland, Germany hold thousands
 *      of points, the account could not list them, and said so instead. Since
 *      22.09.2026 the checkout searches them on the server — so the account
 *      now opens the checkout's own sheet, keyed on its own draft.
 *   2. **A tap in the checkout outranked a later save in the account.**
 *      S.shipPicked blocked the account default until the next order, so a
 *      shopper who looked at the checkout, then set Italy in the account, came
 *      back to the old country.
 *   3. **The country selects were not repainted.** A preference landing while
 *      step 2 was open moved the delivery block and left the two selects above
 *      it on the old country.
 *   4. **Greece could not be saved.** It is the one served country with no
 *      pickup point, so it had no row in CARRIERS_BY_COUNTRY — the table every
 *      «do we know this country?» asked — and became «EU».
 *
 * …and the owner's «bad» of 23.09.2026 on staging, after the first fix:
 *
 *   «I cannot search for parcel lockers for Estonia — but I can for Italy for
 *   example in my account.» (Dim)
 *
 *   5. **Only the big countries had the search.** A list that fitted in one
 *      download (Estonia, Latvia, Lithuania, Finland) still got a plain
 *      <select> of every name in alphabetical order. Every list gets the
 *      checkout's button and sheet now — «every list gets the picker» below.
 *
 * The storefront's own functions, sliced out of public/shop2/app.js by source
 * text and run over stubs, as tests/checkout-country.test.ts does; the server
 * half is imported for real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SHIPPING_RULES, quoteFromRules, shippingZone } from "@/lib/shipping";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

const has = (name: string) => src.includes(`function ${name}(`);

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
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

/** Every one of these that app.js has. One it lacks fails at its call, by name. */
const fns = (...names: string[]) => names.filter(has).map(slice).join("\n");

/** Read a `var <name> = <literal>;` out of app.js and evaluate it. */
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

const CARRIERS_BY_COUNTRY = literal<Record<string, string[]>>("CARRIERS_BY_COUNTRY");
const COURIER_CARRIERS = literal<Record<string, string[]>>("COURIER_CARRIERS");

const TABLES = {
  CARRIERS_BY_COUNTRY,
  COURIER_CARRIERS,
  CARRIER_NAMES: literal<Record<string, string>>("CARRIER_NAMES"),
  COUNTRIES: literal<Array<[string, string]>>("COUNTRIES"),
  EUROPE_ISO: literal<string[]>("EUROPE_ISO"),
  DELIVERY: literal<Array<{ k: string; l: string }>>("DELIVERY"),
  MONTONIO_PRICE: literal<unknown>("MONTONIO_PRICE"),
  POINT_KIND: literal<Record<string, string>>("POINT_KIND"),
  SHIP_RULES: DEFAULT_SHIPPING_RULES,
};

/** The account block and what it leans on — the draft, its rows, its country. */
const ACCT = [
  "shipServed", "acctShipCountry", "acctMethods", "methods", "rowKind", "acctIdx", "acctShipFromRow",
  "acctShipPrice", "shipRulePrice", "shipZoneOf", "orderCountry", "pickupOpen", "carriersFor",
  "courierCarriersFor", "methodCarriers", "deliveryFor", "acctPickCountry", "applyAcctShipPref",
  "pointsForAcct", "acctPointsKey",
];

/** The block's locker picker and what it draws with. */
const PICKER = [
  "acctPointHTML", "acctPointButton", "acctPointNamed", "pointNamed", "acctMachines", "acctMachinesTooMany",
  "pointKind", "pointKindLine", "points", "pl", "esc",
];

/** A fresh S: an Estonian checkout, nothing picked, nothing saved. */
const STATE = `
  var S = {
    screen: "account", lang: "RU", country: "EE", countryIso: "", coStep: 1,
    ship: { method: "parcel", carrier: "", point: null }, shipPicked: false,
    cust: null, acctForm: { name: "", phone: "", birthday: "", marketing: false, ship: null },
    acctSt: { name: "", phone: "", birthday: "", marketing: "", ship: "" },
    pointOpen: false, pointFor: ""
  };
  var POINTS = { by: {}, empty: {}, loading: {}, err: {}, q: "", view: "list", big: {}, found: {}, finding: {}, failed: {}, rows: [] };
  var CALLS = [];
`;

/**
 * Run a body over the tables, with S and POINTS declared fresh. `env` adds
 * stand-ins by name — only for functions that are NOT also sliced into the
 * body, or the later declaration would silently win.
 */
function run<T>(body: string, env: Record<string, unknown> = {}): T {
  const all: Record<string, unknown> = { ...TABLES, ...env };
  const names = Object.keys(all);
  // The body is this repository's own source plus fixed stub text — no input
  // of any kind is interpolated into it.
  return new Function(...names, STATE + body)(...names.map((n) => all[n])) as T;
}

/** Stand-ins for the screen: nothing is drawn, every call is written down. */
const SCREEN = `
  function render() { CALLS.push("render"); }
  function acctShipChanged() { CALLS.push("save"); }
  function loadPoints() { CALLS.push("loadPoints"); }
  function loadPointsFor(c, cc) { CALLS.push("load:" + c + ":" + cc); }
  function patchDelivery() { CALLS.push("delivery"); }
  function patchSummary() { CALLS.push("summary"); }
  function patchCountry() { CALLS.push("country"); }
  function patchAcctPoint() { CALLS.push("acctpoint"); }
  function patchPointList() { CALLS.push("list"); }
  function paintPointMarkers() { CALLS.push("markers"); }
  function openPointMap() {}
  function refocus() {}
  function settleModalFocus() {}
  function pointSheet() { return "<SHEET>"; }
  function paintPointSheet() { CALLS.push("sheet"); return false; }
`;

const courierQuote = (cc: string, carrier?: string) =>
  quoteFromRules(DEFAULT_SHIPPING_RULES, { country: cc, method: "courier", carrier, subtotal: 0 }).price;

/* ------------------------------------------------------------------------ */

describe("Greece: a country with a courier and no locker is still a country", () => {
  it("the second select keeps Greece, and the row is priced as Greece", () => {
    const out = run<{ draft: string; country: string; rows: string[]; price: number; checkout: number }>(`
      ${fns(...ACCT)}
      ${SCREEN}
      function isParcel() { return false; }
      function matchAcctPoint() { return false; }
      acctPickCountry("EU", "EE");   // first select: «Другая страна Европы»
      acctPickCountry("GR", "EU");   // second select: Greece
      var rows = methods();
      /* …and what the checkout itself charges for the same Greek courier:
         its first courier card, pre-selected */
      S.country = "EU"; S.countryIso = "GR";
      return {
        draft: S.acctForm.ship.country, country: acctShipCountry(), rows: rows.map(rowKind),
        price: acctShipPrice(rows[0]),
        checkout: shipRulePrice("courier", methodCarriers("courier")[0])
      };
    `, { shipCarrier: () => "" });
    expect(out.draft, "the draft fell back to the zone").toBe("GR");
    expect(out.country).toBe("GR");
    expect(out.rows).toEqual(["courier"]);
    expect(out.price, "the account and the checkout disagree on a Greek courier").toBe(out.checkout);
    expect(out.price).toBe(courierQuote("GR", COURIER_CARRIERS.GR[0]));
    // the fixture discriminates: a generic-Europe price would not pass
    expect(out.price).not.toBe(courierQuote("EU", COURIER_CARRIERS.GR[0]));
  });

  it("a saved Greek default opens the checkout on Greece, not on «Другая страна Европы»", () => {
    const out = run<{ country: string; iso: string; order: string; method: string }>(`
      ${fns(...ACCT)}
      ${SCREEN}
      function isParcel() { return false; }
      function matchAcctPoint() { return false; }
      S.cust = { shipPref: { country: "GR", method: "courier", carrier: "", machine: "" } };
      applyAcctShipPref();
      return { country: S.country, iso: S.countryIso, order: orderCountry(), method: S.ship.method };
    `);
    expect(out).toEqual({ country: "EU", iso: "GR", order: "GR", method: "courier" });
  });

  it("every country the shop delivers to survives account → saved → checkout", () => {
    /* Served = ANY method, a courier alone included — the union of the two
       carrier tables, «EU» aside (a zone, not a country). */
    const served = [...new Set([...Object.keys(CARRIERS_BY_COUNTRY), ...Object.keys(COURIER_CARRIERS)])]
      .filter((cc) => cc !== "EU");
    expect(served).toContain("GR");
    const broken: string[] = [];
    for (const cc of served) {
      const out = run<{ draft: string; order: string; acct: string[]; co: string[]; acctC: string[]; coC: string[] }>(`
        ${fns(...ACCT)}
        ${SCREEN}
        function isParcel() { return false; }
        function matchAcctPoint() { return false; }
        if (shipZoneOf(CC) === "EU") { acctPickCountry("EU", "EE"); acctPickCountry(CC, "EU"); }
        else acctPickCountry(CC, "EE");
        var draft = S.acctForm.ship;
        S.cust = { shipPref: draft };
        applyAcctShipPref();
        function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }).sort(); }
        return {
          draft: draft.country, order: orderCountry(),
          acct: uniq(methods().map(rowKind)), co: uniq(deliveryFor(orderCountry()).map(function (d) { return d.k; })),
          acctC: methods().filter(function (x) { return x.pm; }).map(function (x) { return x.pm; }),
          coC: carriersFor(orderCountry())
        };
      `, { CC: cc });
      if (out.draft !== cc || out.order !== cc) broken.push(`${cc}: saved ${out.draft}, checkout ${out.order}`);
      else if (out.acct.join() !== out.co.join()) broken.push(`${cc}: account offers ${out.acct}, checkout ${out.co}`);
      else if (out.acctC.join() !== out.coC.join()) broken.push(`${cc}: account carriers ${out.acctC}, checkout ${out.coC}`);
    }
    expect(broken).toEqual([]);
  });

  it("the account's rows follow the owner's «Где предлагать пакомат» like the checkout's", () => {
    const off = { ...DEFAULT_SHIPPING_RULES, pickupOff: ["IT"] };
    const out = run<string[]>(`
      ${fns(...ACCT)}
      ${SCREEN}
      return acctMethods("IT").map(rowKind);
    `, { SHIP_RULES: off });
    expect(out).toEqual(["courier"]);
  });
});

/* ------------------------------------------------------------------------ */

describe("a default saved in the account wins over an earlier tap in the checkout", () => {
  /* The account's own save runs for real: acctQueue → acctNext → the PATCH
     answer → applyAcctShipPref. Only fetch and the painting are stubbed. */
  async function saveAfterCheckoutTap(fetchBody: unknown) {
    const state = run<() => { country: string; iso: string; carrier: string; point: unknown; picked: boolean; line: string }>(`
      ${fns(...ACCT, "acctQueue", "acctNext", "acctFieldDirty", "shipKey", "acctFieldPayload", "acctSeedField", "shipDraftFrom")}
      ${SCREEN.replace('function acctShipChanged() { CALLS.push("save"); }', "")}
      var acctQ = [], acctInflight = "", acctGen = 0;
      function acctSt(f, st) { S.acctSt[f] = st; }
      function acctForget() {} function toast() {} function acctSyncNewsletter() {}
      function isParcel() { return false; }
      function matchAcctPoint() { return false; }
      var fetch = FETCH;
      /* the shopper was in the checkout first: an Estonian Omniva locker, by hand */
      S.cust = { shipPref: { country: "EE", method: "parcel", carrier: "omniva", machine: "Peetri" } };
      S.ship = { method: "parcel", carrier: "omniva", point: { id: "p1", name: "Peetri" } };
      S.shipPicked = true;
      /* …then set Italy in the account */
      S.acctForm.ship = { country: "IT", method: "parcel", carrier: "dpd", machine: "" };
      acctQueue("ship");
      return function () {
        return { country: S.country, iso: S.countryIso, carrier: S.ship.carrier, point: S.ship.point,
          picked: S.shipPicked, line: S.acctSt.ship };
      };
    `, {
      FETCH: () => Promise.resolve({ status: 200, json: () => Promise.resolve(fetchBody) }),
    });
    await new Promise((r) => setTimeout(r, 10));
    return state();
  }

  it("the checkout opens on Italy after the account saved it", async () => {
    const out = await saveAfterCheckoutTap({
      ok: true, customer: { shipPref: { country: "IT", method: "parcel", carrier: "dpd", machine: "" } },
    });
    expect(out.line).toBe("saved");
    expect(out.country, "the checkout kept the tap from before the save").toBe("EU");
    expect(out.iso).toBe("IT");
    expect(out.carrier).toBe("dpd");
    expect(out.point, "an Estonian machine under an Italian default").toBeNull();
    // …and the checkout is back to «not chosen by hand», so the saved machine can be matched
    expect(out.picked).toBe(false);
  });

  it("a profile that merely arrives still leaves the shopper's own hand alone", () => {
    const out = run<{ country: string; carrier: string }>(`
      ${fns(...ACCT)}
      ${SCREEN}
      function isParcel() { return false; }
      function matchAcctPoint() { return false; }
      S.ship = { method: "parcel", carrier: "omniva", point: null };
      S.shipPicked = true;
      S.cust = { shipPref: { country: "IT", method: "parcel", carrier: "dpd", machine: "" } };
      applyAcctShipPref();
      return { country: S.country, carrier: S.ship.carrier };
    `);
    expect(out).toEqual({ country: "EE", carrier: "omniva" });
  });

  it("picking the real country behind «Другая страна Европы» is a choice by hand too", () => {
    /* [data-country] always said so; its second select did not, so a profile
       landing after the shopper picked Italy there put the default over it. */
    const at = src.indexOf('if (t.matches("[data-countryiso]")) {');
    expect(at, "the checkout's second country select handler moved").toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("render();", at));
    expect(block).toContain("S.shipPicked = true;");
  });
});

/* ------------------------------------------------------------------------ */

describe("the country selects move with the preference", () => {
  it("a preference landing on the checkout repaints the selects as well as the delivery block", () => {
    const calls = run<string[]>(`
      ${fns(...ACCT)}
      ${SCREEN}
      function isParcel() { return false; }
      function matchAcctPoint() { return false; }
      S.screen = "checkout"; S.coStep = 2;
      S.cust = { shipPref: { country: "IT", method: "parcel", carrier: "dpd", machine: "" } };
      applyAcctShipPref();
      return CALLS;
    `);
    expect(calls).toContain("country");
    expect(calls).toContain("delivery");
  });

  it("the selects are one block drawn from S — Italy behind «Другая страна Европы»", () => {
    const html = run<string>(`
      ${fns("countryBlockHTML", "europeOptionsHTML", "countryOff", "countryName", "esc")}
      var coBlockHTML = { delivery: "", payment: "", summary: "", country: "" };
      function trText(s) { return s; }
      S.country = "EU"; S.countryIso = "IT";
      return countryBlockHTML();
    `);
    expect(html).toContain('<option value="EU" selected>');
    expect(html).toContain("data-countryiso");
    expect(html).toContain('<option value="IT" selected>');
    expect(html).not.toContain('<option value="EE" selected>');
  });

  it("step 2 draws them inside the block patchCountry() rewrites", () => {
    expect(slice("screenCheckout")).toContain("'<div data-co-country>' + countryBlockHTML() + \"</div>\"");
    expect(slice("patchCountry")).toContain('patchBlock("[data-co-country]", countryBlockHTML(), was)');
  });
});

/* ------------------------------------------------------------------------ */

describe("a country too big for one list gets the checkout's own search", () => {
  const IT_POINTS = [
    { id: "it-1", name: "MILANO, VIA ROMA 1", address: "Via Roma 1", city: "Milano", zip: "20121", type: "parcel_machine" },
    { id: "it-2", name: "TORINO, VIA PO 2", address: "Via Po 2", city: "Torino", zip: "10123", type: "parcel_machine" },
  ];
  const BIG = `
    S.acctForm.ship = { country: "IT", method: "parcel", carrier: "dpd", machine: MACHINE };
    POINTS.by["dpd:IT"] = LIST; POINTS.big["dpd:IT"] = 12048;
  `;
  const acctPoint = (machine: string, extra = "") => run<string>(`
    ${fns(...ACCT, ...PICKER)}
    ${SCREEN}
    ${BIG}
    ${extra}
    return acctPointHTML();
  `, { MACHINE: machine, LIST: IT_POINTS });

  it("offers a locker button that opens the search, not a sentence", () => {
    const html = acctPoint("");
    expect(html).toContain('data-pointopen="acct"');
    expect(html).toContain("Выберите пакомат");
    expect(html).toContain("Пакомат по умолчанию — 12048 точек");
    expect(html).not.toContain("слишком много для списка");
    // 12 048 <option>s is exactly what this replaces
    expect(html).not.toContain("data-acctmachine");
  });

  it("names the saved locker on the button once there is one", () => {
    const html = acctPoint("MILANO, VIA ROMA 1");
    expect(html).toContain("MILANO, VIA ROMA 1");
    expect(html).toContain("pointbtn--set");
    expect(html).toContain("изменить");
  });

  it("never draws the sheet itself — the sheet has a slot of its own", () => {
    /* It was drawn in here on the first round, and every repaint of this
       block rebuilt it — the search box and the caret in it with it. See
       tests/point-sheet-typing.test.ts. */
    expect(acctPoint("", 'S.pointOpen = true; S.pointFor = "acct";')).not.toContain("<SHEET>");
    expect(slice("acctPointHTML")).not.toContain("pointSheet()");
  });

  it("a list that fits gets the same button — not a select", () => {
    /* It kept a <select> until 23.09.2026 — see «every list gets the
       picker» below for the four countries that were left with one. */
    const html = acctPoint("", 'POINTS.big["dpd:IT"] = 0;');
    expect(html).toContain('data-pointopen="acct"');
    expect(html).not.toContain("<select");
    expect(html).toContain("Пакомат по умолчанию — 2 точки");
  });

  it("the old sentence is gone from the shop", () => {
    expect(src.includes("Пакомат для этой страны выбирается при оформлении заказа")).toBe(false);
  });

  it("the sheet asks about the account's carrier and country while the account has it open", () => {
    const keys = run<{ acct: string; closed: string; checkout: string }>(`
      ${fns(...ACCT, "pointsKey", "coPointsKey")}
      ${SCREEN}
      S.ship.carrier = "omniva";
      S.acctForm.ship = { country: "IT", method: "parcel", carrier: "dpd", machine: "" };
      S.pointOpen = true; S.pointFor = "acct";
      var acct = pointsKey();
      S.pointOpen = false;
      var closed = pointsKey();
      S.pointOpen = true; S.screen = "checkout";
      return { acct: acct, closed: closed, checkout: pointsKey() };
    `, { shipCarrier: () => "omniva" });
    expect(keys.acct).toBe("dpd:IT");
    // the checkout's own key the moment the account's sheet is not the one open
    expect(keys.closed).toBe("omniva:EE");
    expect(keys.checkout).toBe("omniva:EE");
  });

  it("typing a postcode in the account's sheet asks the server, for Italy's DPD", () => {
    const urls = run<string[]>(`
      ${fns(...ACCT, "pointsKey", "coPointsKey", "pointsSearch", "pointsFind")}
      ${SCREEN}
      var URLS = [];
      var fetch = function (u) { URLS.push(u); return new Promise(function () {}); };
      var POINT_Q_MS = 300, pointQT = 0, pointQFor = "";
      function repaintPicker() {}
      function pointsFoundArrived() {}
      ${BIG}
      S.pointOpen = true; S.pointFor = "acct";
      POINTS.q = "20121";
      pointsSearch();
      return URLS;
    `, {
      MACHINE: "", LIST: IT_POINTS, shipCarrier: () => "omniva",
      // the typing pause, elapsed at once — tests/point-sheet-typing.test.ts times it for real
      setTimeout: (fn: () => void) => { fn(); return 1; }, clearTimeout: () => {},
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("country=IT&carrier=dpd&q=20121");
  });

  it("opening it from the account loads the account's carrier, not the checkout's four", () => {
    const out = run<{ calls: string[]; forAcct: string; open: boolean }>(`
      ${fns(...ACCT, "openPointSheet")}
      ${SCREEN}
      function repaintPicker() { CALLS.push("repaint"); }
      S.acctForm.ship = { country: "IT", method: "parcel", carrier: "dpd", machine: "" };
      openPointSheet("acct");
      return { calls: CALLS, forAcct: S.pointFor, open: S.pointOpen };
    `);
    expect(out.calls).toContain("load:dpd:IT");
    expect(out.calls).not.toContain("loadPoints");
    expect(out.forAcct).toBe("acct");
    expect(out.open).toBe(true);
  });

  it("a tap in that sheet sets the account's locker — not the order's", () => {
    const out = run<{ machine: string; point: unknown; picked: boolean; open: boolean; calls: string[] }>(`
      ${fns(...ACCT, "pickPoint")}
      ${SCREEN}
      function repaintPicker() { CALLS.push("repaint"); }
      S.acctForm.ship = { country: "IT", method: "parcel", carrier: "dpd", machine: "" };
      S.pointOpen = true; S.pointFor = "acct";
      pickPoint({ id: "it-1", name: "MILANO, VIA ROMA 1" });
      return { machine: S.acctForm.ship.machine, point: S.ship.point, picked: S.shipPicked, open: S.pointOpen, calls: CALLS };
    `);
    expect(out.machine).toBe("MILANO, VIA ROMA 1");
    expect(out.point, "the account's pick landed on the order in progress").toBeNull();
    expect(out.picked).toBe(false);
    expect(out.open).toBe(false);
    expect(out.calls).toContain("save");
  });

  it("the sheet's rows mark the account's locker as the chosen one", () => {
    const html = run<string>(`
      ${fns(...ACCT, "pointRows", "pointChosen", "pointsKey", "coPointsKey", "pointsList", "pointsFiltered",
        "pointsMatching", "pointsSearch", "pointsFind", "searchPoints", "matchesWords", "isPostcodeQuery",
        "normZip", "pointZip", "rankByPostcode", "pointKind", "pointKindLine", "esc")}
      ${SCREEN}
      function repaintPicker() {}
      function pointsFoundArrived() {}
      ${BIG}
      POINTS.big["dpd:IT"] = 0;
      S.pointOpen = true; S.pointFor = "acct";
      return pointRows();
    `, { MACHINE: "TORINO, VIA PO 2", LIST: IT_POINTS, shipCarrier: () => "omniva" });
    expect(html).toMatch(/data-pointpick="it-2" aria-current="true"/);
    expect(html).not.toMatch(/data-pointpick="it-1" aria-current/);
  });

  it("a list landing while that sheet is open patches the list, not the whole account", () => {
    const calls = (open: boolean) => run<string[]>(`
      ${fns("pointsArrived", "pointsForAcct")}
      ${SCREEN.replace('function acctShipChanged() { CALLS.push("save"); }', "function acctShipChanged() {}")}
      function matchAcctPoint() { return false; }
      S.pointOpen = OPEN; S.pointFor = "acct";
      pointsArrived();
      return CALLS;
    `, { OPEN: open });
    expect(calls(true)).toEqual(["acctpoint", "list"]);
    expect(calls(false)).toEqual(["render"]);
  });

  it("the account's sheet repaints the account's slot", () => {
    const calls = (screen: string) => run<string[]>(`
      ${fns("repaintPicker")}
      ${SCREEN}
      S.screen = SCREEN_NAME;
      repaintPicker("[data-pointq]");
      return CALLS;
    `, { SCREEN_NAME: screen });
    expect(calls("account")).toEqual(["acctpoint", "sheet"]);
    expect(calls("checkout")).toEqual(["delivery", "sheet"]);
  });

  it("a background render leaves the sheet — and its search box — alone", () => {
    /* render() only asks the sheet's slot whether what it shows changed
       (paintPointSheet); the body it rewrites no longer holds the sheet. */
    expect(slice("renderImpl")).toContain("if (paintPointSheet() && S.pointOpen");
    expect(slice("deliveryPicker")).not.toContain("pointSheet()");
  });
});

/* ------------------------------------------------------------------------ */

describe("a locker found by the server's search is a locker the checkout can hold", () => {
  const PL_SLICE = [
    { id: "pl-1", name: "ŁÓDŹ, FRANCISZKAŃSKA 31A", address: "FRANCISZKAŃSKA 31A", city: "ŁÓDŹ", zip: "91433" },
    { id: "pl-2", name: "WARSZAWA, MARSZAŁKOWSKA 10", address: "MARSZAŁKOWSKA 10", city: "WARSZAWA", zip: "00950" },
  ];
  const KRAKOW = { id: "pl-krk", name: "KRAKÓW, JANA PAWŁA II 5", address: "JANA PAWŁA II 5", city: "KRAKÓW", zip: "30444" };
  const SEARCH = [
    "pointsKey", "coPointsKey", "pointsList", "pointsMatching", "pointsSearch", "pointsFind", "pointsFoundArrived",
    "searchPoints", "matchesWords", "isPostcodeQuery", "normZip", "pointZip", "rankByPostcode",
  ];

  it("a row from the search's answer can be picked — not only one from the first slice", () => {
    /* Poland's first 1 500 of 33 603 hold no Kraków; the rows the shopper
       taps come from the server's answer, and pointById() looked only in
       the slice — the tap closed the sheet with nothing chosen. */
    const got = run<unknown>(`
      ${fns(...ACCT, ...SEARCH, "pointById")}
      ${SCREEN}
      function repaintPicker() {}
      S.screen = "checkout"; S.country = "EU"; S.countryIso = "PL";
      POINTS.by["dpd:PL"] = SLICE; POINTS.big["dpd:PL"] = 33603;
      POINTS.q = "krak";
      POINTS.found["dpd:PL|krak"] = [KRAKOW];
      return pointById("pl-krk");
    `, { SLICE: PL_SLICE, KRAKOW, shipCarrier: () => "dpd" });
    expect(got).toEqual(KRAKOW);
  });

  it("a saved locker outside the first slice is asked for by name, and chosen when it comes", async () => {
    const urls: string[] = [];
    const state = run<() => { point: unknown; calls: string[] }>(`
      ${fns(...ACCT, ...SEARCH, "matchAcctPoint", "pointNamed")}
      ${SCREEN}
      function repaintPicker() { CALLS.push("repaint"); }
      function isParcel() { return true; }
      var fetch = FETCH;
      S.screen = "checkout"; S.country = "EU"; S.countryIso = "PL";
      S.ship = { method: "parcel", carrier: "dpd", point: null };
      S.cust = { shipPref: { country: "PL", method: "parcel", carrier: "dpd", machine: "KRAKÓW, JANA PAWŁA II 5" } };
      POINTS.by["dpd:PL"] = SLICE; POINTS.big["dpd:PL"] = 33603;
      var first = matchAcctPoint();
      if (first) throw new Error("matched a machine that is not in the slice");
      return function () { return { point: S.ship.point, calls: CALLS }; };
    `, {
      SLICE: PL_SLICE,
      shipCarrier: () => "dpd",
      FETCH: (u: string) => {
        urls.push(u);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, points: [PL_SLICE[0], KRAKOW] }) });
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("country=PL&carrier=dpd&q=" + encodeURIComponent("kraków, jana pawła ii 5"));
    const out = state();
    expect(out.point).toEqual(KRAKOW);
    expect(out.calls).toContain("delivery");
  });
});

/* ------------------------------------------------------------------------ */

describe("every list gets the picker — Estonia as much as Italy", () => {
  /* Dim on staging, 23.09.2026: «I cannot search for parcel lockers for
     Estonia — but I can for Italy for example in my account.» A list that
     fitted in one download still got a <select> — every name of the
     carrier, alphabetical, nothing to type into. */
  const EE_POINTS = [
    { id: "om-1", name: "Tallinna Kristiine keskuse pakiautomaat", address: "Endla 45", city: "Tallinn", zip: "10615", type: "parcel_machine", lat: 59.427, lng: 24.724 },
    { id: "om-2", name: "Tartu Lõunakeskuse pakiautomaat", address: "Ringtee 75", city: "Tartu", zip: "50501", type: "parcel_machine", lat: 58.358, lng: 26.678 },
    { id: "om-3", name: "Pärnu Kaubamajaka pakiautomaat", address: "Papiniidu 8", city: "Pärnu", zip: "80042", type: "parcel_machine", lat: 58.37, lng: 24.531 },
  ];

  type Block = { html: string; carrier: string; calls: string[] };
  /** The block over the draft's parcel row in `cc` — the first carrier, or
      `carrier` — with `list` as that carrier's feed (null: still in flight),
      `big` its country-wide count when the feed came capped. */
  const blockFor = (cc: string, o: { big?: number; list?: unknown; machine?: string; carrier?: string; extra?: string } = {}) => run<Block>(`
    ${fns(...ACCT, ...PICKER)}
    ${SCREEN}
    var row = acctMethods(CC).filter(function (x) { return x.pm && (!CARRIER || x.pm === CARRIER); })[0];
    S.acctForm.ship = { country: CC, method: "parcel", carrier: row.pm, machine: MACHINE };
    if (LIST) POINTS.by[row.pm + ":" + CC] = LIST;
    POINTS.big[row.pm + ":" + CC] = BIG;
    ${o.extra ?? ""}
    return { html: acctPointHTML(), carrier: row.pm, calls: CALLS };
  `, { CC: cc, BIG: o.big ?? 0, LIST: o.list === undefined ? EE_POINTS : o.list, MACHINE: o.machine ?? "", CARRIER: o.carrier ?? "" });

  for (const cc of ["EE", "LV", "LT", "FI"]) {
    it(`${cc}: a list that fits in one download gets the checkout's button, not a select`, () => {
      const out = blockFor(cc);
      expect(out.html).toContain('data-pointopen="acct"');
      expect(out.html).toContain("Выберите пакомат");
      expect(out.html).toContain("Поиск по адресу и городу");
      expect(out.html).toContain("Пакомат по умолчанию — 3 точки");
      expect(out.html).not.toContain("<select");
      expect(out.html).not.toContain("<option");
    });
  }

  it("IT: the same button, counted over the whole country", () => {
    const out = blockFor("IT", { carrier: "dpd", big: 12048 });
    expect(out.carrier).toBe("dpd");
    expect(out.html).toContain('data-pointopen="acct"');
    expect(out.html).toContain("Пакомат по умолчанию — 12048 точек");
    expect(out.html).not.toContain("<select");
  });

  it("every carrier of every locker country draws the button, never a select", () => {
    const selects: string[] = [];
    for (const cc of Object.keys(CARRIERS_BY_COUNTRY)) {
      for (const carrier of CARRIERS_BY_COUNTRY[cc]) {
        const html = blockFor(cc, { carrier }).html;
        if (!html.includes('data-pointopen="acct"') || html.includes("<select")) selects.push(`${carrier}:${cc}`);
      }
    }
    expect(selects).toEqual([]);
  });

  it("names the saved locker with its kind and address", () => {
    const html = blockFor("EE", { carrier: "omniva", machine: "Tartu Lõunakeskuse pakiautomaat" }).html;
    expect(html).toContain("pointbtn--set");
    expect(html).toContain('<span class="pointbtn__nm">Tartu Lõunakeskuse pakiautomaat</span>');
    expect(html).toContain("Пакомат · Ringtee 75, Tartu");
    expect(html).toContain("изменить");
  });

  it("a whole list that no longer has the saved locker shows nothing chosen, as the select did", () => {
    const html = blockFor("EE", { carrier: "omniva", machine: "Suletud pakiautomaat" }).html;
    expect(html).not.toContain("pointbtn--set");
    expect(html).not.toContain("Suletud pakiautomaat");
    expect(html).toContain("Выберите пакомат");
  });

  it("a capped list cannot say a locker is gone — the saved name stands", () => {
    const html = blockFor("IT", { carrier: "dpd", big: 12048, machine: "ROMA, VIA APPIA 7" }).html;
    expect(html).toContain("pointbtn--set");
    expect(html).toContain("ROMA, VIA APPIA 7");
  });

  it("…and names its address once a search brought that locker back", () => {
    const roma = { id: "it-9", name: "ROMA, VIA APPIA 7", address: "Via Appia 7", city: "Roma", zip: "00179", type: "parcel_machine" };
    const html = blockFor("IT", {
      carrier: "dpd", big: 12048, machine: "ROMA, VIA APPIA 7",
      extra: `POINTS.found["dpd:IT|roma, via appia 7"] = [${JSON.stringify(roma)}];`,
    }).html;
    expect(html).toContain("Пакомат · Via Appia 7, Roma");
  });

  it("says the list is on its way, and asks for it", () => {
    const out = blockFor("EE", { carrier: "omniva", list: null });
    expect(out.html).toContain('data-pointopen="acct"');
    expect(out.html).toContain("Загружаем список…");
    expect(out.html).toContain(">Пакомат по умолчанию</span>");
    expect(out.calls).toContain("load:omniva:EE");
  });

  it("a feed that failed says so — the tap asks again", () => {
    const html = blockFor("EE", { carrier: "omniva", list: null, extra: 'POINTS.err["omniva:EE"] = true;' }).html;
    expect(html).toContain("Список не загрузился — нажмите ещё раз");
  });

  it("a carrier with nothing behind it draws no picker at all", () => {
    expect(blockFor("EE", { carrier: "omniva", list: [] }).html).toBe("");
  });

  /** The sheet the account opens, drawn for real over the draft's list. */
  const sheetFor = (list: unknown, view = "list") => run<string>(`
    ${fns(...ACCT, "pointSheet", "pointsHaveMap", "pointGeo", "pointsMatching", "pointsSearch", "pointsSearchPending",
      "pointsList", "pointsKey", "coPointsKey", "pointRows", "pointChosen", "pointsFiltered", "searchPoints", "matchesWords",
      "isPostcodeQuery", "normZip", "pointZip", "rankByPostcode", "pointCountText", "pointTooManyHTML", "carrierLabel",
      "pointsMixed", "pointKind", "pointKindLine", "points", "pl", "esc")}
    ${SCREEN.replace('function pointSheet() { return "<SHEET>"; }', "")}
    var pointPaint = {};
    S.acctForm.ship = { country: "EE", method: "parcel", carrier: "omniva", machine: "" };
    POINTS.by["omniva:EE"] = LIST; POINTS.view = VIEW;
    S.pointOpen = true; S.pointFor = "acct";
    return pointSheet();
  `, { LIST: list, VIEW: view, shipCarrier: () => "dpd" });

  it("the account's sheet is the checkout's: search box, the draft's carrier, its rows", () => {
    const html = sheetFor(EE_POINTS);
    expect(html).toContain("data-pointq");
    expect(html).toContain('placeholder="Индекс, город или улица"');
    expect(html).toContain("Пакомат Omniva");
    expect(html).toContain('data-pointpick="om-1"');
    expect(html).toContain('data-pointpick="om-3"');
  });

  it("…with the map where the points have coordinates, and without it where they have none", () => {
    expect(sheetFor(EE_POINTS)).toContain("data-pointview");
    expect(sheetFor(EE_POINTS, "map")).toContain('id="pointmap"');
    const bare = EE_POINTS.map(({ lat: _lat, lng: _lng, ...p }) => p);
    expect(sheetFor(bare)).not.toContain("data-pointview");
    expect(sheetFor(bare, "map")).not.toContain('id="pointmap"');
  });

  it("an Estonian locker picked in the account is saved, and the checkout opens on it", async () => {
    const bodies: Array<{ shipPref?: unknown }> = [];
    const state = run<() => Record<string, unknown>>(`
      ${fns(...ACCT, ...PICKER, "openPointSheet", "pickPoint", "acctShipChanged", "acctQueue", "acctNext", "acctFieldDirty",
        "shipKey", "acctFieldPayload", "acctSeedField", "shipDraftFrom", "matchAcctPoint", "coPointsKey", "shipCarrier",
        "shipMethod", "isParcel", "giftOnlyCart", "pointField", "carrierLabel", "pointsKey", "pointsList", "pointsMixed", "pickWord")}
      ${SCREEN.replace('function acctShipChanged() { CALLS.push("save"); }', "")}
      var acctQ = [], acctInflight = "", acctGen = 0;
      function acctSt(f, st) { S.acctSt[f] = st; }
      function acctForget() {} function toast() {} function acctSyncNewsletter() {}
      function repaintPicker() { CALLS.push("repaint"); }
      var fetch = FETCH;
      S.cart = [];
      /* what the row held before: the counter in Tallinn */
      S.cust = { shipPref: { country: "EE", method: "pickup", carrier: "", machine: "" } };
      POINTS.by["omniva:EE"] = LIST;
      /* the «Пакомат Omniva» row, tapped — a parcel row waits for its machine */
      S.acctForm.ship = acctShipFromRow("EE", acctMethods("EE").filter(function (x) { return x.pm === "omniva"; })[0]);
      acctShipChanged();
      var waiting = S.acctSt.ship, before = acctPointHTML();
      openPointSheet("acct");
      var opened = S.pointOpen && S.pointFor === "acct";
      pickPoint(LIST[1]);
      return function () {
        var block = acctPointHTML();
        S.screen = "checkout";
        return { waiting: waiting, before: before, opened: opened, line: S.acctSt.ship, block: block,
          country: S.country, method: S.ship.method, carrier: S.ship.carrier, point: S.ship.point,
          picked: S.shipPicked, field: pointField() };
      };
    `, {
      LIST: EE_POINTS,
      FETCH: (_url: string, init: { body: string }) => {
        const body = JSON.parse(String(init.body)) as { shipPref?: unknown };
        bodies.push(body);
        return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, customer: { shipPref: body.shipPref } }) });
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    const out = state();
    expect(out.waiting, "a parcel row with no locker saved itself").toBe("need");
    expect(out.before).toContain('data-pointopen="acct"');
    expect(out.opened).toBe(true);
    // one PATCH, carrying the locker picked in the sheet
    expect(bodies).toHaveLength(1);
    expect(bodies[0].shipPref).toEqual({ country: "EE", method: "parcel", carrier: "omniva", machine: "Tartu Lõunakeskuse pakiautomaat" });
    expect(out.line).toBe("saved");
    expect(out.block).toContain("Tartu Lõunakeskuse pakiautomaat");
    expect(out.block).toContain("pointbtn--set");
    // …and the checkout starts on it: Estonia, Omniva, that very locker
    expect(out.country).toBe("EE");
    expect(out.method).toBe("parcel");
    expect(out.carrier).toBe("omniva");
    expect(out.point).toEqual(EE_POINTS[1]);
    expect(out.picked, "the default must not count as the shopper's own hand").toBe(false);
    expect(out.field).toContain("Tartu Lõunakeskuse pakiautomaat");
    expect(out.field).toContain("Пакомат · Ringtee 75, Tartu");
  });
});

describe("the zone mirror the harness leans on", () => {
  it("Greece is a European country on both sides", () => {
    expect(shippingZone("GR")).toBe("EU");
  });
});
