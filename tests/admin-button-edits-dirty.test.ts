/**
 * An edit made with a button is an edit: «Не сохранено» says so, and leaving
 * asks.
 *
 * The product editor keeps no draft in S; it counted as «dirty» from the
 * first keystroke (admBarTouch on `input`/`change`) and from the four buttons
 * that remembered to call admBarTouched(). Everything else the owner changes
 * with a finger left the bar at «Изменений нет» and «← Товары» / Back / the
 * nav bar unguarded (map of the panel, 23.09.2026, #3):
 *   ★ main photo, ✂ cut-out, a photo uploaded (the button or a drop), a
 *   size's photo, the video's chips, «Загрузить» and ×, «Отвязать», a code
 *   from the scanner, and every AI fill.
 * The same gap in the set form (items, ±, «Убрать», the photo tile, the ✨
 * description), the promo form (kind, scope, product chips) and the banner's
 * ✨ texts on «Главная страница».
 *
 * Each handler is sliced out of public/shop2/app.js and run over stubs; the
 * assertion is the one the owner reads — the bar's state and the leave
 * question's goodsEditDirty().
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function block(start: number, what: string): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${what} in app.js`);
}
const fn = (name: string) => block(src.indexOf(`function ${name}(`), `function ${name}()`);
const maybe = (name: string) => (src.includes(`function ${name}(`) ? fn(name) : "");
const obj = (name: string) => (src.includes(`var ${name} = {`) ? `${block(src.indexOf(`var ${name} = {`), `var ${name}`)};` : "");
const line = (name: string) => {
  const at = src.indexOf(`var ${name} =`);
  return at < 0 ? "" : src.slice(at, src.indexOf(";", at) + 1);
};
const branch = (head: string) => block(src.indexOf(head), head);
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Just enough of an element for the fills. */
function el(value = "") {
  return {
    value, hidden: false, disabled: false, textContent: "", isConnected: true,
    focus() {}, setAttribute() {}, scrollIntoView() {}, querySelectorAll: () => [] as unknown[],
  };
}

const BRANCHES = [
  "if (d.edvidkind !== undefined)", "if (d.edvidclear !== undefined)", "if (d.edunbind !== undefined)",
  "if (d.galcut !== undefined)", "if (d.galmain !== undefined)", "if (d.vpick !== undefined)",
  "if (d.admdescgen !== undefined)", "if (d.admtranslate !== undefined)", "if (d.ednamespark !== undefined)",
  "if (d.admdescundo !== undefined)", "if (d.herospark !== undefined)",
  "if (d.promokind)", "if (d.promoscope)", "if (d.promoprodpick)", "if (d.promoproddel !== undefined)",
  "if (d.bundleadd)", "if (d.bundledel !== undefined)", "if (d.bundleqty)", "if (d.bundleimg !== undefined)",
  "if (d.bundlelang)", "if (d.bundledescgen !== undefined)", "if (d.bundletranslate !== undefined)",
  "if (d.bundledescundo !== undefined)",
];

type Env = {
  S: Record<string, any>;
  GAL: Record<string, any>;
  VID: Record<string, any>;
  DEMO: Record<string, any>;
  els: Record<string, ReturnType<typeof el>>;
  paintsSetBar: () => number;
  click: (d: Record<string, string>) => void;
  dirty: () => boolean;
  bar: () => string;
  f: Record<string, (...a: any[]) => any>;
};

