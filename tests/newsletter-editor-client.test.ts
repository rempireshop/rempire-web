/**
 * «Маркетинг → Рассылка», the panel's half — functions sliced out of
 * public/shop2/app.js and run here, the way tests/shop-media.test.ts does it:
 * the functions themselves, never a copy kept in step by hand.
 *
 * Renat, 23.09.2026, on the checklist («mail-newsletter-send», «bad»):
 * «Picture uploads aren't set up yet — paste a link to a picture instead —
 * we need that … Renat will not start getting URLs.» The bucket WAS set up.
 * What was not: the question. The picture sheet asked `MEDIA.on === true`,
 * and MEDIA.on is filled in by mediaProbe() — which the goods editor and the
 * banner call on the way in, and the letter (and the article) never did. So
 * on a panel opened straight onto «Рассылка» MEDIA.on was still null, null is
 * not true, and the sheet told the owner that uploads were not configured.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { readyLangs } from "@/lib/newsletters";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

function sliceFn(name: string): string {
  const at = src.indexOf(`  function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  const end = src.indexOf("\n  }\n", at);
  if (end < 0) throw new Error(`function ${name}() has no end`);
  return src.slice(at, end + 4);
}

const NOT_SET_UP = "Загрузка картинок пока не настроена";

describe("the picture sheet before the media probe has answered", () => {
  function sheet(on: boolean | null, kind: "news" | "blog") {
    return runInNewContext(`
      var S = { adminBlogTool: "image", adminBlogToolUrl: "", adminBlogToolHref: "" };
      var MEDIA = { on: ${JSON.stringify(on)}, busy: false };
      var UP = { busy: 0, total: 0 };
      var probed = 0;
      function ensureMedia() { probed += 1; }
      function esc(s) { return String(s); }
      function upBusyText() { return "…"; }
      function blogToolMatches() { return ""; }
      function blogToolForNews() { return ${JSON.stringify(kind === "news")}; }
      ${sliceFn("blogToolSheet")}
      ({ html: blogToolSheet(), probed: probed })
    `) as { html: string; probed: number };
  }

  it("offers the upload while the answer is still unknown — it does not say «not set up»", () => {
    for (const kind of ["news", "blog"] as const) {
      const { html } = sheet(null, kind);
      expect(html, `${kind}: «not configured» on a panel that never asked`).not.toContain(NOT_SET_UP);
      expect(html).toContain("data-blogtoolupload");
    }
  });

  it("says «not set up» only when the server has said so", () => {
    expect(sheet(false, "blog").html).toContain(NOT_SET_UP);
    expect(sheet(true, "blog").html).not.toContain(NOT_SET_UP);
  });
});

/* ---------- the block editor's own arithmetic ------------------------------ */

type Tri = { RU: string; ET: string; EN: string };
type ClientBlock = { k?: string; t: string; src?: string; href?: string; alt?: string; style?: string; text?: Tri; id?: string; html?: Tri };

