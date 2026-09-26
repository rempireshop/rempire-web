/**
 * The browser halves of the round-21 blog/reviews sweep — six places where
 * public/shop2/app.js lost something, or said something that was not so:
 *
 *   · «Сохранено ✓» was taken from the draft as it stood when the ANSWER
 *     landed, so a word typed while the save was in the air was marked saved
 *     and then dropped without a word;
 *   · an article that failed to OPEN said «Не получилось сохранить» — the one
 *     thing that was certainly not happening;
 *   · the address box went on following the title after the first save, while
 *     the post kept the address it already had;
 *   · a reviews outage was stored as «no reviews» and the product page invited
 *     the shopper to be the first, over a dozen approved reviews;
 *   · the review draft survived a walk to another product and was one press
 *     from being filed against it;
 *   · moderating a review left «Сделать сегодня» counting it, and changing the
 *     queue's chip left the previous status' rows drawing under the new one.
 *
 * Same method as tests/blog-panel-shop.test.ts: the panel is a vanilla-JS IIFE
 * with no DOM here, so the pieces under test are **sliced out of
 * public/shop2/app.js by source text** and run against stubs. Retyping them
 * would test this file instead of the shop, and the slice fails loudly the day
 * app.js renames one of them.
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

/** `var <name> = …;` out of app.js. */
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