function editor(): Env {
  const product = {
    id: "azur", brand: "Proraso", name: "Azur Lime", cat: "beard", sizes: ["100 ml", "400 ml"],
    varImg: [] as number[], video: "", price: 12,
  };
  const S: Record<string, any> = {
    screen: "admin", adminTab: "goods", adminEdit: "azur", goodsNew: null, bundleForm: null, promoForm: null,
    partnerForm: null, barTouched: null, barSaved: "", scanFor: "", goodsSeoLang: "ru", heroLang: "RU", heroEdit: 0,
  };
  const GAL: Record<string, any> = { id: "", list: [], fresh: {}, reset: false, cutting: null, picks: {} };
  const VID: Record<string, any> = { id: "", url: null };
  const DEMO: Record<string, any> = { gallery: {}, video: {} };
  const els: Record<string, ReturnType<typeof el>> = {};
  for (const s of ['[data-edean="azur 100 ml"]', "[data-eddescru]", "[data-eddescet]", "[data-eddescen]",
    "[data-edseot]", "[data-edseod]", "[data-edseotet]", "[data-edseodet]", "[data-edseoten]", "[data-edseoden]",
    "[data-edbrand]", "[data-edname]", "[data-edcat]", "[data-edvideo]", '[data-bundlef="desc"]', '[data-herof="title"]']) {
    els[s] = el();
  }
  els["[data-edname]"].value = "Мыло";
  let setBarPaints = 0;
  const hero = { slides: [{ title: { RU: "" }, sub: {}, eyebrow: {}, cta: {}, go: "", image: "" }] };
  const doc = { querySelector: (s: string) => els[s] ?? null, querySelectorAll: () => [] };
  /* AI: every request answers at once with a text for whatever was asked */
  const apiSend = (_url: string, _m: string, body: any) => Promise.resolve({
    status: 200,
    body: body && body.task === "translate"
      ? { ok: true, texts: { ET: "Eesti", EN: "English" } }
      : body && body.url ? { ok: true, url: "https://cdn/cut.png", thumbUrl: "https://cdn/cut.png" }
      : { ok: true, text: { title: "T", description: "D", bullets: [] } },
  });
  const admSpark = (_b: unknown, langs: string[], _k: string, _in: unknown, apply: (L: string, tx: any) => void) => {
    langs.forEach((L) => apply(L, { text: "Текст", title: "Заголовок", name: "Имя", sub: "", eyebrow: "", cta: "" }));
  };

  const f = new Function(
    "S", "GAL", "VID", "DEMO", "document", "apiSend", "admSpark", "heroDraft", "paintSetBar", "product",
    `var UP = { busy: 0, total: 0, err: "" }, MEDIA = { on: true }, SRV = { admin: true };
     var AI_UNDO = { descRU: "", descET: "", descEN: "", seoT: "", seoD: "", seoTet: "", seoDet: "", seoTen: "", seoDen: "" };
     var BUNDLE_AI_UNDO = { desc: { RU: "", ET: "", EN: "" } };
     var CAT_NAMES = {}, CONTENT_RU = {}, CONTENT = {}, EDB = {};
     ${obj("SEO_HOOKS")}
     ${line("MAX_PHOTOS")}
     ${line("VIDEO_SEND_MAX")}
     ${obj("VIDEO_ERR")}
     ${obj("ADM_FORM_BASE")}
     function render() {}
     function refocus() {}
     function toast() {}
     function translateTree() {}
     function admBarPaintNote() {}
     function mailDirty() { return false; }
     function newsDirty() { return false; }
     function admEditProduct(id) { return id === product.id ? product : null; }
     function gal() { return ["https://cdn/a.jpg", "https://cdn/b.jpg"]; }
     function txt(s) { return String(s == null ? "" : s); }
     function stripTags(s) { return s; }
     function admDescSnapshot() {}
     function bundleDescSnapshot() {}
     function bundleDescInput() { return {}; }
     function bundleKeepNames() { return []; }
     function heroProduct() { return null; }
     function heroGoLabel() { return ""; }
     function paintHeroPreview() {}
     function edNameHintPaint() {}
     function closeScannerState() {}
     function scanBeep() {}
     function edBrandEls() { return { input: document.querySelector("[data-edbrand]"), list: {} }; }
     function edBrandClose() {}
     function edStepsPaint() {}
     function mediaErrText() { return ""; }
     function upFail() {}
     function galNewUpload() {}
     function galDrop() {}
     function uploadPhoto() { return Promise.resolve({ url: "https://cdn/new.jpg", thumbUrl: "https://cdn/new.jpg", key: "k" }); }
     function uploadVideo() { return Promise.resolve({ url: "https://cdn/v.mp4" }); }
     ${fn("admBarIdent")}
     ${fn("admBarTouched")}
     ${maybe("admFill")}
     ${maybe("edMediaDirty")}
     ${maybe("admFormSig")}
     ${maybe("admDraftDiffers")}
     ${maybe("admFormDirty")}
     ${fn("goodsEditDirty")}
     ${fn("admBarNoteState")}
     ${fn("galPhotos")}
     ${fn("galDraft")}
     ${fn("galDirty")}
     ${fn("varImgChanged")}
     ${fn("galSizePick")}
     ${fn("galCutIndex")}
     ${fn("vidValue")}
     ${fn("vidFail")}
     ${fn("videoUpload")}
     ${fn("galUpload")}
     ${fn("scanToEditor")}
     ${fn("admSeoFill")}
     ${fn("edBrandPick")}
     function click(d, t) {
       ${BRANCHES.map(branch).join("\n")}
     }
     return { click: click, goodsEditDirty: goodsEditDirty, admBarNoteState: admBarNoteState,
       galDraft: galDraft, vidValue: vidValue, videoUpload: videoUpload, galUpload: galUpload,
       scanToEditor: scanToEditor, admSeoFill: admSeoFill, edBrandPick: edBrandPick };`,
  )(S, GAL, VID, DEMO, doc, apiSend, admSpark, () => hero, () => { setBarPaints++; }, product) as Record<string, (...a: any[]) => any>;

  // the render that opens the editor: the media pane drafts the photos and the video
  f.galDraft(product);
  f.vidValue(product);
  return {
    S, GAL, VID, DEMO, els, f,
    paintsSetBar: () => setBarPaints,
    click: (d) => f.click(d, { textContent: "✨", disabled: false }),
    dirty: () => f.goodsEditDirty() as boolean,
    bar: () => f.admBarNoteState("touch") as string,
  };
}

