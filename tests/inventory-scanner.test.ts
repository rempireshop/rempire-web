/**
 * The scanner's own decisions, as code rather than as feel.
 *
 * `tools/scan-bench.mjs` measured what the camera pipeline should do — read a
 * check-digit code on the first frame, decode a wider band at the sensor's own
 * resolution, turn that band back a few degrees every other pass — and
 * docs/audit/2026-09-07-scanner.md records the numbers. This file pins the
 * conclusions to the shipped code, so a later "tidy-up" cannot quietly put the
 * scanner back to the state Dim described as «hard and almost impossible».
 *
 * Same technique as tests/checkout-parity.test.ts and tests/checkout-banks.test.ts:
 * the functions are sliced out of public/shop2/app.js **by source text** and run
 * against stubs, so this tests the shop's own code and not a retyped copy that
 * could drift away from it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

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

/** …and `var <NAME> = <literal>;`, so the test reads the shipped number. */
function constant(name: string): string {
  const m = new RegExp(`\\bvar ${name} = ([^;\\n]+);`).exec(src);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  return `var ${name} = ${m[1]};`;
}

/* ------------------------------------------------------------------------ *
 * 1. When a camera read counts
 * ------------------------------------------------------------------------ */

/** Feeds a sequence of [code, format] pairs through the real
 *  scanCameraRead() and reports which of them reached handleScanCode(). */
function reads(seq: Array<[string, string]>): string[] {
  const body = `
    ${constant("SCAN_SELF_CHECKED")}
    var SCAN = { pendingCode: "", pendingN: 0, pendingAt: 0, everRead: false };
    var taken = [];
    function handleScanCode(code) { taken.push(code); }
    ${slice("scanCameraRead")}
    for (var i = 0; i < SEQ.length; i++) scanCameraRead(SEQ[i][0], SEQ[i][1]);
    return { taken: taken, everRead: SCAN.everRead };
  `;
  const fn = new Function("SEQ", body) as (s: Array<[string, string]>) => { taken: string[]; everRead: boolean };
  return fn(seq).taken;
}

describe("a code counts on the first frame when it checks out by itself", () => {
  /* The measured reason this changed: at the rate a phone decodes, ONE frame
     lands inside a second ~99 % of the time and two agreeing frames 46 %.
     The safety the second frame bought is already bought by the check digit,
     which the decoder refuses a code without. */
  it("EAN-13 is taken on one frame", () => {
    expect(reads([["4601234567893", "ean_13"]])).toEqual(["4601234567893"]);
  });

  it("EAN-8, UPC-A, UPC-E, CODE-128 and a QR code likewise — every format that carries its own check", () => {
    expect(reads([["12345670", "ean_8"]])).toHaveLength(1);
    expect(reads([["012345678905", "upc_a"]])).toHaveLength(1);
    expect(reads([["01234565", "upc_e"]])).toHaveLength(1);
    expect(reads([["RMP-0042", "code_128"]])).toHaveLength(1);
    expect(reads([["https://rempireshop.com/", "qr_code"]])).toHaveLength(1);
  });

  it("the native detector's upper-case format names count too", () => {
    expect(reads([["4601234567893", "EAN_13"]])).toEqual(["4601234567893"]);
  });

  /* ITF has no mandatory check digit at all and CODE-39's is optional, so a
     single misread there is a plausible number rather than an impossible one.
     Those keep the two-frame rule they always had. */
  it("ITF still has to be read twice, and the two frames must agree", () => {
    expect(reads([["12345678", "itf"]])).toEqual([]);
    expect(reads([["12345678", "itf"], ["12345678", "itf"]])).toEqual(["12345678"]);
    expect(reads([["12345678", "itf"], ["87654321", "itf"]])).toEqual([]);
  });

  it("CODE-39 and a format the decoder does not name are read twice as well", () => {
    expect(reads([["ABC123", "code_39"]])).toEqual([]);
    expect(reads([["ABC123", "code_39"], ["ABC123", "code_39"]])).toEqual(["ABC123"]);
    expect(reads([["ABC123", ""]])).toEqual([]);
  });

  it("an empty read is not a read", () => {
    expect(reads([["", "ean_13"]])).toEqual([]);
    expect(reads([["   ", "ean_13"]])).toEqual([]);
  });

  it("a half-finished two-frame code is dropped when a self-checked one arrives", () => {
    // otherwise the ITF frame would still be sitting in the buffer, ready to
    // be completed by an unrelated second one much later
    expect(reads([["12345678", "itf"], ["4601234567893", "ean_13"], ["12345678", "itf"]]))
      .toEqual(["4601234567893"]);
  });
});

/* ------------------------------------------------------------------------ *
 * 2. What the decoder is handed
 * ------------------------------------------------------------------------ */