const app = runInNewContext(`
  var S = { newsEdit: null };
  var NEWS_UP = {};
  ${src.slice(src.indexOf("  var INLINE_TAGS ="), src.indexOf("\n", src.indexOf("  var INLINE_TAGS =")))}
  ${sliceFn("stripTags")}
  ${sliceFn("blogTextLen")}
  ${sliceFn("newsBodyHas")}
  var NEWS_BLOCKS_MAX = 40, NEWS_PRODUCTS_MAX = 8;
  var NEWS_LANG3 = ["RU", "ET", "EN"];
  var NEWS_KEY = 0;
  ${sliceFn("newsKey")}
  ${sliceFn("newsTri")}
  ${sliceFn("newsLegacyBlocks")}
  ${sliceFn("newsBlockOut")}
  ${sliceFn("newsBlocksOut")}
  ${sliceFn("newsBlockWords")}
  ${sliceFn("newsBlockHas")}
  ${sliceFn("newsBlocksComplete")}
  ${sliceFn("newsHasBody")}
  ${sliceFn("newsReady")}
  ${sliceFn("newsLangWords")}
  ${sliceFn("newsBlockByKey")}
  ${sliceFn("newsUploading")}
  ${sliceFn("newsProblem")}
  ${sliceFn("newsUnits")}
  ${sliceFn("newsPackUnits")}
  ${sliceFn("newsUnpackUnits")}
  ${sliceFn("newsUrlOk")}
  ${sliceFn("newsImgOk")}
  ({
    S: S, NEWS_UP: NEWS_UP,
    newsLegacyBlocks: newsLegacyBlocks, newsBlocksOut: newsBlocksOut, newsReady: newsReady,
    newsLangWords: newsLangWords, newsProblem: newsProblem, newsUnits: newsUnits,
    newsPackUnits: newsPackUnits, newsUnpackUnits: newsUnpackUnits, newsUrlOk: newsUrlOk, newsImgOk: newsImgOk
  })
`) as {
  S: { newsEdit: unknown };
  NEWS_UP: Record<string, { phase: string }>;
  newsLegacyBlocks: (body: Partial<Tri>, products: string[]) => ClientBlock[];
  newsBlocksOut: (blocks: ClientBlock[]) => ClientBlock[];
  newsReady: (d: { subject: Tri; blocks: ClientBlock[] }, L: string) => boolean;
  newsLangWords: (d: { subject: Tri; blocks: ClientBlock[] }, L: string) => string[];
  newsProblem: (d: { blocks: ClientBlock[] }) => { msg: string; k: string } | null;
  newsUnits: (d: { subject: Tri; blocks: ClientBlock[] }) => Array<{ k: string; src: string }>;
  newsPackUnits: (units: Array<{ k: string; src: string }>) => string;
  newsUnpackUnits: (text: string, n: number) => string[] | null;
  newsUrlOk: (v: string) => string;
  newsImgOk: (v: string) => string;
};

const tri = (RU: string, ET = "", EN = ""): Tri => ({ RU, ET, EN });
const IMG = "https://img.rempireshop.com/news/1758600000000-autumn.jpg";

describe("an old letter opened in the block editor", () => {
  it("becomes its bodies as one block, then the cards it listed but placed nowhere", () => {
    const blocks = app.newsLegacyBlocks(
      { RU: '<p>Привет</p><p><a data-product="placed-one"></a></p>', ET: "<p>Tere</p>" },
      ["placed-one", "listed-only"],
    );
    expect(blocks.map((b) => b.t)).toEqual(["html", "product"]);
    expect(blocks[0].html).toEqual({ RU: '<p>Привет</p><p><a data-product="placed-one"></a></p>', ET: "<p>Tere</p>", EN: "" });
    expect(blocks[1].id).toBe("listed-only");
    // every block has a key of its own, and the keys never repeat
    expect(new Set(blocks.map((b) => b.k)).size).toBe(2);
  });

  it("an empty old letter is an empty block letter, not an empty text block", () => {
    expect(app.newsLegacyBlocks({ RU: "<p><br></p>" }, [])).toEqual([]);
  });
});

describe("what the editor saves", () => {
  it("never sends the screen's own keys, nor a picture that has no picture yet", () => {
    const out = app.newsBlocksOut([
      { k: "b1", t: "img", src: IMG, href: "cat:hair", alt: "" },
      { k: "b2", t: "img", src: "", href: "", alt: "" },
      { k: "b3", t: "text", style: "h", text: tri("Заголовок") },
      { k: "b4", t: "btn", text: tri("В магазин"), href: "home" },
      { k: "b5", t: "product", id: "x" },
    ]);
    expect(out).toEqual([
      { t: "img", src: IMG, href: "cat:hair", alt: "" },
      { t: "text", style: "h", text: tri("Заголовок") },
      { t: "btn", text: tri("В магазин"), href: "home" },
      { t: "product", id: "x" },
    ]);
    expect(JSON.stringify(out)).not.toContain('"k"');
  });
});