describe("the product editor: a button edit is an unsaved edit", () => {
  it("starts quiet", () => {
    const e = editor();
    expect(e.dirty()).toBe(false);
    expect(e.bar()).toBe("");
  });

  it("★ — a new main photo", () => {
    const e = editor();
    e.click({ galmain: "1" });
    expect(e.dirty(), "★ left the way out unguarded").toBe(true);
    expect(e.bar()).toBe("dirty");
  });

  it("…and ★ pressed back to how it was is quiet again", () => {
    const e = editor();
    e.click({ galmain: "1" });
    e.click({ galmain: "1" });
    expect(e.dirty()).toBe(false);
  });

  it("✂ — the cut-out that replaced a photo", async () => {
    const e = editor();
    e.click({ galcut: "0" });
    await flush(); await flush();
    expect(e.GAL.list[0].url).toBe("https://cdn/cut.png");
    expect(e.dirty()).toBe(true);
  });

  it("a photo uploaded — the button and a drop both come through galUpload()", async () => {
    const e = editor();
    e.f.galUpload([{ name: "p.jpg", size: 1000 }], e.f.galDraft && { id: "azur", sizes: ["100 ml", "400 ml"], varImg: [], video: "" });
    await flush(); await flush();
    expect(e.GAL.list).toHaveLength(3);
    expect(e.dirty()).toBe(true);
  });

  it("a size's own photo", () => {
    const e = editor();
    e.click({ vpick: "1:1" });
    expect(e.dirty(), "the size photo was not counted").toBe(true);
    expect(e.bar()).toBe("dirty");
  });

  it("the video: «Загрузить», × and a chip", async () => {
    const up = editor();
    up.f.videoUpload([{ name: "v.mp4", size: 1000 }], { id: "azur" });
    await flush(); await flush();
    expect(up.dirty(), "an uploaded video was not counted").toBe(true);

    const cleared = editor();
    cleared.DEMO.video.azur = "https://youtu.be/abcdefghijk";
    cleared.click({ edvidclear: "" });
    expect(cleared.dirty(), "× on a saved video was not counted").toBe(true);

    // a chip only changes which door is shown: the address is the same, so nothing to save
    const chip = editor();
    chip.click({ edvidkind: "ig" });
    expect(chip.dirty()).toBe(false);
  });

  it("«Отвязать» and a code from the scanner", () => {
    const un = editor();
    un.els['[data-edean="azur 100 ml"]'].value = "4740001000017";
    un.click({ edunbind: "azur 100 ml" }, );
    expect(un.dirty(), "«Отвязать» was not counted").toBe(true);

    const scan = editor();
    scan.S.scanFor = "azur 100 ml";
    scan.f.scanToEditor("4740001000017");
    expect(scan.els['[data-edean="azur 100 ml"]'].value).toBe("4740001000017");
    expect(scan.dirty(), "a scanned code was not counted").toBe(true);
  });

  it("every AI fill: «Написать», «Перевести», Google, the name, and «Отменить»", async () => {
    const presses: Array<Record<string, string>> = [
      { admdescgen: "azur" }, { admtranslate: "azur" }, { admseogen: "" }, { ednamespark: "" }, { admdescundo: "" },
    ];
    for (const d of presses) {
      const e = editor();
      e.els["[data-eddescru]"].value = "Русское описание";   // what «Перевести» translates
      if ("admseogen" in d) e.f.admSeoFill({ name: "Azur", brand: "Proraso", cat: "beard" }, ["RU"], { textContent: "", disabled: false });
      else e.click(d);
      await flush(); await flush();
      expect(e.dirty(), `${Object.keys(d)[0]} was not counted`).toBe(true);
    }
  });

  it("a brand picked from the list (a new product)", () => {
    const e = editor();
    e.S.adminEdit = "new"; e.S.goodsNew = { brand: "", name: "", cat: "hair" };
    e.f.edBrandPick("Proraso");
    expect(e.dirty()).toBe(true);
  });
});