/** One `if`/`else if` branch of a big dispatcher, with any leading `else ` dropped. */
function sliceBranch(head: string, mustContain?: string): string {
  let from = 0;
  for (;;) {
    const start = src.indexOf(head, from);
    if (start < 0) throw new Error(`public/shop2/app.js no longer has the branch «${head}»`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        const body = src.slice(start, i + 1);
        if (!mustContain || body.includes(mustContain)) return body;
        from = start + head.length;
        break;
      }
    }
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
type Any = Record<string, unknown>;

/* ---------- 1. a word typed while the save is in the air ----------------- */

function blogDraft(over: Any = {}): Any {
  return {
    id: "", slug: "", slugAuto: true, status: "draft",
    title: { RU: "Уход за бородой", ET: "", EN: "" },
    excerpt: { RU: "", ET: "", EN: "" },
    body: { RU: "<p>Первый абзац.</p>", ET: "", EN: "" },
    coverUrl: "", coverAlt: { RU: "", ET: "", EN: "" },
    tagsText: "", products: [],
    seoTitle: { RU: "", ET: "", EN: "" }, seoDesc: { RU: "", ET: "", EN: "" },
    author: "Rempire", publishedAt: null, ...over,
  };
}

type SaveRig = {
  S: Any;
  save: (d?: Any) => Promise<Any>;
  dirty: () => boolean;
  mark: (d: Any) => void;
  answer: (post: Any) => void;
  /** Resolves once the request has actually left (apiSend was called). */
  sent: () => Promise<void>;
};

function saveRig(): SaveRig {
  const S: Any = { adminBlogEdit: null, adminBlogSaved: undefined, adminBlog: [], adminBlogConfirmBack: false };
  let settle: ((r: unknown) => void) | null = null;
  const apiSend = () => new Promise((r) => { settle = r; });
  /* 1a: saves of one article queue behind each other (saveBlogFields) and the
     request is built when its turn comes (blogSaveOnce) — a microtask after
     the call. «In the air» therefore starts when apiSend has been called. */
  const run = new Function(
    "S", "apiSend", "blogBody3ToHtml", "blogForget", "noop", "blogListUpsert", "idemNewKey", "blogSendKeepalive", "blogHttpErr",
    `${slice("blogFieldsPayload")} ${slice("blogDraftSig")} ${sliceVar("BLOG_SIG_FIELDS")} ${slice("blogDraftSnap")}
     ${slice("blogMarkSaved")} ${slice("saveBlogFields")} ${slice("blogSaveOnce")} ${slice("blogDirty")}
     return { save: saveBlogFields, dirty: blogDirty, mark: blogMarkSaved };`,
  ) as (...a: unknown[]) => { save: (d?: Any) => Promise<Any>; dirty: () => boolean; mark: (d: Any) => void };
  const api = run(S, apiSend, (b: Any) => b, () => {}, () => {}, () => {}, () => "key", apiSend, () => new Error("save_failed"));
  return {
    S, ...api,
    answer: (post: Any) => settle!({ status: 200, body: { ok: true, post } }),
    sent: async () => { for (let i = 0; i < 20 && !settle; i++) await Promise.resolve(); },
  };
}

const SAVED = { id: "p-1", slug: "uhod-za-borodoj", status: "draft", publishedAt: null };

describe("«Сохранено ✓» is about what was sent, not about the draft when the answer lands", () => {
  it("a word typed while the request is in the air is still «не сохранено»", async () => {
    const rig = saveRig();
    const d = blogDraft();
    rig.S.adminBlogEdit = d;
    rig.mark(d);
    expect(rig.dirty()).toBe(false);

    const saving = rig.save();
    await rig.sent();
    // blogSync() writes every keystroke into the same draft, with no busy check
    (d.body as Any).RU = "<p>Первый абзац.</p><p>И второй, дописанный пока шло сохранение.</p>";
    rig.answer(SAVED);
    await saving;

    expect(rig.dirty()).toBe(true);
  });

  it("a save nothing was typed during is saved — the auto address the server chose included", async () => {
    const rig = saveRig();
    const d = blogDraft();
    rig.S.adminBlogEdit = d;
    rig.mark(d);
    const saving = rig.save();
    await rig.sent();
    rig.answer(SAVED);
    await saving;

    expect(d.slug).toBe("uhod-za-borodoj");
    expect(rig.dirty()).toBe(false);
  });

  it("…and a draft that is no longer the open one does not move the yardstick", async () => {
    const rig = saveRig();
    const d = blogDraft();
    rig.S.adminBlogEdit = d;
    rig.mark(d);
    const was = rig.S.adminBlogSaved;
    const saving = rig.save(d);
    await rig.sent();
    rig.S.adminBlogEdit = null;   // «← Блог» while the request is in the air
    rig.answer(SAVED);
    await saving;
    expect(rig.S.adminBlogSaved).toBe(was);
  });
});

/* ---------- 2. an article that did not OPEN ------------------------------ */

async function openEditor(answer: { status: number; body: Any } | "throw"): Promise<string[]> {
  const said: string[] = [];
  const S: Any = { adminBlogEditBusy: false, adminBlogEdit: null, adminBlogGen: null };
  const apiJson = () => (answer === "throw" ? Promise.reject(new Error("no-api")) : Promise.resolve(answer));
  const run = new Function(
    "S", "apiJson", "render", "toast", "blogDraftFromPost", "blogMarkSaved", "window",
    `${sliceVar("BLOG_OPEN_ERR")} ${slice("openBlogEditor")} openBlogEditor("p-1");`,
  );
  run(S, apiJson, () => {}, (m: string) => said.push(m), (p: Any) => p, () => {}, { scrollTo: () => {} });
  await flush();
  return said;
}

describe("a failed article OPEN says what failed", () => {
  const SAVE_LINE = "Не получилось сохранить — попробуйте ещё раз.";
  const OPEN_LINE = "Не получилось открыть статью — попробуйте ещё раз.";

  it("names the open, not a save that was never asked for — on a 503 and on a dead connection", async () => {
    expect(await openEditor({ status: 503, body: { ok: false, error: "unavailable" } })).toEqual([OPEN_LINE]);
    expect(await openEditor("throw")).toEqual([OPEN_LINE]);
    expect(await openEditor({ status: 503, body: { ok: false } })).not.toContain(SAVE_LINE);
  });

  it("says nothing when the article arrives", async () => {
    expect(await openEditor({ status: 200, body: { ok: true, post: { id: "p-1" } } })).toEqual([]);
  });

  it("the sentence is in the dictionary in both other languages", () => {
    expect(src).toContain(`"${OPEN_LINE}": "Artiklit ei õnnestunud avada — proovi uuesti."`);
    expect(src).toContain(`"${OPEN_LINE}": "Could not open the article — try again."`);
  });
});

/* ---------- 3. the address box after the first save ---------------------- */

function typeTitle(draft: Any, value: string): { box: { value: string }; d: Any } {
  const box = { value: String(draft.slug || "") };
  const S: Any = { adminBlogEdit: draft, adminBlogLang: "RU" };
  const doc = { querySelector: (sel: string) => (sel === "[data-blogslug]" ? box : null) };
  const t = { value, dataset: { blogf: "title", blogl: "RU" } };
  const run = new Function(
    "S", "t", "document", "blogFieldLang", "blogSlugify", "blogPaintState",
    `${sliceBranch('else if (t.matches("[data-blogf]"))', "slugAuto")}`.replace(
      /^else if \(t\.matches\("\[data-blogf\]"\)\)\s*/, "",
    ),
  );
  run(S, t, doc, (el: Any) => (el.dataset as Any).blogl, (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-"), () => {});
  return { box, d: draft };
}

describe("«Адрес страницы» stops following the title once the post has one", () => {
  it("a draft with no row yet still gets its address written as the title is typed", () => {
    const { box, d } = typeTitle(blogDraft({ title: { RU: "", ET: "", EN: "" } }), "Beard care");
    expect(d.slug).toBe("beard-care");
    expect(box.value).toBe("beard-care");
  });

  it("a saved post keeps the address it has — upsertPost would too", () => {
    const d = blogDraft({ id: "p-1", slug: "uhod-za-borodoj", title: { RU: "Уход", ET: "", EN: "" } });
    const { box } = typeTitle(d, "Beard care in winter");
    expect(d.slug).toBe("uhod-za-borodoj");
    expect(box.value).toBe("uhod-za-borodoj");
    // the title itself is still written through
    expect((d.title as Any).RU).toBe("Beard care in winter");
  });
});

/* ---------- 4. a reviews outage is not «no reviews yet» ------------------ */

type RevRig = { S: { dbReviews: Record<string, unknown>; screen: string; productId: string }; load: (id: string) => void; unknown: (id: string) => boolean; rows: (id: string) => unknown[] };

function reviewsRig(answer: Any | "throw" | "degraded"): RevRig {
  const S: RevRig["S"] = { dbReviews: {}, screen: "product", productId: "x" };
  const body = answer === "degraded" ? { ok: true, reviews: [], avg: 0, n: 0, degraded: true } : answer;
  const fetchStub = () =>
    answer === "throw" ? Promise.reject(new Error("offline")) : Promise.resolve({ json: () => Promise.resolve(body) });
  const run = new Function(
    "S", "fetch", "render",
    `${sliceVar("REV_RETRY_MS")} ${sliceVar("revAskedAt")}
     function reviewsFreshStamp() { return 0; }
     ${slice("loadReviews")} ${slice("reviewsUnknown")} ${slice("dbReviewsFor")}
     return { load: loadReviews, unknown: function (id) { return reviewsUnknown({ id: id }); },
              rows: function (id) { return dbReviewsFor({ id: id }); } };`,
  ) as (...a: unknown[]) => Omit<RevRig, "S">;
  return { S, ...run(S, fetchStub, () => {}) };
}

const REVIEW = { id: "r1", name: "Мария", rating: 5, text: "Отличный шампунь", lang: "ru", createdAt: "2026-09-01" };

describe("a product page never says «Отзывов пока нет» over reviews it could not read", () => {
  it("a degraded answer and a dead connection are both «unknown», not «none»", async () => {
    for (const answer of ["degraded", "throw"] as const) {
      const rig = reviewsRig(answer);
      rig.load("x");
      await flush();
      expect(rig.S.dbReviews).toEqual({ x: false });
      expect(rig.unknown("x"), String(answer)).toBe(true);
      expect(rig.rows("x")).toEqual([]);
    }
  });

  it("a product that really has none is still «none», and one with reviews keeps them", async () => {
    const none = reviewsRig({ ok: true, reviews: [], avg: 0, n: 0 });
    none.load("x");
    await flush();
    expect(none.unknown("x")).toBe(false);
    expect(none.S.dbReviews).toEqual({ x: [] });

    const some = reviewsRig({ ok: true, reviews: [REVIEW], avg: 5, n: 1 });
    some.load("x");
    await flush();
    expect(some.unknown("x")).toBe(false);
    expect(some.rows("x")).toEqual([REVIEW]);
  });

  it("an unknown product is asked again; an answered one never is", async () => {
    const rig = reviewsRig("throw");
    rig.load("x");
    await flush();
    rig.S.dbReviews.x = false;
    rig.load("x");                       // the retry window has not passed
    expect(rig.S.dbReviews.x).toBe(false);

    const done = reviewsRig({ ok: true, reviews: [], avg: 0, n: 0 });
    done.load("x");
    await flush();
    done.load("x");
    expect(done.S.dbReviews.x).toEqual([]);
  });

  it("the two sentences are different, and the page chooses between them", () => {
    const run = new Function(`${slice("emptyReviewsHTML")} ${slice("unknownReviewsHTML")}
      return [emptyReviewsHTML(), unknownReviewsHTML()];`) as () => [string, string];
    const [empty, unknown] = run();
    expect(empty).toContain("Отзывов пока нет — станьте первым.");
    expect(unknown).toContain("Отзывы сейчас не загрузились — обновите страницу.");
    expect(unknown).not.toContain("станьте первым");
    expect(src).toContain("reviewsUnknown(p) ? unknownReviewsHTML() : emptyReviewsHTML()");
    expect(src).toContain('"Отзывы сейчас не загрузились — обновите страницу.": "Arvustusi ei õnnestunud laadida — värskenda lehte."');
    expect(src).toContain('"Отзывы сейчас не загрузились — обновите страницу.": "Reviews could not be loaded — refresh the page."');
  });
});

/* ---------- 4b. the price inside an article is in the article's language -- */

function articlePrice(p: Any, L: string, shopLang: string): string {
  const S: Any = { lang: shopLang };
  const run = new Function(
    "S", "UI", "UI_RX", "trName", "proPrice",
    `${slice("eur")} ${slice("trText")} ${slice("blogProductPrice")} return blogProductPrice;`,
  ) as (...a: unknown[]) => (p: Any, L: string) => string;
  // no word tables: this is about the NUMBER, so only the UI_RX rules matter
  const UI_RX = new Function(`${sliceVar("UI_RX")} return UI_RX;`)() as unknown[];
  return run(S, { ET: {}, EN: {} }, UI_RX, (s: string) => s, () => null)(p, L);
}

describe("a product card written into an article carries the article's own price format", () => {
  const SIZED = { id: "x", brand: "System 4", name: "Shampoo", price: 12.9, priceFrom: true };
  const FLAT = { id: "y", brand: "Kevin.Murphy", name: "Easy.Rider", price: 28, priceFrom: false };

  it("the English text of an article gets the English shape, whatever language the panel is in", () => {
    expect(articlePrice(FLAT, "EN", "RU")).toBe("€28");
    expect(articlePrice(SIZED, "EN", "RU")).toBe("from €12.90");
  });

  it("…and the Russian text gets the Russian one, even from an English panel", () => {
    expect(articlePrice(FLAT, "RU", "EN")).toBe("28 €");
    expect(articlePrice(SIZED, "RU", "EN")).toBe("от 12,90 €");
    expect(articlePrice(SIZED, "ET", "EN")).toBe("alates 12,90 €");
  });

  it("eur() without a language is the shopper's, exactly as before", () => {
    const run = new Function("S", `${slice("eur")} return eur;`) as (s: Any) => (n: number, L?: string) => string;
    expect(run({ lang: "RU" })(12.9)).toBe("12,90 €");
    expect(run({ lang: "EN" })(12.9)).toBe("€12.90");
    expect(run({ lang: "ET" })(28)).toBe("28 €");
  });
});

/* ---------- 5. the review draft belongs to one product ------------------- */

function leaveProduct(from: string, to: string, form: Any): Any {
  const S: Any = { productId: from, revForm: form, revOpen: true, revState: "short_text", revAccOpen: true };
  const run = new Function("S", "id", `${slice("revBlankForm")} ${slice("revLeaveProduct")} revLeaveProduct(id);`);
  run(S, to);
  return S;
}

const TYPED = { name: "Мария", rating: 5, text: "Пользуюсь месяц, волосы мягче.", website: "", consent: true };

describe("the review draft belongs to the product it was written on", () => {
  it("a walk to another product takes the draft with it", () => {
    const S = leaveProduct("shampoo", "t-shirt", { ...TYPED });
    expect(S.revForm).toEqual({ name: "", rating: 0, text: "", website: "", consent: false });
    expect(S.revOpen).toBe(false);
    expect(S.revState).toBe("");
    expect(S.revAccOpen).toBe(false);
  });

  it("coming back to the same product does not — Back must not cost what was typed", () => {
    const S = leaveProduct("shampoo", "shampoo", { ...TYPED });
    expect(S.revForm).toEqual(TYPED);
    expect(S.revOpen).toBe(false);
  });

  it("both ways into a product page go through it — a tap and the address bar", () => {
    expect(src).toContain("revLeaveProduct(d.goProduct);");
    expect(src).toContain("revLeaveProduct(found.id);");
    // …and the three fields are reset in exactly one place now
    expect(src.match(/S\.revOpen = false/g)).toHaveLength(1);
  });
});

/* ---------- 6. the queue: «Сделать сегодня», and the chips --------------- */

const MODERATE_BRANCH_HEAD = `${sliceVar("REVQ")} ${slice("revQueue")}`;
const MODERATE_BRANCH_BODY = sliceBranch('else if (a.type === "moderate_review")', "/api/admin/reviews/").replace(/^else /, "");
const MODERATE_BRANCH = `${MODERATE_BRANCH_HEAD} ${MODERATE_BRANCH_BODY}`;

async function moderate(answer: { status: number; body: Any } | "throw"): Promise<{ overview: number; refetch: number; said: string[] }> {
  let overview = 0, refetch = 0;
  const said: string[] = [];
  const apiSend = () => (answer === "throw" ? Promise.reject(new Error("504")) : Promise.resolve(answer));
  const run = new Function("a", "apiSend", "toast", "loadAdminReviews", "loadOverview", "shopPoke", MODERATE_BRANCH);
  run({ type: "moderate_review", id: "r1", value: "approved" }, apiSend,
    (m: string) => said.push(m), () => { refetch++; }, () => { overview++; }, () => {});
  await flush();
  await flush();
  return { overview, refetch, said };
}

/** Both PATCHes for one review, each held open until the test lets it answer. */
function moderateTwice(): { sent: string[]; settle: Array<() => void>; done: () => Promise<void> } {
  const sent: string[] = [];
  const settle: Array<() => void> = [];
  const apiSend = (_u: string, _m: string, body: Any) =>
    new Promise((res) => {
      sent.push(String(body.status));
      settle.push(() => res({ status: 200, body: { ok: true } }));
    });
  // one REVQ across both calls, the way the panel has one: the queue is the
  // point, so it must not be re-created by the second push
  const factory = new Function(
    `${MODERATE_BRANCH_HEAD}
     return function (a, apiSend, toast, loadAdminReviews, loadOverview) { var shopPoke = function () {}; ${MODERATE_BRANCH_BODY} };`,
  ) as () => (...x: unknown[]) => void;
  const run = factory();
  const push = (value: string) =>
    run({ type: "moderate_review", id: "r1", value }, apiSend, () => {}, () => {}, () => {});
  push("approved");
  push("pending");   // «Отменить», a second later
  return { sent, settle, done: async () => { await flush(); await flush(); } };
}

describe("«Сделать сегодня» stops counting a review the owner has just moderated", () => {
  it("a moderation that went through refreshes the cached overview", async () => {
    const r = await moderate({ status: 200, body: { ok: true, review: { id: "r1", status: "approved" } } });
    expect(r.overview).toBe(1);
    expect(r.refetch).toBe(0);
    expect(r.said).toEqual([]);
  });

  it("one that did not still says so, and does not pretend the count moved", async () => {
    for (const answer of [{ status: 503, body: { ok: false } }, "throw" as const]) {
      const r = await moderate(answer);
      expect(r.overview).toBe(0);
      expect(r.refetch).toBe(1);
      expect(r.said).toEqual(["Не получилось сохранить отзыв"]);
    }
  });

  /* «Отменить» on the toast is a second PATCH on the same row through the same
     door. setReviewStatus is an unconditional UPDATE, so whichever commits
     last wins — and on a stalled connection that can be the first one, leaving
     the review the owner took back published on the product page. */
  it("«Отменить» waits for the call it undoes — the two never race", async () => {
    const q = moderateTwice();
    await q.done();
    expect(q.sent).toEqual(["approved"]);   // the undo has not left yet

    q.settle[0]();
    await q.done();
    expect(q.sent).toEqual(["approved", "pending"]);

    q.settle[1]();
    await q.done();
  });
});

type QueueRig = {
  S: Any;
  filter: (status: string) => void;
  load: (force?: boolean) => void;
  html: () => string;
  answer: (j: Any | "throw") => void;
  pending: number;
};

function queueRig(start: Any | null): QueueRig {
  const S: Any = { admRevFilter: "pending", admReviews: start, screen: "admin", adminTab: "reviews" };
  const waiting: Array<(j: Any | "throw") => void> = [];
  const fetchStub = () =>
    new Promise((res, rej) => waiting.push((j) => (j === "throw" ? rej(new Error("offline")) : res({ json: () => Promise.resolve(j) }))));
  const run = new Function(
    "S", "fetch", "render", "admReviewRowHTML", "esc",
    `${slice("admReviewCounts")} ${slice("admReviewsFilter")} ${slice("loadAdminReviews")}
     ${sliceVar("REV_TABS")} ${slice("admReviewsHTML")}
     return { filter: admReviewsFilter, load: loadAdminReviews, html: admReviewsHTML };`,
  ) as (...a: unknown[]) => { filter: (s: string) => void; load: (f?: boolean) => void; html: () => string };
  const api = run(S, fetchStub, () => {}, (r: Any) => `<row:${r.id}:${r.status}>`, (s: string) => s);
  return {
    S, ...api,
    answer: (j) => waiting.shift()!(j),
    get pending() { return waiting.length; },
  };
}

const QUEUE = (status: string, counts: Any = { pending: 2, approved: 7, rejected: 1 }) => ({
  ok: true, reviews: [{ id: "r1", status }, { id: "r2", status }], counts,
});

describe("the moderation queue never lists one status' rows under another's chip", () => {
  it("the previous rows go the moment the chip changes; the three counts stay", () => {
    const rig = queueRig(QUEUE("pending"));
    rig.filter("rejected");
    expect((rig.S.admReviews as Any).reviews).toEqual([]);
    expect((rig.S.admReviews as Any).counts).toEqual({ pending: 2, approved: 7, rejected: 1 });
    const html = rig.html();
    expect(html).toContain("adm-skel");
    expect(html).not.toContain("<row:r1:pending>");
    // the word and its count, each its own node (1a: «Скрытые», one word for a hidden review)
    expect(html).toContain('<span>Новые</span> <span class="adm-chip__n">2</span>');
    expect(html).toContain('<span>Скрытые</span> <span class="adm-chip__n">1</span>');
  });

  it("a refetch that fails under the new chip shows the error, not the old status' rows", async () => {
    const rig = queueRig(QUEUE("pending"));
    rig.filter("rejected");
    rig.answer("throw");
    await flush();
    expect((rig.S.admReviews as Any).error).toBe("unavailable");
    expect((rig.S.admReviews as Any).reviews).toEqual([]);
    expect(rig.html()).not.toContain("<row:r1:pending>");
  });

  it("a plain refresh of the SAME chip still keeps the list it has", async () => {
    const rig = queueRig(QUEUE("pending"));
    rig.load(true);
    rig.answer("throw");
    await flush();
    expect((rig.S.admReviews as Any).reviews).toHaveLength(2);
    expect(rig.html()).toContain("<row:r1:pending>");
  });

  it("a second chip tapped while the first is still in the air is not swallowed", async () => {
    const rig = queueRig(null);
    rig.filter("approved");
    expect(rig.pending).toBe(1);
    rig.filter("rejected");
    expect(rig.pending).toBe(2);              // asked again, not dropped by the busy guard
    rig.answer(QUEUE("approved"));            // the answer about the chip nobody is on
    await flush();
    expect((rig.S.admReviews as Any).reviews).toEqual([]);
    expect((rig.S.admReviews as Any).loading).toBe(true);
    rig.answer(QUEUE("rejected", { pending: 0, approved: 9, rejected: 3 }));
    await flush();
    expect(rig.html()).toContain("<row:r1:rejected>");
  });

  it("the chip is what the tap goes through", () => {
    expect(src).toContain("if (d.admrevfilter) { admReviewsFilter(d.admrevfilter); return; }");
  });

  /* The queue is fetched once and a failed fetch is never retried on its own,
     so «новые отзывы появятся здесь сами» was a promise nothing kept. */
  it("a queue that did not load offers «Повторить» instead of promising to fix itself", async () => {
    const rig = queueRig(null);
    rig.load(true);
    rig.answer("throw");
    await flush();
    const html = rig.html();
    expect(html).toContain("Отзывы не загрузились — попробуйте ещё раз.");
    expect(html).toContain('data-admreload="reviews"');
    expect(html).not.toContain("появятся здесь сами");
    // …and the switch is one the delegated click list already carries
    expect(src).toContain('else if (d.admreload === "reviews") loadAdminReviews(true);');
    expect(src).toContain('"Отзывы не загрузились — попробуйте ещё раз.": "Arvustused ei laadinud — proovi uuesti."');
    expect(src).toContain('"Отзывы не загрузились — попробуйте ещё раз.": "The reviews did not load — try again."');
  });
});