type Draw = { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number };
type Cropped = { w: number; h: number; draws: Draw[]; rotations: number[] };

/** Runs the real scanCropCanvas() against a fake 2-D context and reports the
 *  geometry it asked for. */
function crop(vw: number, vh: number, tilt?: number): Cropped {
  const body = `
    var draws = [], rotations = [];
    var canvas = { width: 0, height: 0, getContext: function () {
      return {
        drawImage: function (img, sx, sy, sw, sh, dx, dy, dw, dh) { draws.push({ sx: sx, sy: sy, sw: sw, sh: sh, dw: dw, dh: dh }); },
        save: function () {}, restore: function () {}, translate: function () {},
        rotate: function (r) { rotations.push(r); }
      };
    } };
    var document = { createElement: function () { return canvas; } };
    var SCAN = { video: { videoWidth: VW, videoHeight: VH }, crop: null };
    ${slice("scanCropCanvas")}
    var c = scanCropCanvas(TILT);
    return c === null ? null : { w: c.width, h: c.height, draws: draws, rotations: rotations };
  `;
  const fn = new Function("VW", "VH", "TILT", body) as (a: number, b: number, t?: number) => Cropped | null;
  return fn(vw, vh, tilt) as Cropped;
}

describe("the band the decoder reads", () => {
  /* Measured (tools/scan-bench.mjs, 768 painted frames): the old 0.76 × 0.44
     band drawn at 2× managed ~7 expected reads per second of decoding; the
     same band at 1× managed ~19, and 0.92 × 0.60 at 1× managed ~20. The 2×
     upscale added no information and cost the pass ~40 ms. */
  it("is 0.92 × 0.60 of the short side, at the sensor's own resolution", () => {
    const c = crop(1920, 1080);
    expect(c.w).toBe(994);          // 0.92 × 1080
    expect(c.h).toBe(648);          // 0.60 × 1080
    expect(c.draws).toHaveLength(1);
    expect(c.draws[0].sw).toBe(994);
    expect(c.draws[0].sh).toBe(648);
    // …and drawn 1:1, never enlarged
    expect(c.draws[0].dw).toBe(994);
    expect(c.draws[0].dh).toBe(648);
  });

  it("is cut from the middle of the frame, which is what the viewfinder shows", () => {
    const c = crop(1920, 1080);
    expect(c.draws[0].sx).toBe(Math.round((1920 - 994) / 2));
    expect(c.draws[0].sy).toBe(Math.round((1080 - 648) / 2));
  });

  it("follows the short side on a portrait frame too", () => {
    const c = crop(720, 1280);
    expect(c.w).toBe(Math.round(720 * 0.92));
    expect(c.h).toBe(Math.round(720 * 0.6));
  });

  it("has nothing to cut before the first frame arrives", () => {
    expect(crop(0, 0)).toBeNull();
  });

  /* A bottle held at 25° read at 0 % on every straight framing and both
     decoders; the same band turned back 13° read it at 33 %. */
  it("turns back by the angle it is given, the other way round", () => {
    const c = crop(1920, 1080, 13);
    expect(c.rotations).toHaveLength(1);
    expect(c.rotations[0]).toBeCloseTo((-13 * Math.PI) / 180, 6);
    const back = crop(1920, 1080, -13);
    expect(back.rotations[0]).toBeCloseTo((13 * Math.PI) / 180, 6);
  });

  it("does not pay for a rotation when there is none to do", () => {
    expect(crop(1920, 1080, 0).rotations).toEqual([]);
  });
});

/** The schedule the two decode loops share. */
function views(n: number): string[] {
  const body = `
    ${constant("SCAN_TILTS")}
    ${constant("SCAN_FULL_EVERY")}
    function scanFullCanvas() { return "full"; }
    function scanCropCanvas(tilt) { return "band" + tilt; }
    ${slice("scanViewCanvas")}
    var out = [];
    for (var i = 0; i < N; i++) out.push(scanViewCanvas(i));
    return out;
  `;
  return (new Function("N", body) as (n: number) => string[])(n);
}

describe("which view each decode pass looks at", () => {
  it("alternates straight and tilted, both ways", () => {
    const v = views(8).filter((x) => x !== "full");
    expect(v.slice(0, 4)).toEqual(["band0", "band13", "band0", "band-13"]);
  });

  it("looks at the whole frame every ninth pass — insurance, not the main event", () => {
    const v = views(27);
    expect(v.filter((x) => x === "full")).toHaveLength(3);
    expect(v[8]).toBe("full");
    expect(v[17]).toBe("full");
  });

  it("the full-frame pass does not always steal the same tilt", () => {
    // 9 and 4 are coprime on purpose: otherwise one of the two tilted passes
    // would be replaced every single time and never run
    const stolen = [8, 17, 26].map((i) => i % 4);
    expect(new Set(stolen).size).toBeGreaterThan(1);
  });
});

