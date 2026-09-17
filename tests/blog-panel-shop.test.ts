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

function blogScreen(S: Partial<BlogState>): string {
  const run = new Function(
    "S", "admHead", "admBlogRowHTML", "esc", "admBlogEditorScreen",
    `${slice("admBlogScreen")} return admBlogScreen();`,
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
    function closeScannerState() {}
    function goodsBackToRow() {}
    function vidReset() {}
    function blogReadForm() { onRead(); }
    function blogDirty() { return DIRTY; }
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
    ${slice("esc")}
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
/** What «Товар» leaves in the body: the words and the price as they were then. */
const marker = (id: string) =>
  el("A", { "data-product": id, href: "/shop2/p/" + id + "/" }, [text("Proraso Beard Oil — 12,90 €")]);

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
});

/* ---------- moderating a review when the call never came back ------------ */

type Moderation = { toasts: string[]; reloads: number };

function moderate(answer: Answer): Promise<Moderation> {
  const toasts: string[] = [];
  let reloads = 0;
  const apiSend = () => (answer === "throw" ? Promise.reject(new Error("no-api")) : Promise.resolve(answer));
  const branch = sliceBranch('else if (a.type === "moderate_review")').replace(/^else\s+/, "");
  const run = new Function("a", "apiSend", "toast", "loadAdminReviews", branch);
  run(
    { type: "moderate_review", id: "r1", value: "approved" },
    apiSend,
    (m: string) => toasts.push(m),
    () => { reloads++; },
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