describe("the set form: its draft is asked, not a keystroke flag", () => {
  function set() {
    const e = editor();
    e.S.adminEdit = "";
    e.S.bundleForm = { id: "", idTyped: false, cat: "beard", editing: false, title: { RU: "", ET: "", EN: "" },
      desc: { RU: "", ET: "", EN: "" }, items: [{ productId: "a", variant: 0, qty: 1 }, { productId: "b", variant: 0, qty: 1 }],
      price: "", image: "", active: true, sort: 0, lang: "RU" };
    expect(e.bar(), "the form opened «dirty»").toBe("");   // the render that opens it
    return e;
  }
  it.each([
    [{ bundleadd: "c" }, "a product added"],
    [{ bundledel: "0" }, "«Убрать»"],
    [{ bundleqty: "0:1" }, "«+»"],
    [{ bundleimg: "a" }, "the photo tile"],
    [{ bundledescgen: "" }, "«Написать черновик»"],
  ])("%j — %s", (d, what) => {
    const e = set();
    e.click(d);
    expect(e.bar(), `${what} left the bar quiet`).toBe("dirty");
  });

  it("a language chip is not an edit", () => {
    const e = set();
    e.click({ bundlelang: "ET" });
    expect(e.bar()).toBe("");
  });
});

describe("the promo form: the chips are edits", () => {
  it.each([
    [{ promokind: "fixed" }],
    [{ promoscope: "brand" }],
    [{ promoprodpick: "azur" }],
  ])("%j", (d) => {
    const e = editor();
    e.S.adminEdit = "";
    e.S.promoForm = { code: "", kind: "percent", value: 10, minSubtotal: 0, startsAt: null, endsAt: "", maxUses: "",
      note: "", active: true, scope: "order", scopeValue: "" };
    expect(e.bar()).toBe("");
    e.click(d);
    expect(e.bar()).toBe("dirty");
  });
});

describe("«Главная страница»: the banner's ✨ says «not saved» at once", () => {
  it("repaints the page's bar in place", () => {
    const e = editor();
    e.S.adminEdit = "";
    e.click({ herospark: "RU" });
    expect(e.paintsSetBar(), "the bar waited for the next render").toBeGreaterThan(0);
  });
});
