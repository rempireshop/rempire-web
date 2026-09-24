/**
 * «Мой кабинет»: what is typed is saved without leaving the box.
 *
 * Dim, 24.09.2026, on /test «acct-default-delivery»:
 *
 *   «not sure, if after typing and going away from page the information is
 *   stored — me as a developer I know that after I typed and then did one
 *   click with mouse, it then stored and gave me the message, not sure how
 *   regular users will do it or if the click to.. for example to checkout or
 *   somewhere else stores already typed address data in the account.»
 *
 * The profile boxes and the courier's address saved on `change` — a blur. The
 * phone's Back, switching apps and closing the tab are not blurs, so the typing
 * died with the page. Now:
 *
 *   1. a box saves itself a moment after the typing stops (ACCT_AUTOSAVE_MS),
 *      under the same «Сохраняем…» / «Сохранено ✓» line;
 *   2. a pause is not a verdict — a phone still too short and half an address
 *      wait quietly, the blur says what is missing;
 *   3. leaving the screen (go(), the phone's Back) sends what is still waiting
 *      at once, and a page going away sends the queue with keepalive;
 *   4. the blur after a pause-save changes nothing — «Сохранено ✓» stays;
 *   5. a profile read landing while a save is on its way does not put the old
 *      value back over the typing (the checkout re-reads it as it opens).
 *
 * The storefront's own functions, sliced out of public/shop2/app.js and run
 * over stubs with a fake clock, as tests/acct-default-delivery.test.ts does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** The pause, read from the file — the test follows the number, not a copy of it. */
const PAUSE = Number((src.match(/var ACCT_AUTOSAVE_MS = (\d+);/) || [])[1]);

type Sent = { url: string; method: string; body: Record<string, unknown>; keepalive: boolean };
type Shop = {
  S: Record<string, any>;
  sent: Sent[];
  st: Array<[string, string]>;
  /** Answer the oldest request still out, the way the route does: the row with the fields written. */
  answer: () => Promise<void>;
  typed: (f: string, v: string) => void;
  addrTyped: (k: string, v: string) => void;
  left: (f: string) => void;
  go: (screen: string) => void;
  leave: () => void;
  seed: () => void;
};

const SAVED = {
  email: "mari@example.com", name: "Mari", phone: "+372 5000 0000", birthday: "", marketing: false,
  shipPref: { country: "EE", method: "courier", carrier: "", machine: "", address: { addr: "Pikk 1", zip: "10123", city: "Tallinn" } },
};

function shop(): Shop {
  const sent: Sent[] = [];
  const out: Array<(r: unknown) => void> = [];
  const body = `
    var S = {
      screen: "account", lang: "RU", pointFor: "", cust: JSON.parse(JSON.stringify(SAVED)),
      acctForm: { name: "", phone: "", birthday: "", marketing: false, ship: null },
      acctSt: { name: "", phone: "", birthday: "", marketing: "", ship: "" }
    };
    var st = [];
    var window = { scrollTo: function () {} };
    var document = { querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
    function noop() {}
    function acctSt(f, v) { S.acctSt[f] = v; st.push([f, v]); }
    function acctSeedField(f) {
      var c = S.cust;
      if (f === "ship") { S.acctForm.ship = shipDraftFrom(c.shipPref); return; }
      S.acctForm[f] = c[f] || "";
    }
    function applyAcctShipPref() {}
    function acctSyncNewsletter() {}
    function acctForget() {}
    function acctMachinesTooMany() { return false; }
    function render() {}
    function toast() {}
    function navTo() {}
    function trackNav() {}
    function track() {}
    function cartSum() { return 0; }
    function acctRefresh() {}
    var acctQ = [], acctInflight = "", acctGen = 0, acctBirthdayT = 0, acctAutoT = {};
    var ACCT_AUTOSAVE_MS = ${PAUSE};
    ${[
      "shipDraftFrom", "acctAddrOf", "acctAddrWhole", "acctAddrPartial", "acctAddrKey", "shipKey",
      "acctFieldDirty", "acctFieldPayload", "acctQueue", "acctPending", "acctNext", "acctFieldChange",
      "acctPhoneShort", "acctShipChanged", "paintAcctAddr", "acctTyped", "acctAddrTyped", "acctAutoSave",
      "acctAutoRun", "acctFlush", "acctLeave", "acctSeedForm", "go",
    ].map(slice).join("\n")}
    acctSeedForm();
    return {
      S: S, st: st, typed: acctTyped, addrTyped: acctAddrTyped, go: go, leave: acctLeave, seed: acctSeedForm,
      left: function (f) { acctFieldChange(f, { validity: { valid: true } }); }
    };
  `;
  const fetchStub = (url: string, init: { method: string; body: string; keepalive?: boolean }) => {
    sent.push({ url, method: init.method, body: JSON.parse(init.body), keepalive: !!init.keepalive });
    return new Promise((resolve) => out.push(resolve));
  };
  // This repository's own source plus fixed stub text — no outside input.
  const made = new Function("SAVED", "fetch", body)(SAVED, fetchStub) as Omit<Shop, "sent" | "answer" | "addrTyped"> & {
    addrTyped: Shop["addrTyped"];
  };
  const answer = async () => {
    const i = sent.length - out.length;
    const req = sent[i];
    const resolve = out.shift();
    if (!req || !resolve) throw new Error("no request is out");
    const customer = { ...made.S.cust, ...req.body };
    if ("shipPref" in req.body) customer.shipPref = req.body.shipPref;
    resolve({ status: 200, json: () => Promise.resolve({ ok: true, customer }) });
    await vi.advanceTimersByTimeAsync(0);
  };
  return { ...made, sent, answer };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("a pause in typing saves the box — no blur needed", () => {
  it("the pause is short: under a second", () => {
    expect(PAUSE).toBeGreaterThanOrEqual(500);
    expect(PAUSE).toBeLessThanOrEqual(1000);
  });

  it("a typed name is PATCHed once the typing stops, and says «Сохранено ✓»", async () => {
    const s = shop();
    s.typed("name", "Mar"); vi.advanceTimersByTime(PAUSE - 100);
    s.typed("name", "Maria");                     // still typing: the clock starts again
    vi.advanceTimersByTime(PAUSE - 1);
    expect(s.sent, "a save left in the middle of the typing").toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ url: "/api/account/me/", method: "PATCH", body: { lang: "RU", name: "Maria" } });
    expect(s.S.acctSt.name).toBe("busy");

    await s.answer();
    expect(s.S.acctSt.name).toBe("saved");
    expect(s.S.cust.name).toBe("Maria");
  });

  it("the courier's whole address saves after a pause as «Доставка по умолчанию»", async () => {
    const s = shop();
    s.addrTyped("addr", "Narva mnt 5");
    vi.advanceTimersByTime(PAUSE);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].body.shipPref).toMatchObject({ method: "courier", address: { addr: "Narva mnt 5", zip: "10123", city: "Tallinn" } });
    await s.answer();
    expect(s.S.acctSt.ship).toBe("saved");
  });

  it("a pause is not a verdict: a short phone and half an address wait, quietly", () => {
    const s = shop();
    s.typed("phone", "+372 5");
    s.addrTyped("zip", ""); s.addrTyped("city", "");  // only «Адрес» left in the boxes
    vi.advanceTimersByTime(PAUSE * 3);
    expect(s.sent).toHaveLength(0);
    expect(s.S.acctSt.phone, "a refusal was shown in the middle of typing").toBe("");
    expect(s.S.acctSt.ship).toBe("");
  });

  it("leaving the box after the pause-save sends nothing more — «Сохранено ✓» stays", async () => {
    const s = shop();
    s.typed("name", "Maria");
    vi.advanceTimersByTime(PAUSE);
    await s.answer();
    s.left("name");
    expect(s.sent).toHaveLength(1);
    expect(s.S.acctSt.name).toBe("saved");
  });

  it("leaving the box before the pause saves at once, and only once", async () => {
    const s = shop();
    s.typed("name", "Maria");
    s.left("name");
    expect(s.sent).toHaveLength(1);
    vi.advanceTimersByTime(PAUSE * 2);
    expect(s.sent, "the pause's save went out as well as the blur's").toHaveLength(1);
  });
});