describe("the language strip says what the server will send", () => {
  const cases: Array<{ name: string; subject: Tri; blocks: ClientBlock[] }> = [
    { name: "pictures only", subject: tri("Тема", "Teema"), blocks: [{ t: "img", src: IMG, href: "home", alt: "" }] },
    { name: "a text in Russian only", subject: tri("Тема", "Teema", "Subject"), blocks: [{ t: "img", src: IMG, href: "", alt: "" }, { t: "text", style: "p", text: tri("Текст") }] },
    { name: "a button without its link", subject: tri("Тема", "Teema", "Subject"), blocks: [{ t: "btn", text: tri("x", "x", "x"), href: "" }] },
    { name: "everything in three languages", subject: tri("Т", "T", "S"), blocks: [{ t: "text", style: "h", text: tri("а", "b", "c") }, { t: "btn", text: tri("а", "b", "c"), href: "home" }, { t: "product", id: "x" }] },
    { name: "an old body in two languages", subject: tri("Т", "T", "S"), blocks: [{ t: "html", html: tri("<p>Привет</p>", "<p>Tere</p>") }] },
    { name: "nothing at all", subject: tri("Т"), blocks: [] },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const client = ["RU", "ET", "EN"].filter((L) => app.newsReady({ subject: c.subject, blocks: c.blocks }, L));
      const server = readyLangs({ subject: c.subject, body: tri(""), blocks: c.blocks as never });
      expect(client).toEqual(server);
    });
  }

  it("names a half-translated language as such", () => {
    const d = { subject: tri("Тема", "Teema"), blocks: [{ t: "text", style: "p", text: tri("Текст") }] as ClientBlock[] };
    expect(app.newsLangWords(d, "RU")).toEqual(["готово"]);
    expect(app.newsLangWords(d, "ET")).toEqual(["без текста"]);
    const half = { subject: tri("Тема", "Teema"), blocks: [{ t: "img", src: IMG, href: "", alt: "" }, { t: "text", style: "p", text: tri("Текст") }] as ClientBlock[] };
    expect(app.newsLangWords(half, "ET")).toEqual(["не всё переведено"]);
  });
});

describe("what stops a test or a send", () => {
  it("a picture still uploading, a picture block with no picture, a button with nowhere to go or nothing written", () => {
    const d = { blocks: [{ k: "b1", t: "img", src: "", href: "", alt: "" }] as ClientBlock[] };
    app.S.newsEdit = d;
    app.NEWS_UP.b1 = { phase: "up" };
    expect(app.newsProblem(d)?.msg).toMatch(/картинка ещё загружается/);
    delete app.NEWS_UP.b1;
    expect(app.newsProblem(d)).toMatchObject({ k: "b1" });
    const btn = { blocks: [{ k: "b2", t: "btn", text: tri("В магазин"), href: "" }] as ClientBlock[] };
    expect(app.newsProblem(btn)?.msg).toMatch(/куда она ведёт/);
    const mute = { blocks: [{ k: "b3", t: "btn", text: tri(""), href: "home" }] as ClientBlock[] };
    expect(app.newsProblem(mute)?.msg).toMatch(/надпись/);
    expect(app.newsProblem({ blocks: [{ k: "b4", t: "img", src: IMG, href: "", alt: "" }] })).toBeNull();
  });
});

describe("a translation that comes back by its numbers", () => {
  const d = {
    subject: tri("Осенние новинки"),
    blocks: [
      { k: "a", t: "img", src: IMG, href: "", alt: "" },
      { k: "b", t: "text", style: "p", text: tri("Первый абзац.\n\nВторой абзац.") },
      { k: "c", t: "btn", text: tri("В магазин"), href: "home" },
      { k: "d", t: "text", style: "p", text: tri("") },
    ] as ClientBlock[],
  };

  it("numbers the subject, then each text and button that has words", () => {
    const units = app.newsUnits(d);
    expect(units.map((u) => u.k)).toEqual(["", "b", "c"]);
    expect(app.newsPackUnits(units)).toBe("[[1]] Осенние новинки\n\n[[2]] Первый абзац.\n\nВторой абзац.\n\n[[3]] В магазин");
  });

  it("splits a faithful reply back, paragraphs inside a unit kept", () => {
    const back = app.newsUnpackUnits("[[1]] Sügise uudised\n\n[[2]] Esimene lõik.\n\nTeine lõik.\n\n[[3]] Poodi\n", 3);
    expect(back).toEqual(["Sügise uudised", "Esimene lõik.\n\nTeine lõik.", "Poodi"]);
  });

  it("refuses a reply that lost, doubled, reordered or emptied a unit — whole", () => {
    expect(app.newsUnpackUnits("[[1]] a [[3]] c", 3)).toBeNull();
    expect(app.newsUnpackUnits("[[1]] a [[2]] b [[2]] b [[3]] c", 3)).toBeNull();
    expect(app.newsUnpackUnits("[[2]] b [[1]] a [[3]] c", 3)).toBeNull();
    expect(app.newsUnpackUnits("[[1]] a [[2]]   [[3]] c", 3)).toBeNull();
    expect(app.newsUnpackUnits("", 0)).toBeNull();
  });
});