/* ------------------------------------------------------------------------ *
 * 3. «Склад» — the whole warehouse, and how far the binding has got
 * ------------------------------------------------------------------------ */

type Row = { productId: string; variant: string; brand: string; name: string; ean: string | null; qty: number; tracked: boolean; state: string };

function row(i: number, over: Partial<Row> = {}): Row {
  return Object.assign({
    productId: "p" + i, variant: "40 мл", brand: "Kevin.Murphy", name: "Un.Tangled " + i,
    ean: null, qty: 5, tracked: true, state: "in",
  }, over);
}

function stockList(rows: Row[], state: Record<string, unknown> = {}) {
  const body = `
    ${constant("STOCK_PAGE")}
    var S = Object.assign({ stockLevels: ROWS, stockQ: "", stockFilter: "all", stockShown: 0 }, STATE);
    function esc(s) { return String(s); }
    function plural(n) { return n === 1 ? "товар" : "товаров"; }
    function stockRowHTML(r) { return "<i data-row=\\"" + r.productId + "\\"></i>"; }
    ${slice("scanFold")}
    ${slice("scanWordHas")}
    ${slice("stockFiltered")}
    ${slice("stockCountText")}
    ${slice("stockRows")}
    var html = stockRows();
    return {
      html: html,
      rows: (html.match(/data-row=/g) || []).length,
      more: html.indexOf("data-stockmore") >= 0
    };
  `;
  const fn = new Function("ROWS", "STATE", body) as (r: Row[], s: Record<string, unknown>) => { html: string; rows: number; more: boolean };
  return fn(rows, state);
}

describe("«Склад» reaches every row", () => {
  const many = Array.from({ length: 350 }, (_, i) => row(i));

  it("shows the first page and offers the next — «We need all», not «the first 60 and good luck»", () => {
    const out = stockList(many, { stockShown: 60 });
    expect(out.rows).toBe(60);
    expect(out.more).toBe(true);
    expect(out.html).toContain("Показаны первые 60 из 350");
  });

  it("a second page shows more, a last page stops offering one", () => {
    expect(stockList(many, { stockShown: 120 }).rows).toBe(120);
    const all = stockList(many, { stockShown: 360 });
    expect(all.rows).toBe(350);
    expect(all.more).toBe(false);
    expect(all.html).toContain("350 товаров");
    expect(all.html).not.toContain("Показаны первые");
  });

  it("the page size is the one the list starts from, so «Показать ещё» is never a no-op", () => {
    const first = stockList(many);            // stockShown 0 → the default page
    expect(first.rows).toBeGreaterThan(0);
    expect(first.more).toBe(true);
  });

  it("a search narrows the whole warehouse, not just the page on screen", () => {
    // row 349 sorts last by quantity and would never be on page one
    const out = stockList(many, { stockShown: 60, stockQ: "murphy 349" });
    expect(out.rows).toBe(1);
    expect(out.html).toContain('data-row="p349"');
    expect(out.more).toBe(false);
  });

  /* The rows, the count and the button are three separate elements so that a
     page can be APPENDED. The e2e caught why that matters: rebuilding the
     whole list took the «Показать ещё» button out of the DOM in the middle of
     the press that asked for it — and on a phone it would have taken the
     scroll position and any open «Править» form with it. */
  it("the list is built as rows + count + button, so a page can be added to it", () => {
    const out = stockList(many, { stockShown: 60 });
    expect(out.html, "the rows have no container to append to").toContain("data-stockrows");
    expect(out.html, "the count line cannot be repainted on its own").toContain("data-stockcount");
    // the rows come first, then the count, then the button
    expect(out.html.indexOf("data-stockrows")).toBeLessThan(out.html.indexOf("data-stockcount"));
    expect(out.html.indexOf("data-stockcount")).toBeLessThan(out.html.indexOf("data-stockmore"));
  });
});

function boundLine(rows: Row[]): string {
  const body = `
    var S = { stockLevels: ROWS };
    ${slice("stockBoundCount")}
    ${slice("stockBoundLine")}
    return stockBoundLine();
  `;
  return (new Function("ROWS", body) as (r: Row[]) => string)(rows);
}