describe("going away sends what was typed", () => {
  it("opening the checkout straight from the typing saves it — no pause, no blur", () => {
    const s = shop();
    s.typed("phone", "+372 5123 4567");
    s.go("checkout");
    expect(s.sent, "the typed phone was left behind").toHaveLength(1);
    expect(s.sent[0].body).toMatchObject({ phone: "+372 5123 4567" });
  });

  it("the page going away sends the whole queue at once, with keepalive", () => {
    const s = shop();
    s.typed("name", "Maria");
    s.typed("phone", "+372 5123 4567");
    s.addrTyped("city", "Tartu");
    s.leave();
    // the first field goes through the queue; the rest cannot wait for its answer
    expect(s.sent.length).toBe(2);
    expect(s.sent.every((r) => r.keepalive), "a save without keepalive dies with the page").toBe(true);
    const all = Object.assign({}, ...s.sent.map((r) => r.body));
    expect(all).toMatchObject({ name: "Maria", phone: "+372 5123 4567" });
    expect((all.shipPref as { address: { city: string } }).address.city).toBe("Tartu");
  });

  it("a profile read landing mid-save does not put the old value back", async () => {
    const s = shop();
    s.typed("name", "Maria");
    s.typed("phone", "+372 5123 4567");
    s.go("checkout");                 // name out, phone queued — and the checkout re-reads the profile
    s.seed();                         // …which lands first, with the old row
    expect(s.S.acctForm.phone, "the typed phone was overwritten by the old profile").toBe("+372 5123 4567");
    await s.answer();                 // name lands
    expect(s.sent).toHaveLength(2);   // …and the phone is still sent
    expect(s.sent[1].body).toMatchObject({ phone: "+372 5123 4567" });
  });
});

describe("the wiring", () => {
  it("the input listener hands every profile keystroke to the autosave", () => {
    expect(src).toContain('else if (t.matches("[data-acctf]")) acctTyped(t.dataset.acctf, t.value);');
    expect(src).toContain('else if (t.matches("[data-acctaddr]")) acctAddrTyped(t.dataset.acctaddr, t.value);');
  });

  it("the phone's Back, a closed tab and a hidden page flush it", () => {
    const pop = src.slice(src.indexOf('window.addEventListener("popstate"'));
    expect(pop.slice(0, pop.indexOf("routeFromPath();"))).toContain("acctFlush();");
    expect(src).toContain('window.addEventListener("pagehide", acctLeave);');
    expect(src).toContain('document.addEventListener("visibilitychange", function () { if (document.hidden) acctLeave(); });');
  });
});