/* ---------- the editor's own markup ----------------------------------------
   Every drawing function of the block editor, run for real. Only what they
   borrow from the rest of the panel is stood in for here — and each of those
   names is checked to exist in app.js first, so a stand-in cannot hide a
   misspelt call. */
describe("the block editor draws", () => {
  const borrowed = ["esc", "productsById", "scanFold", "scanWordHas", "trText", "heroFind", "media", "blogTextLen", "stripTags"];
  for (const name of borrowed) {
    it(`borrows ${name}() from a function that exists`, () => {
      expect(src.includes(`  function ${name}(`), name).toBe(true);
    });
  }
  for (const name of ["HERO_NOHIT", "BRAND_BY_SLUG", "CATS", "MEDIA"]) {
    it(`borrows ${name} from a variable that exists`, () => {
      expect(new RegExp(`\\n  var ${name} = `).test(src), name).toBe(true);
    });
  }

  const PRODUCT = { id: "system-4-bio-botanical-shampoo", brand: "System 4", name: "Bio Botanical Shampoo — шампунь" };
  const ui = runInNewContext(`
    var S = { lang: "RU", newsEdit: null, newsPick: null, newsUndo: null, newsPrev: null, adminBlog: [
      { slug: "boroda", status: "published", title: { RU: "Уход за бородой", ET: "", EN: "" } },
      { slug: "draft", status: "draft", title: { RU: "Черновик про бороду" } }
    ] };
    var MEDIA = { on: true };
    var CAT_NAMES = { hair: "Уход за волосами", beard: "Уход за бородой" };
    var CATS = [{ id: "hair", name: "Уход за волосами" }, { id: "beard", name: "Уход за бородой" }];
    var BRAND_BY_SLUG = { "system-4": "System 4", "kevin-murphy": "Kevin.Murphy" };
    var HERO_NOHIT = '<p class="adm-hint adm-picks__none">Ничего не нашлось — попробуйте другое слово.</p>';
    var P = ${JSON.stringify(PRODUCT)};
    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function productsById(ids) { return (ids || []).indexOf(P.id) >= 0 ? [P] : []; }
    function scanFold(s) { return String(s || "").toLowerCase().replace(/[.\\-_,]+/g, " ").replace(/\\s+/g, " ").trim(); }
    function scanWordHas(hay, words, w) { return hay.indexOf(w) >= 0; }
    function trText(s) { return s; }
    function heroFind(q) { return scanFold(P.brand + " " + P.name + " " + P.id).indexOf(scanFold(q)) >= 0 ? [P] : []; }
    function media() { return '<i class="ph"></i>'; }
    ${src.slice(src.indexOf("  var INLINE_TAGS ="), src.indexOf("\n", src.indexOf("  var INLINE_TAGS =")))}
    ${sliceFn("stripTags")}
    ${sliceFn("blogTextLen")}
    ${sliceFn("newsBodyHas")}
    var NEWS_BLOCKS_MAX = 40, NEWS_PRODUCTS_MAX = 8;
    var NEWS_LANG3 = ["RU", "ET", "EN"];
    var NEWS_BLOCK_NAME = { img: "Картинка", text: "Текст", btn: "Кнопка", product: "Товар", html: "Текст из прежнего редактора" };
    var NEWS_UP = {}, NEWS_SRC = {};
    ${sliceFn("newsBlockWords")}
    ${sliceFn("newsBlockHas")}
    ${sliceFn("newsBlocksComplete")}
    ${sliceFn("newsHasBody")}
    ${sliceFn("newsReady")}
    ${sliceFn("newsBlockByKey")}
    ${sliceFn("newsPostTitle")}
    ${sliceFn("newsLinkLabelHTML")}
    ${sliceFn("newsPickRowHTML")}
    ${sliceFn("newsPickRows")}
    ${sliceFn("newsPickerHTML")}
    ${sliceFn("newsLinkRowHTML")}
    ${sliceFn("newsUpInnerHTML")}
    ${sliceFn("newsImgBodyHTML")}
    ${sliceFn("newsRuHintHTML")}
    ${sliceFn("newsTextBodyHTML")}
    ${sliceFn("newsBtnBodyHTML")}
    ${sliceFn("newsProductBodyHTML")}
    ${sliceFn("newsHtmlBodyHTML")}
    ${sliceFn("newsBlockHTML")}
    ${sliceFn("newsAddBarHTML")}
    ${sliceFn("admNewsBlocksHTML")}
    ({ S: S, MEDIA: MEDIA, NEWS_UP: NEWS_UP, NEWS_SRC: NEWS_SRC, admNewsBlocksHTML: admNewsBlocksHTML, newsPickRows: newsPickRows })
  `) as {
    S: { newsEdit: unknown; newsPick: unknown; newsUndo: unknown; lang: string };
    MEDIA: { on: boolean | null };
    NEWS_UP: Record<string, { phase: string; pct: number; err: string; prev: string }>;
    NEWS_SRC: Record<string, string>;
    admNewsBlocksHTML: (d: { blocks: ClientBlock[] }, L: string) => string;
    newsPickRows: (q: string, only: string) => string;
  };

  const letter = {
    subject: tri("Тема"),
    blocks: [
      { k: "b1", t: "img", src: IMG, href: `product:${PRODUCT.id}`, alt: "" },
      { k: "b2", t: "text", style: "p", text: tri("Привет <b>всем</b>") },
      { k: "b3", t: "btn", text: tri("В магазин"), href: "" },
      { k: "b4", t: "product", id: PRODUCT.id },
      { k: "b5", t: "html", html: tri("<p>Старый текст</p>") },
    ] as ClientBlock[],
  };

  it("one card per block, in order, each with ↑ ↓ ✕ — the first ↑ and the last ↓ switched off", () => {
    const html = ui.admNewsBlocksHTML(letter, "RU");
    expect((html.match(/data-nbcard="/g) || []).length).toBe(5);
    expect(html.indexOf('data-nbcard="b1"')).toBeLessThan(html.indexOf('data-nbcard="b5"'));
    expect((html.match(/data-nb="del"/g) || []).length).toBe(5);
    expect(html).toMatch(/data-nb="up" data-nbk="b1" disabled/);
    expect(html).toMatch(/data-nb="down" data-nbk="b5" disabled/);
    expect(html).not.toMatch(/data-nb="up" data-nbk="b2" disabled/);
  });

  it("a picture shows itself and where it leads; a text is escaped into its box; a button without a link says so", () => {
    const html = ui.admNewsBlocksHTML(letter, "RU");
    expect(html).toContain(`<img src="${IMG}" alt="">`);
    expect(html).toContain("<span>Товар</span> · <span class=\"adm-nb__nm\">System 4 Bio Botanical Shampoo — шампунь</span>");
    expect(html).toContain("Привет &lt;b&gt;всем&lt;/b&gt;</textarea>");
    expect(html).toContain("Выберите, куда ведёт кнопка");
    expect(html).toContain('<div class="adm-nb__old" data-notr><p>Старый текст</p></div>');
    // the four ways to add, and the phone's own picker behind «+ Картинка»
    for (const v of ["img", "text", "btn", "product"]) expect(html).toContain(`data-nb="add" data-v="${v}"`);
    expect(html).toMatch(/<input class="adm-file" type="file" accept="image\/\*" multiple data-nbfile="add"/);
  });

  it("while a picture travels its block shows how far it has got, and nothing to press", () => {
    ui.NEWS_UP.b9 = { phase: "up", pct: 42.4, err: "", prev: "data:image/jpeg;base64,AAAA" };
    const html = ui.admNewsBlocksHTML({ blocks: [{ k: "b9", t: "img", src: "", href: "", alt: "" }] }, "RU");
    expect(html).toContain("Загружаем… 42 %");
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('<img src="data:image/jpeg;base64,AAAA" alt="">');
    expect(html).not.toContain('data-nb="repic"');
    expect(html).not.toContain('data-nb="unpic"');
    ui.NEWS_UP.b9 = { phase: "err", pct: 0, err: "Не удалось загрузить фото: нет связи — проверьте интернет и попробуйте ещё раз.", prev: "" };
    const failed = ui.admNewsBlocksHTML({ blocks: [{ k: "b9", t: "img", src: "", href: "", alt: "" }] }, "RU");
    expect(failed).toContain('role="alert">Не удалось загрузить фото: нет связи');
    // …and the one big button again, to try another photo
    expect(failed).toMatch(/<button class="adm-btn adm-btn--tall adm-nb__add" data-nb="repic" data-nbk="b9">[\s\S]*<span>Добавить фото<\/span><\/button>/);
    delete ui.NEWS_UP.b9;
  });

  /* Dim, 24.09.2026: «we need picture upload … it needs to be very simple». */
  it("a picture block with no picture is one big «Добавить фото», the address only a small link under it", () => {
    const html = ui.admNewsBlocksHTML({ blocks: [{ k: "b7", t: "img", src: "", href: "", alt: "" }] }, "RU");
    expect(html).toContain('<button class="adm-btn adm-btn--tall adm-nb__add" data-nb="repic" data-nbk="b7">');
    expect(html).toContain('<input class="adm-file" type="file" accept="image/*" data-nbfile="b7"');
    expect(html).toContain('data-nb="srcopen" data-nbk="b7">или вставить ссылку на картинку</button>');
    expect(html, "the address box is open before anybody asked for it").not.toContain('data-nbf="src"');
    expect(html).not.toContain("не подключена");
    // the small link opens the box — and the upload is still offered above it
    ui.NEWS_SRC.b7 = "";
    const open = ui.admNewsBlocksHTML({ blocks: [{ k: "b7", t: "img", src: "", href: "", alt: "" }] }, "RU");
    expect(open).toContain('data-nbf="src" data-nbk="b7"');
    expect(open).toContain('data-nb="srcok" data-nbk="b7"');
    expect(open).toContain("adm-nb__add");
    expect(open).not.toContain("не подключена");
    delete ui.NEWS_SRC.b7;
  });

  it("a picture in the letter: the photo, «Заменить» and «Убрать», and where it leads", () => {
    const html = ui.admNewsBlocksHTML({ blocks: [{ k: "b6", t: "img", src: IMG, href: "", alt: "" }] }, "RU");
    expect(html).toContain(`<img src="${IMG}" alt="">`);
    expect(html).toContain('data-nb="repic" data-nbk="b6">Заменить</button>');
    expect(html).toContain('data-nb="unpic" data-nbk="b6">Убрать</button>');
    expect(html).not.toContain("Добавить фото");
    expect(html).not.toContain('data-nbf="src"');
    expect(html).toContain("Куда ведёт картинка");
  });

  it("with no bucket on the server a picture block asks for an address instead of a photo", () => {
    ui.MEDIA.on = false;
    const html = ui.admNewsBlocksHTML({ blocks: [{ k: "b8", t: "img", src: "", href: "", alt: "" }] }, "RU");
    expect(html).toContain('data-nbf="src" data-nbk="b8"');
    expect(html).toContain("Загрузка фото на сервере не подключена — вставьте адрес картинки.");
    expect(html).not.toContain('data-nb="repic"');
    // a picture already in the letter can still be taken out
    const inLetter = ui.admNewsBlocksHTML({ blocks: [{ k: "b8", t: "img", src: IMG, href: "", alt: "" }] }, "RU");
    expect(inLetter).toContain('data-nb="unpic"');
    expect(inLetter).not.toContain('data-nb="repic"');
    ui.MEDIA.on = null;
    const unknown = ui.admNewsBlocksHTML({ blocks: [{ k: "b8", t: "img", src: "", href: "", alt: "" }] }, "RU");
    expect(unknown, "an unanswered probe is not a «no»").toContain('data-nb="repic"');
    expect(unknown).toContain("Добавить фото");
    expect(unknown).not.toContain("не подключена");
    ui.MEDIA.on = true;
  });

  it("an Estonian text left empty shows the Russian one under it, never as its value", () => {
    const html = ui.admNewsBlocksHTML({ blocks: [{ k: "b2", t: "text", style: "p", text: tri("Привет") }] }, "ET");
    expect(html).toContain('<span>По-русски:</span> <span data-notr>Привет</span>');
    expect(html).toContain("></textarea>");
  });

  it("the picker lists the shop's places, and finds products, brands and published articles by a word", () => {
    const empty = ui.newsPickRows("", "");
    for (const v of ["home", "blog", "gift", "cat:hair", "cat:beard"]) expect(empty).toContain(`data-v="${v}"`);
    expect(empty, "a product before anything is typed").not.toContain('data-v="product:');
    const found = ui.newsPickRows("бород", "");
    expect(found).toContain('data-v="cat:beard"');
    expect(found).toContain('data-v="post:boroda"');
    expect(found, "a draft article is no place to send a reader").not.toContain("post:draft");
    expect(ui.newsPickRows("system", "")).toContain(`data-v="product:${PRODUCT.id}"`);
    expect(ui.newsPickRows("system", "")).toContain('data-v="brand:system-4"');
    // «+ Товар»: products only, with some to tap before anything is typed
    const only = ui.newsPickRows("", "product");
    expect(only).toContain(`data-v="product:${PRODUCT.id}"`);
    expect(only).not.toContain('data-v="home"');
    expect(ui.newsPickRows("zzzz", "")).toContain("Ничего не нашлось");
  });

  it("the open picker sits under its own block, with the address box and «Убрать ссылку» when there is a link", () => {
    ui.S.newsPick = { k: "b1", q: "", only: "", url: "" };
    ui.S.newsEdit = letter;
    const html = ui.admNewsBlocksHTML(letter, "RU");
    const at = html.indexOf('data-nbpick="b1"');
    expect(at).toBeGreaterThan(html.indexOf('data-nbcard="b1"'));
    expect(at).toBeLessThan(html.indexOf('data-nbcard="b2"'));
    expect(html).toContain('data-nbf="url" data-nbk="b1"');
    expect(html).toContain('data-nb="unlink" data-nbk="b1"');
    ui.S.newsPick = null;
    ui.S.newsEdit = null;
  });
});

describe("a picture from the phone goes up as a letter's picture, and says how far it has got", () => {
  type Answer = { status: number; body: string } | "network";
  function upload(answer: Answer) {
    return runInNewContext(`
      var sent = null, seen = [];
      function FormData() { this.parts = []; }
      FormData.prototype.append = function (k, v) { this.parts.push([k, v]); };
      function XMLHttpRequest() { this.upload = {}; }
      XMLHttpRequest.prototype.open = function (m, u) { this.method = m; this.url = u; };
      XMLHttpRequest.prototype.send = function (fd) {
        var x = this, a = ${JSON.stringify(answer)};
        sent = { method: x.method, url: x.url, parts: fd.parts };
        x.upload.onprogress({ lengthComputable: true, loaded: 50, total: 200 });
        x.upload.onprogress({ lengthComputable: true, loaded: 200, total: 200 });
        if (a === "network") { x.onerror(); return; }
        x.status = a.status; x.responseText = a.body; x.onload();
      };
      ${sliceFn("newsXhrUpload")}
      var done = newsXhrUpload("BLOB", function (p) { seen.push(p); }).then(
        function (j) { return { ok: true, url: j.url }; },
        function (e) { return { ok: false, code: e.message }; });
      ({ done: done, sent: function () { return sent; }, seen: seen })
    `) as { done: Promise<{ ok: boolean; url?: string; code?: string }>; sent: () => { method: string; url: string; parts: string[][] }; seen: number[] };
  }

  it("POSTs the file with kind=news to the upload route and reports 25 %, then 100 %", async () => {
    const u = upload({ status: 200, body: JSON.stringify({ ok: true, url: IMG }) });
    expect(await u.done).toEqual({ ok: true, url: IMG });
    expect(u.sent()).toEqual({ method: "POST", url: "/api/admin/upload/", parts: [["file", "BLOB"], ["kind", "news"]] });
    expect(u.seen).toEqual([25, 100]);
  });

  it("names every refusal by the code the panel has a sentence for", async () => {
    expect(await upload({ status: 503, body: JSON.stringify({ ok: false, error: "storage_not_configured" }) }).done)
      .toEqual({ ok: false, code: "storage_not_configured" });
    expect(await upload({ status: 415, body: JSON.stringify({ ok: false, error: "heic_unsupported" }) }).done)
      .toEqual({ ok: false, code: "heic_unsupported" });
    // the platform's own body cap answers 413 with no JSON in it
    expect(await upload({ status: 413, body: "Request Entity Too Large" }).done).toEqual({ ok: false, code: "payload_too_large" });
    expect(await upload({ status: 401, body: "{}" }).done).toEqual({ ok: false, code: "unauthorized" });
    expect(await upload("network").done).toEqual({ ok: false, code: "network" });
    // a 200 that is not a picture is not a success
    expect(await upload({ status: 200, body: JSON.stringify({ ok: true }) }).done).toEqual({ ok: false, code: "upload_failed" });
  });
});

describe("«Перевести на ET и EN» writes each translation into its own block", () => {
  function run(reply: Record<string, string> | null) {
    return runInNewContext(`
      var sent = [];
      function productsById() { return []; }
      function newsGenErrText() { return "Не получилось — попробуйте ещё раз"; }
      function apiSend(url, method, body) {
        sent.push(body);
        return Promise.resolve(${JSON.stringify(reply)} ? { status: 200, body: { ok: true, texts: ${JSON.stringify(reply)} } } : { status: 502, body: { ok: false } });
      }
      ${sliceFn("newsProductIds")}
      ${sliceFn("newsUnits")}
      ${sliceFn("newsPackUnits")}
      ${sliceFn("newsUnpackUnits")}
      ${sliceFn("newsTranslateBlocks")}
      var d = { subject: { RU: "Новинки", ET: "", EN: "" }, blocks: [
        { k: "a", t: "img", src: "x", href: "", alt: "" },
        { k: "b", t: "text", style: "p", text: { RU: "Абзац один.\\n\\nАбзац два.", ET: "", EN: "" } },
        { k: "c", t: "btn", text: { RU: "В магазин", ET: "", EN: "" }, href: "home" }
      ] };
      ({ d: d, sent: sent, done: newsTranslateBlocks(d).then(function () { return "ok"; }, function (e) { return e.message; }) })
    `) as { d: { subject: Tri; blocks: ClientBlock[] }; sent: Array<{ task: string; input: { text: string; targetLangs: string[] } }>; done: Promise<string> };
  }

  it("one request for both languages; every unit lands in its block, paragraphs and all", async () => {
    const r = run({
      ET: "[[1]] Uudised\n\n[[2]] Lõik üks.\n\nLõik kaks.\n\n[[3]] Poodi",
      EN: "[[1]] News\n\n[[2]] Paragraph one.\n\nParagraph two.\n\n[[3]] To the shop",
    });
    expect(await r.done).toBe("ok");
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].task).toBe("translate");
    expect(r.sent[0].input.targetLangs).toEqual(["ET", "EN"]);
    expect(r.d.subject).toEqual({ RU: "Новинки", ET: "Uudised", EN: "News" });
    expect(r.d.blocks[1].text).toEqual({ RU: "Абзац один.\n\nАбзац два.", ET: "Lõik üks.\n\nLõik kaks.", EN: "Paragraph one.\n\nParagraph two." });
    expect(r.d.blocks[2].text).toEqual({ RU: "В магазин", ET: "Poodi", EN: "To the shop" });
  });

  it("a reply that lost a unit changes nothing and says so", async () => {
    const r = run({ ET: "[[1]] Uudised [[3]] Poodi", EN: "[[1]] News [[2]] P [[3]] Shop" });
    expect(await r.done).toBe("Перевод пришёл неполным — попробуйте ещё раз");
    expect(r.d.subject.ET).toBe("");
    expect(r.d.blocks[2].text!.EN).toBe("");
  });

  it("a refused request is the assistant's own message", async () => {
    expect(await run(null).done).toBe("Не получилось — попробуйте ещё раз");
  });
});

describe("addresses typed by hand", () => {
  it("a page address: https added to a bare domain, anything but http(s) refused", () => {
    expect(app.newsUrlOk("rempireshop.com/shop2/c/hair/")).toBe("https://rempireshop.com/shop2/c/hair/");
    expect(app.newsUrlOk("https://aromatic89.ee/uudised")).toBe("https://aromatic89.ee/uudised");
    for (const bad of ["javascript:alert(1)", "mailto:a@b.ee", "https://", "just words", 'https://x.ee/"a']) {
      expect(app.newsUrlOk(bad), bad).toBe("");
    }
  });

  it("a picture's address: https or a path on this shop", () => {
    expect(app.newsImgOk(IMG)).toBe(IMG);
    expect(app.newsImgOk("/shop/img/x.webp")).toBe("/shop/img/x.webp");
    for (const bad of ["http://x.ee/a.jpg", "javascript:alert(1)", "//evil/x.jpg", "data:image/png;base64,AAAA"]) {
      expect(app.newsImgOk(bad), bad).toBe("");
    }
  });
});
