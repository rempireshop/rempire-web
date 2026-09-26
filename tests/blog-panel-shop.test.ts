/**
 * The browser halves of the round-19 blog/reviews sweep — the four places
 * where public/shop2/app.js told the owner or the shopper something that was
 * not so:
 *
 *   · «Блог» drew «Пока нет ни одной статьи» when the list failed to load
 *     (401 on an expired cookie, 503 on a database outage) — an invitation to
 *     write another article over the ones already there;
 *   · Back (the phone's swipe) closed the article editor and threw an unsaved
 *     draft away without asking, while «← Блог» asked;
 *   · an inline product card whose product has left the shelf fell back to the
 *     stored link — the price as it was when the article was written, and an
 *     address the shop no longer has;
 *   · «Опубликовать» on a review raised the green toast and then swallowed a
 *     504 or a dropped connection, so the owner walked away believing a review
 *     was live that the shop had never saved;
 *   · a rating tapped after every other field left «Отправить отзыв» grey.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so — like
 * tests/admin-toship.test.ts and tests/checkout-parity.test.ts — the pieces
 * under test are **sliced out of public/shop2/app.js by source text** and run
 * against stubs. Retyping them would test this file instead of the shop, and
 * the slice fails loudly the day app.js renames one of them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** `function <name>(…) { … }` out of app.js, by brace matching. */
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

/** `var <name> = …;` out of app.js — the allowlist tables the cleaner reads. */
function sliceVar(name: string): string {
  const start = src.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`no terminating ; for var ${name} in app.js`);
}

/**
 * One `if (…) { … }` / `else if (…) { … }` branch of a big dispatcher, with
 * any leading `else ` dropped so it stands on its own.
 */