describe("how far the first bind pass has got", () => {
  /* Nothing in the catalogue carries a barcode, so every code in the database
     is one Renat scanned and tapped — «he will do it soon, but not all at
     once» (Dim). The counter is what lets him pick up where he stopped. */
  it("counts the sizes that carry a code against every size there is", () => {
    const rows = [row(1, { ean: "4601234567893" }), row(2), row(3, { ean: "12345670" }), row(4)];
    expect(boundLine(rows)).toBe("Штрихкоды: привязано 2 из 4");
  });

  it("an empty string is not a barcode", () => {
    expect(boundLine([row(1, { ean: "" }), row(2, { ean: null })])).toBe("Штрихкоды: привязано 0 из 2");
  });

  it("says so honestly before anything has been bound", () => {
    expect(boundLine([row(1), row(2), row(3)])).toBe("Штрихкоды: привязано 0 из 3");
  });

  it("and when the whole warehouse is done", () => {
    expect(boundLine([row(1, { ean: "1" }), row(2, { ean: "2" })])).toBe("Штрихкоды: привязано 2 из 2");
  });
});

/* ------------------------------------------------------------------------ *
 * 4. The editor grid's red remainder
 * ------------------------------------------------------------------------ */

function edLow(lv: Partial<Row> | null): boolean {
  const body = `${slice("edStockLow")} return edStockLow(LV);`;
  return (new Function("LV", body) as (l: Partial<Row> | null) => boolean)(lv);
}

describe("the editor grid reddens on the size's own «Порог «мало»»", () => {
  /* It used to say a flat «3 или меньше» in the code AND in words, while
     «Склад» next door filtered on each row's own threshold (server default
     2). A size the «Мало» chip listed was black here; a size set to warn at 5
     stayed black at 4. Dim: «We should use 2» — which is the server default,
     so the fix is to stop having a second opinion at all. */
  it("follows the server's state, not a number of its own", () => {
    expect(edLow({ tracked: true, qty: 2, state: "low" })).toBe(true);
    expect(edLow({ tracked: true, qty: 0, state: "out" })).toBe(true);
    expect(edLow({ tracked: true, qty: 3, state: "in" })).toBe(false);
  });

  it("a size set to warn at 5 is red at 4, which a flat «3 or fewer» never was", () => {
    expect(edLow({ tracked: true, qty: 4, state: "low" })).toBe(true);
  });

  it("a size at 3 with the default threshold of 2 is NOT red — the old rule said it was", () => {
    expect(edLow({ tracked: true, qty: 3, state: "in" })).toBe(false);
  });

  it("nothing counted and nothing loaded is not «low», it is unknown", () => {
    expect(edLow({ tracked: false, qty: 0, state: "out" })).toBe(false);
    expect(edLow(null)).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *
 * 5. The pinch
 * ------------------------------------------------------------------------ */

function zoom(caps: { min: number; max: number } | null, want: number): number {
  const body = `
    var SCAN = { zoomCaps: CAPS };
    ${slice("scanZoomClamp")}
    return scanZoomClamp(WANT);
  `;
  return (new Function("CAPS", "WANT", body) as (c: unknown, w: number) => number)(caps, want);
}

describe("pinch-to-zoom stays inside what the lens can do", () => {
  it("keeps a pinch between the lens's own limits", () => {
    expect(zoom({ min: 1, max: 8 }, 2.4)).toBe(2.4);
    expect(zoom({ min: 1, max: 8 }, 40)).toBe(8);
    expect(zoom({ min: 1, max: 8 }, 0.2)).toBe(1);
  });

  it("a lens with no zoom at all reports 1× and nothing is applied", () => {
    expect(zoom(null, 3)).toBe(1);
  });

  it("the starting zoom is a real number the lens can hold", () => {
    const startM = /var SCAN_ZOOM_START = ([\d.]+);/.exec(src);
    expect(startM, "public/shop2/app.js no longer declares SCAN_ZOOM_START").toBeTruthy();
    const start = Number(startM![1]);
    expect(start).toBeGreaterThanOrEqual(1);
    expect(zoom({ min: 1, max: 8 }, start)).toBe(start);
  });
});

/* ------------------------------------------------------------------------ *
 * 6. What the owner is not told
 * ------------------------------------------------------------------------ */

describe("the fallback decoder is recorded, not announced", () => {
  /* Dim, asked whether the «запасной декодер» line should stay on screen:
     no. It is a fact about this phone's Play Services, not about the bottle
     in the owner's hand — so it goes to the console and to a data attribute
     a support person can read, and Renat never sees the phrase. */
  it("the sentence is gone from the shop entirely, dictionary included", () => {
    expect(src).not.toContain("запасной декодер —");
    expect(src).not.toContain("Kaamera loeb varudekoodriga");
    expect(src).not.toContain("reading through the backup decoder");
  });

  it("but the hand-over is still written down where we can find it", () => {
    const gaveUp = slice("scanNativeGaveUp");
    expect(gaveUp, "the hand-over no longer reaches the console").toContain("console.info");
    expect(gaveUp, "the overlay no longer records which decoder gave up").toContain("scanfallback");
  });
});