function sliceBranch(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has the branch «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in the branch «${head}»`);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- «Блог»: a list that did not load is not an empty blog -------- */

type Answer = { status: number; body: Record<string, unknown> } | "throw";

type BlogState = {
  adminBlog: unknown[] | null;
  adminBlogListErr: boolean;
  screen: string;
  adminTab: string;
  adminBlogEdit: unknown;
  adminBlogEditBusy: boolean;
};

async function loadList(answer: Answer, S: Partial<BlogState> = {}): Promise<BlogState & { srv: { admin: unknown } }> {
  const state: BlogState = {
    adminBlog: null, adminBlogListErr: false, screen: "admin", adminTab: "blog",
    adminBlogEdit: null, adminBlogEditBusy: false, ...S,
  };
  const SRV = { admin: true as unknown };
  const apiJson = () => (answer === "throw" ? Promise.reject(new Error("no-api")) : Promise.resolve(answer));
  const run = new Function("S", "SRV", "apiJson", "render", `${slice("loadAdminBlog")} loadAdminBlog(true);`);
  run(state, SRV, apiJson, () => {});
  await flush();
  return Object.assign(state, { srv: SRV });
}

/* 1a: the screen is the header, the list pane and the editor pane side by
   side (admBlogScreen); the list itself is admBlogListHTML, which draws the
   states this file is about. An article whose delete is being held
   (BLOG_HELD) is already gone from it. */
function blogScreen(S: Partial<BlogState>): string {
  const run = new Function(
    "S", "admBlogHeadHTML", "admBlogRowHTML", "esc", "admBlogEditorScreen",
    `var BLOG_HELD = {}; ${slice("admBlogListHTML")} ${slice("admBlogScreen")} return admBlogScreen();`,
  ) as (...a: unknown[]) => string;
  return run(
    { adminBlog: null, adminBlogListErr: false, adminBlogEdit: null, adminBlogEditBusy: false, ...S },
    () => "<head>",
    (p: { id: string }) => `<row:${p.id}>`,
    (s: string) => s,
    () => "<editor>",
  );
}

const post = (id: string) => ({ id, title: { RU: "Статья" }, slug: id });
const EMPTY_INVITE = "Пока нет ни одной статьи";
const LIST_FAILED = "Статьи не загрузились";

describe("«Блог» — the admin list that did not load", () => {
  it("keeps a list it already has when a refresh fails, and says so", async () => {
    const S = await loadList("throw", { adminBlog: [post("a")] });
    expect(S.adminBlog).toHaveLength(1);
    expect(S.adminBlogListErr).toBe(true);
    const html = blogScreen(S);
    expect(html).toContain("<row:a>");
    expect(html).toContain(LIST_FAILED);
  });

  it("does not offer «+ Статья» as the empty state on a 503", async () => {
    const S = await loadList({ status: 503, body: { ok: false, error: "unavailable" } });
    expect(S.adminBlogListErr).toBe(true);
    const html = blogScreen(S);
    expect(html).not.toContain(EMPTY_INVITE);
    expect(html).toContain(LIST_FAILED);
    // …and «Повторить» has to be a switch the delegated click list carries
    expect(html).toContain('data-admreload="blog"');
    expect(src).toContain('d.admreload === "blog"');
  });

  it("says the same when the answer is not JSON at all", async () => {
    const S = await loadList("throw");
    expect(S.adminBlogListErr).toBe(true);
    expect(blogScreen(S)).toContain(LIST_FAILED);
  });

  /* An expired cookie is a sign-in, not a «Повторить» that can never work —
     the answer every other loader in the panel already gives. */
  it("drops back to the sign-in card on a 401 instead of a retry line", async () => {
    const S = await loadList({ status: 401, body: { ok: false, error: "auth" } });
    expect(S.srv.admin).toBe(false);
    expect(S.adminBlogListErr).toBe(false);
  });

  it("still shows the ordinary empty state for a blog with no articles", async () => {
    const S = await loadList({ status: 200, body: { ok: true, posts: [] } });
    expect(S.adminBlogListErr).toBe(false);
    const html = blogScreen(S);
    expect(html).toContain(EMPTY_INVITE);
    expect(html).not.toContain(LIST_FAILED);
  });

  it("clears the warning once the list comes back", async () => {
    const S = await loadList({ status: 200, body: { ok: true, posts: [post("a")] } }, { adminBlogListErr: true });
    expect(S.adminBlogListErr).toBe(false);
    expect(blogScreen(S)).not.toContain(LIST_FAILED);
  });
});

/* ---------- what the editor says when a save is refused ------------------ */

function saveErrText(message: string): string {
  const run = new Function(
    "e",
    `${sliceVar("BLOG_SAVE_ERR")} ${sliceVar("BLOG_ERR_TEXT")} ${slice("blogSaveErrText")} return blogSaveErrText(e);`,
  ) as (e: unknown) => string;
  return run(new Error(message));
}

describe("a refused save in the article editor", () => {
  /* upsertPost() used to cut a body past BODY_MAX to length and save it, and
     the panel answered «Черновик сохранён ✓» over the shortened article
     (src/lib/blog.ts, tests/blog.test.ts). It refuses now, so the panel has
     to say what the owner can do about it — «попробуйте ещё раз» would fail
     again, every time. */
  it("names the length as the reason, not «попробуйте ещё раз»", () => {
    expect(saveErrText("body_too_long")).toBe("Статья слишком длинная — сократите текст и сохраните ещё раз.");
    // the route really answers by that name — tests/blog.test.ts holds the other half
    expect(readFileSync(fileURLToPath(new URL("../src/lib/blog.ts", import.meta.url)), "utf8"))
      .toContain('"body_too_long"');
  });

  it("keeps the ordinary sentence for everything else, Object.prototype included", () => {
    for (const code of ["save_failed", "unavailable", "not_found", "constructor", "toString"]) {
      expect(saveErrText(code), code).toBe("Не получилось сохранить — попробуйте ещё раз.");
    }
  });
});

/* ---------- Back over the article editor -------------------------------- */

type Layers = {
  close: () => boolean;
  S: Record<string, unknown>;
  reads: () => number;
};

function panel(opts: { dirty: boolean; confirmBack?: boolean }): Layers {
  const S: Record<string, unknown> = {
    screen: "admin", adminEdit: "", adminOrder: 0, admCustOpen: "", mailOpen: false,
    admSetPage: "", adminBlogEdit: { slug: "x" }, admMore: false, scanOpen: false, scanApp: false,
    adminBlogTool: "link", adminBlogConfirmBack: !!opts.confirmBack,
  };
  let reads = 0;
  const body = `
    var ADM_TRAIL = [], pendingAction = null, BLOGSEL = {}, BLOGCARET = {}, AI_UNDO = null;
    var GAL = { id: "" };
    function admTrailBack() {}
    // 1a: Back and the nav send what a field still owes first (admAutosaveFlush) — nothing is owed here
    function admAutosaveFlush() {}
    // …and the product card closing: its fields forget, «Новый товар» keeps its draft
    function edAsForget() {}
    function goodsNewSave() {}
    function closeScannerState() {}
    function goodsBackToRow() {}
    function vidReset() {}
    function blogReadForm() { onRead(); }
    function blogDirty() { return DIRTY; }
    // 1a: an article that can be saved saves itself and closes; these are the ones that cannot (no Russian title)
    function blogSavesItself() { return false; }
    function blogAutosave() {}
    ${slice("admLayers")}
    ${slice("admCloseTop")}
    return admCloseTop;
  `;
  const make = new Function("S", "DIRTY", "onRead", body) as (
    s: unknown, d: boolean, r: () => void,
  ) => () => boolean;
  const close = make(S, opts.dirty, () => { reads++; });
  return { close, S, reads: () => reads };
}

describe("Back over the article editor", () => {
  it("asks before it throws an unsaved article away", () => {
    const p = panel({ dirty: true });
    expect(p.close()).toBe(true);           // the layer was handled — Back stays in the panel
    expect(p.S.adminBlogEdit).not.toBeNull(); // …and the draft is still there
    expect(p.S.adminBlogConfirmBack).toBe(true);
    // the screen, not the last `input` event, is what the question is asked about
    expect(p.reads()).toBe(1);
  });

  it("closes on the second Back, exactly as the second press of «← Блог» does", () => {
    const p = panel({ dirty: true, confirmBack: true });
    expect(p.close()).toBe(true);
    expect(p.S.adminBlogEdit).toBeNull();
    expect(p.S.adminBlogConfirmBack).toBe(false);
  });

  it("closes a saved article at once — nothing to lose, nothing to ask", () => {
    const p = panel({ dirty: false });
    expect(p.close()).toBe(true);
    expect(p.S.adminBlogEdit).toBeNull();
    expect(p.S.adminBlogTool).toBe("");
  });
});

/* ---------- an inline card whose product has left the shelf -------------- */

type Node = {
  nodeType: number;
  nodeValue?: string;
  tagName?: string;
  childNodes?: Node[];
  getAttribute?: (k: string) => string | null;
};

const text = (v: string): Node => ({ nodeType: 3, nodeValue: v });
const el = (tagName: string, attrs: Record<string, string> = {}, kids: Node[] = []): Node => ({
  nodeType: 1, tagName, childNodes: kids, getAttribute: (k) => (k in attrs ? attrs[k] : null),
});

/** blogCleanNode() over one node, with `blogProductHTML` answering for `live` only. */
function clean(node: Node, opts: { cards: boolean; live?: string[] }): string {
  const body = `
    ${sliceVar("BLOG_TAGS")}
    ${sliceVar("BLOG_ALIAS")}
    ${sliceVar("BLOG_TAGS_DROP")}
    ${sliceVar("BLOG_DROP_EMPTY")}
    ${sliceVar("BLOG_PRODUCT_ID")}
    ${sliceVar("BLOG_MAX_DEPTH")}
    ${sliceVar("BLOG_FIG")}
    ${slice("esc")}
    ${slice("blogFigOf")}
    ${slice("blogLivePrice")}
    ${slice("blogImgUrl")}
    ${slice("blogSafeUrl")}
    function blogProductHTML(id) { return LIVE.indexOf(id) < 0 ? "" : '<button data-go-product="' + id + '"></button>'; }
    ${slice("blogCleanNodes")}
    ${slice("blogCleanNode")}
    return blogCleanNode(NODE, 0, CARDS);
  `;
  const run = new Function("NODE", "CARDS", "LIVE", body) as (n: Node, c: boolean, l: string[]) => string;
  return run(node, opts.cards, opts.live ?? []);
}

const OIL = "proraso-beard-oil-azur-lime-30ml";
/** What «Товар» left in the body until 17.09.2026: the words and the price as
 *  they were on the day it was pressed. Every article published before that
 *  is in this shape, and stays in it. */
const marker = (id: string) =>
  el("A", { "data-product": id, href: "/shop2/p/" + id + "/" }, [text("Proraso Beard Oil — 12,90 €")]);
/** …and what it leaves now: the words, and a marker where the price was. */
const liveMarker = (id: string) =>
  el("A", { "data-product": id, "data-price": "live", href: "/shop2/p/" + id + "/" }, [text("Proraso Beard Oil")]);

describe("the two sanitisers are one rule", () => {
  /* There are two: `src/lib/blog-html.mjs`, which the server and the build run,
     and `blogCleanNode()` in app.js, a DOMParser version with no build step
     that genuinely cannot share the code. A deliberate twin still has to agree,
     and it has drifted three times — once silently stripping the owner's
     picture presets from every prerendered article for months, because nothing
     ever fed one body through both. `XML` was the live half of it on
     19.09.2026: on the server list, missing from the client's, so a bare <xml>
     block kept its text in the editor preview and lost it in the saved
     article (audit F36). Comparing the tables is what stops the next one. */
  const serverSrc = readFileSync(
    fileURLToPath(new URL("../src/lib/blog-html.mjs", import.meta.url)),
    "utf8",
  ).replace(/\r\n?/g, "\n");

  it("drops exactly the same tags on both sides", () => {
    const serverList = serverSrc.slice(serverSrc.indexOf("const HTML_DROP = new Set(["));
    const server = new Set(
      (serverList.slice(0, serverList.indexOf("]")).match(/"([a-z]+)"/g) ?? []).map((q) =>
        q.replace(/"/g, "").toUpperCase(),
      ),
    );
    const client = new Set(
      Object.keys(new Function(`${sliceVar("BLOG_TAGS_DROP")} return BLOG_TAGS_DROP;`)() as Record<string, number>),
    );
    expect(server.size).toBeGreaterThan(5);
    expect([...client].sort()).toEqual([...server].sort());
  });
});

describe("an inline product card on the storefront", () => {
  it("becomes the live card while the product is on the shelf", () => {
    expect(clean(marker(OIL), { cards: true, live: [OIL] })).toBe(`<button data-go-product="${OIL}"></button>`);
  });

  it("shows neither the old price nor the dead link once the product is gone", () => {
    const out = clean(marker(OIL), { cards: true });
    expect(out).not.toContain("12,90");
    expect(out).not.toContain("href");
    expect(out).toBe("");
  });

  it("takes the emptied paragraph with it, so no blank block is left behind", () => {
    // what the assistant writes: an empty marker alone in its own paragraph
    const para = el("P", {}, [el("A", { "data-product": OIL }, [])]);
    expect(clean(para, { cards: true })).toBe("");
  });

  it("leaves an ordinary link alone, and keeps the marker where cards are off", () => {
    const link = el("A", { href: "https://example.com/a" }, [text("сайт")]);
    expect(clean(link, { cards: true })).toBe('<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">сайт</a>');
    // the editor cleans the same body with cards off — the owner must still see his card
    expect(clean(marker(OIL), { cards: false })).toContain(`data-product="${OIL}"`);
  });

  /* The price inside the text stopped being stored on 17.09.2026 — it is
     filled in by whoever renders the page. The two shapes live side by side
     for good: the storefront rebuilds the card from the catalogue either way,
     and the editor must hand back whichever shape it was given. */
  it("keeps the price-free marker whole when the editor cleans the body", () => {
    const out = clean(liveMarker(OIL), { cards: false });
    expect(out).toContain(`data-product="${OIL}"`);
    expect(out).toContain('data-price="live"');
    expect(out).toContain("Proraso Beard Oil");
    expect(out).not.toContain("€");
  });

  it("is the same live card on the storefront, whichever shape the marker is", () => {
    const card = `<button data-go-product="${OIL}"></button>`;
    expect(clean(liveMarker(OIL), { cards: true, live: [OIL] })).toBe(card);
    expect(clean(marker(OIL), { cards: true, live: [OIL] })).toBe(card);
  });

  it("writes no data-price where there was none, and none on an ordinary link", () => {
    expect(clean(marker(OIL), { cards: false })).not.toContain("data-price");
    // `data-price` means nothing without a product: it is not an attribute
    // anybody may put on a link in an article
    const link = el("A", { "data-price": "live", href: "https://example.com/a" }, [text("сайт")]);
    expect(clean(link, { cards: false })).not.toContain("data-price");
  });
});

/* ---------- a picture's size, and its trip through a translation ---------- */

/** blogFigsIn() — the half of the round-trip that is pure string work. */
function figsIn(html: string, figs: Array<{ src: string; alt: string; fig: string }>): string {
  const body = `
    ${sliceVar("BLOG_FIG")}
    ${sliceVar("BLOG_FIG_MARK_RX")}
    ${slice("esc")}
    ${slice("blogFigOf")}
    ${slice("blogImgUrl")}
    ${slice("blogFigMark")}
    ${slice("blogFigHTML")}
    ${slice("blogFigsIn")}
    return blogFigsIn(HTML, FIGS);
  `;
  const run = new Function("HTML", "FIGS", body) as (h: string, f: unknown[]) => string;
  return run(html, figs);
}

const PIC = { src: "/shop/img/night-rider-0.webp", alt: "паста", fig: "half-left" };

describe("a picture inside the text", () => {
  it("keeps the size the owner chose, and refuses one nobody offered", () => {
    for (const fig of ["full", "half-left", "half-right", "small"]) {
      const node = el("FIGURE", { "data-fig": fig }, [el("IMG", { src: PIC.src, alt: "" })]);
      expect(clean(node, { cards: false })).toBe(
        `<figure data-fig="${fig}"><img src="${PIC.src}" alt="" loading="lazy"></figure>`,
      );
    }
    const bad = el("FIGURE", { "data-fig": "enormous" }, [el("IMG", { src: PIC.src, alt: "" })]);
    expect(clean(bad, { cards: false })).toBe(`<figure><img src="${PIC.src}" alt="" loading="lazy"></figure>`);
  });

  /* The promise the whole feature is judged on: a body written before the
     presets existed has a bare <figure>, and a bare <figure> has to come out
     of the cleaner bare — in the editor, on the article page and in the
     prerendered copy, all three of which run this function or its twin in
     src/lib/blog.ts. */
  it("leaves an article written before the presets exactly as it was", () => {
    const old = el("FIGURE", {}, [el("IMG", { src: PIC.src, alt: "кот" })]);
    expect(clean(old, { cards: false })).toBe(`<figure><img src="${PIC.src}" alt="кот" loading="lazy"></figure>`);
  });

  /* «Перевести на ET и EN» flattens the body to text for the model, which
     used to cost every picture its <figure> — and would now cost it the size
     and the side with it. The pictures are lifted out first and put back
     after, exactly as the product cards are. */
  it("comes back from a translation with its size, its side and its words", () => {
    const out = figsIn("<p>Uus tekst.</p><p>[[i1]]</p><p>Veel teksti.</p>", [PIC]);
    expect(out).toContain('<figure data-fig="half-left">');
    expect(out).toContain(`src="${PIC.src}"`);
    expect(out).toContain('alt="паста"');
    expect(out).not.toContain("[[i1]]");
  });

  it("is appended rather than lost when the model swallowed its token", () => {
    const out = figsIn("<p>Uus tekst ilma märgita.</p>", [PIC]);
    expect(out, "the picture vanished with its token").toContain('<figure data-fig="half-left">');
    expect(out.indexOf("<figure")).toBeGreaterThan(out.indexOf("</p>"));
  });

  it("drops a token the model invented, and never writes a picture it cannot serve", () => {
    expect(figsIn("<p>[[i1]] и ещё [[i7]]</p>", [PIC])).not.toContain("[[i7]]");
    // http:, javascript: — blogImgUrl refuses both, so nothing is written at all
    const bad = [{ src: "javascript:alert(1)", alt: "", fig: "full" }];
    expect(figsIn("<p>[[i1]]</p>", bad)).not.toContain("javascript");
  });
});

/* ---------- moderating a review when the call never came back ------------ */

type Moderation = { toasts: string[]; reloads: number };

function moderate(answer: Answer): Promise<Moderation> {
  const toasts: string[] = [];
  let reloads = 0;
  const apiSend = () => (answer === "throw" ? Promise.reject(new Error("no-api")) : Promise.resolve(answer));
  const branch = sliceBranch('else if (a.type === "moderate_review")').replace(/^else\s+/, "");
  // loadOverview: a moderation that went through also refreshes «Сделать
  // сегодня»; revQueue: one review's calls run one at a time — both halves
  // are tests/blog-reviews-r21.test.ts's
  const run = new Function(
    "a", "apiSend", "toast", "loadAdminReviews", "loadOverview", "shopPoke",
    `${sliceVar("REVQ")} ${slice("revQueue")} ${branch}`,
  );
  run(
    { type: "moderate_review", id: "r1", value: "approved" },
    apiSend,
    (m: string) => toasts.push(m),
    () => { reloads++; },
    () => {},
    () => {},   // the shop's open tabs (shopPoke): nothing to tell here
  );
  return flush().then(() => ({ toasts, reloads }));
}

describe("«Опубликовать» on a review", () => {
  it("says nothing extra when the shop really saved it", async () => {
    const r = await moderate({ status: 200, body: { ok: true } });
    expect(r.toasts).toEqual([]);
    expect(r.reloads).toBe(0);
  });

  it("owns up to a refusal, as it always did", async () => {
    const r = await moderate({ status: 409, body: { ok: false } });
    expect(r.toasts).toEqual(["Не получилось сохранить отзыв"]);
    expect(r.reloads).toBe(1);
  });

  it("owns up to a 504 page or a dropped connection too — the green toast is already on screen", async () => {
    const r = await moderate("throw");
    expect(r.toasts).toEqual(["Не получилось сохранить отзыв"]);
    expect(r.reloads).toBe(1);
  });
});

/* ---------- the stars and «Отправить отзыв» ------------------------------ */

type Stars = { disabled: boolean; label: string };

/** The `[data-revstar]` click branch over a form that is complete but for the rating. */
function tapStar(rating: number, form: Record<string, unknown>): Stars {
  const send = { disabled: true };
  const live = { textContent: "" };
  const stars = [1, 2, 3, 4, 5].map((n) => ({
    dataset: { revstar: String(n) },
    setAttribute() {},
  }));
  const document = {
    querySelectorAll: () => stars,
    querySelector: (sel: string) => (sel === "[data-revsend]" ? send : sel === "[data-revrating]" ? live : null),
  };
  const body = `
    ${slice("reviewReady")}
    ${sliceBranch("if (d.revstar)")}
    return null;
  `;
  const run = new Function("d", "S", "document", body) as (d: unknown, s: unknown, doc: unknown) => void;
  run({ revstar: String(rating) }, { revForm: form }, document);
  return { disabled: send.disabled, label: live.textContent };
}

const FILLED = { name: "Андрей", text: "Беру третий раз, пенится хорошо и запах не бьёт в нос.", consent: true, rating: 0 };

describe("the review form's stars", () => {
  it("enables «Отправить отзыв» when the rating is the last thing filled in", () => {
    const out = tapStar(5, { ...FILLED });
    expect(out.label).toBe("5 из 5");
    expect(out.disabled).toBe(false);
  });

  it("leaves it disabled while something else is still missing", () => {
    expect(tapStar(5, { ...FILLED, consent: false }).disabled).toBe(true);
    expect(tapStar(5, { ...FILLED, name: "" }).disabled).toBe(true);
    expect(tapStar(5, { ...FILLED, text: "коротко" }).disabled).toBe(true);
  });
});

/**
 * A photo the assistant puts INSIDE an article (r25, 18.09.2026).
 *
 * «assistant is not able to add cover photos or photos to articles although it
 * says it does» — Renat. There was no in-article photo action at all, so the
 * model wrote the sentence and sent nothing. `add_post_photo` is that missing
 * half; these are the two decisions it makes about the text before it writes
 * anything back, sliced out of app.js like everything else in this file.
 */
describe("a photo added at the end of an article (add_post_photo)", () => {
  const rig = new Function(
    "body", "url",
    [
      "var LANGS = [[\"RU\"], [\"ET\"], [\"EN\"]];",
      "function esc(x) { return String(x).replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/\"/g, \"&quot;\"); }",
      "function stripTags(h) { return String(h).replace(/<[^>]*>/g, \" \"); }",
      slice("blogTextLen"),
      slice("blogFigureHtml"),
      slice("blogBodyWritten"),
      slice("blogBodies3WithFigure"),
      "return blogBodies3WithFigure(body, url);",
    ].join("\n"),
  ) as (body: unknown, url: string) => Record<string, string>;

  const URL_ = "https://media.rempireshop.com/blog/1757-x.webp";
  const FIG = '<figure data-fig="full"><img src="' + URL_ + '" alt="" loading="lazy"></figure>';

  /* One article, three pages: a reader in Tallinn opening the Estonian one
     must see the picture the owner added, not a paragraph where it should be. */
  it("puts the picture at the end of every language that has an article", () => {
    const out = rig({ RU: "<p>русский</p>", ET: "<p>eesti</p>", EN: "<p>english</p>" }, URL_);
    expect(out.RU).toBe("<p>русский</p>" + FIG);
    expect(out.ET).toBe("<p>eesti</p>" + FIG);
    expect(out.EN).toBe("<p>english</p>" + FIG);
  });

  /* The blog PATCH replaces every field it is given and trilingual() in
     src/lib/blog.ts reads an unmentioned language as an empty one — so a body
     that carried only the languages that changed would erase the others. */
  it("carries an unwritten language through untouched rather than leaving it out", () => {
    const out = rig({ RU: "<p>текст</p>", ET: "", EN: "   " }, URL_);
    expect(Object.keys(out).sort()).toEqual(["EN", "ET", "RU"]);
    expect(out.ET).toBe("");
    expect(out.EN).toBe("   ");
    expect(out.RU).toContain("<figure");
  });

  it("treats a body that is only a picture as written, so a second one goes under it", () => {
    const out = rig({ RU: FIG, ET: "", EN: "" }, URL_);
    expect(out.RU).toBe(FIG + FIG);
  });

  /* A picture has to land somewhere. An article with nothing in it yet is the
     one case with no language to choose, and Russian is the one this blog is
     written in first (pickLang() serves it to the other two anyway). */
  it("falls back to Russian when nothing is written at all", () => {
    expect(rig({ RU: "", ET: "", EN: "" }, URL_).RU).toBe(FIG);
    expect(rig(null, URL_).RU).toBe(FIG);
  });
});
