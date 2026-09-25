/**
 * Admin redesign 1a — «Блог», «Аналитика», «Подключения», «Вход»
 * (design_handoff_admin_ux README § 5; Dim's answers of 25.09.2026).
 *
 *   1. «Вернулись по письму» is a real server count (q41): an order from an
 *      address whose cart had been reminded is written down at the moment the
 *      reminder's stamp is cleared, and «Аналитика» counts those in the period.
 *   2. The article saves itself (q5), and the one «Создать» carries an
 *      Idempotency-Key: a retry after a lost answer sends the SAME key and the
 *      SAME body, so the server replays its answer instead of making a twin
 *      draft — and the article as it is now follows as an edit.
 *   3. …refused before it leaves while there is no Russian title.
 *   4. A published article: its address changes only after a question, and
 *      the assistant asks before it writes over the text (q5 guards).
 *   5. A confirmed delete is held for as long as «Вернуть» is offered (q8).
 *   6. «Подключения»: every problem has one action (q19), the assistant with
 *      no model is grey under «Работает», never counted as a problem.
 *   7. «Аналитика»'s comparison is in words; «Вход» says «салон», and the
 *      30-day line is true.
 *
 * The panel is one vanilla-JS file with no DOM here, so its pieces are cut out
 * of app.js by source text and run against stubs — the technique the other
 * admin tests use. Retyping them would test this file instead of the panel.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAnalyticsSummary } from "@/lib/analytics";
import { markCartRecovered, saveCart } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb } from "./helpers";

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

/** `function <name>(…) { … }`, cut out by brace matching. */
function slice(name: string): string {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  return block(start, name);
}
/** From `head` to the brace that closes the first block after it. */
function block(start: number, what: string): string {
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${what}`);
}
/** `var NAME = …;` — up to its first semicolon (the values sliced here hold none). */
function sliceVar(name: string): string {
  const m = new RegExp(`var ${name} = [\\s\\S]*?;`).exec(app);
  if (!m) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  return m[0];
}
/** `var NAME = { … };` over several lines. */
function sliceObject(name: string): string {
  const start = app.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name} = {…}`);
  return block(start, name) + ";";
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/* ---------- 1. «Вернулись по письму» -------------------------------------- */

describe("«Вернулись по письму» — counted on the server (q41)", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate carts, cart_returns restart identity cascade");
  });
  const PRODUCT = "system-4-bio-botanical-shampoo";

  it("an order after the reminder is one return; an order without one is none", async () => {
    await saveCart({ email: "letter@example.com", items: [{ id: PRODUCT, qty: 1 }] });
    await query("update carts set reminded_at = now() where email = $1", ["letter@example.com"]);
    await saveCart({ email: "plain@example.com", items: [{ id: PRODUCT, qty: 1 }] });

    await markCartRecovered("letter@example.com");
    await markCartRecovered("plain@example.com");

    const rows = await query<{ n: string }>("select count(*) as n from cart_returns");
    expect(Number(rows[0].n), "only the reminded address came back by the letter").toBe(1);
    // …and the reminder's stamp is still cleared, so the next basket gets its own letter
    const cart = await query<{ reminded_at: unknown; recovered_at: unknown }>(
      "select reminded_at, recovered_at from carts where email = $1", ["letter@example.com"]);
    expect(cart[0].reminded_at).toBeNull();
    expect(cart[0].recovered_at).not.toBeNull();
  });

  it("survives the basket emptied after checkout, and a second order is not a second return", async () => {
    await saveCart({ email: "twice@example.com", items: [{ id: PRODUCT, qty: 1 }] });
    await query("update carts set reminded_at = now() where email = $1", ["twice@example.com"]);
    await markCartRecovered("twice@example.com");
    await saveCart({ email: "twice@example.com", items: [] });   // the shop empties the basket: the row is deleted
    await markCartRecovered("twice@example.com");                // another order from the same address

    const a = await getAnalyticsSummary("7d");
    expect(a.cartsReturned).toBe(1);
  });

  it("«Аналитика» counts the period it is asked about", async () => {
    const now = new Date("2026-06-15T12:00:00Z");
    await query("insert into cart_returns (at) values ($1), ($2), ($3)", [
      new Date(now.getTime() - 2 * 86_400_000).toISOString(),    // two days ago
      new Date(now.getTime() - 20 * 86_400_000).toISOString(),   // twenty days ago
      new Date(now.getTime() - 200 * 86_400_000).toISOString(),  // long before any window
    ]);
    expect((await getAnalyticsSummary("7d", now)).cartsReturned).toBe(1);
    expect((await getAnalyticsSummary("30d", now)).cartsReturned).toBe(2);
    expect((await getAnalyticsSummary("90d", now)).cartsReturned).toBe(2);
  });

  it("the panel prints the server's figure, and «—» — never a made-up 0 — when there is none", () => {
    expect(app).toContain('["Вернулись по письму", a.cartsReturned == null ? "—" : String(a.cartsReturned),');
  });
});

/* ---------- 2–3. the article saves itself --------------------------------- */

type Any = Record<string, any>;
type Call = { method: string; body: Any; key?: string };

/** `doc`: a stand-in document for the lines the save paints in place (none by default) */
function saveRig(answers: Array<"lost" | { status: number; body: Any }>, doc?: Any) {
  const S: Any = { adminBlogEdit: null, adminBlogSaved: undefined, adminBlog: [], adminBlogConfirmBack: false };
  const calls: Call[] = [];
  let keyN = 0;
  const apiSend = (_url: string, method: string, body: Any, key?: string) => {
    calls.push({ method, body: JSON.parse(JSON.stringify(body)), key });
    const a = answers.shift();
    if (!a || a === "lost") return Promise.reject(new Error("offline"));
    return Promise.resolve(a);
  };
  const api = new Function(
    "S", "SRV", "apiSend", "blogBody3ToHtml", "blogForget", "noop", "blogListUpsert", "idemNewKey", "blogSendKeepalive",
    "document", "translateTree", "admBlogHeadHTML",
    `${slice("blogPubStateHTML")} ${slice("blogFieldsPayload")} ${slice("blogDraftSig")} ${sliceVar("BLOG_SIG_FIELDS")} ${slice("blogDraftSnap")}
     ${slice("blogMarkSaved")} ${slice("blogHttpErr")} ${slice("saveBlogFields")} ${slice("blogSaveOnce")} ${slice("blogDirty")}
     return { save: saveBlogFields, mark: blogMarkSaved, dirty: blogDirty };`,
  )(S, { admin: true }, apiSend, (b: Any) => b, () => {}, () => {}, () => {}, () => "key-" + ++keyN, apiSend, doc, () => {},
    (d: Any) => '<div class="adm-blog2__acts">' + (d.id ? "<button data-admblogdel>Удалить статью</button>" : "") + "</div>") as {
    save: (d: Any) => Promise<Any>; mark: (d: Any) => void; dirty: () => boolean;
  };
  return { S, calls, ...api };
}
const E3 = () => ({ RU: "", ET: "", EN: "" });
function newDraft(title: string): Any {
  return {
    id: "", slug: "", slugAuto: true, status: "draft",
    title: { ...E3(), RU: title }, excerpt: E3(), body: { ...E3(), RU: "<p>Текст.</p>" },
    coverUrl: "", coverAlt: E3(), coverFocus: "", tagsText: "борода", products: ["x"],
    seoTitle: E3(), seoDesc: E3(), author: "Rempire", publishedAt: null,
  };
}
const POST = { id: "7a0e9f5e-3a51-4c7e-9a3b-111111111111", slug: "boroda", status: "draft", publishedAt: null };

/* Integration of the 1a screens, 25.09.2026 (e2e admin-sweep-4): the header
   said «Сохранено ✓» and the line at the editor's foot still said «Новая
   статья — сохранится, как только будет заголовок» — nothing repainted it
   when the create landed; a render arriving later by chance used to. */
describe("the line at the editor's foot follows the save", () => {
  it("a new article is «Черновик» the moment its create lands — painted in place, no render", async () => {
    const line: Any = { innerHTML: "" };
    const rig = saveRig([{ status: 200, body: { ok: true, post: POST } }], {
      querySelector: (sel: string) => (sel === "[data-blogpubstate]" ? line : null),
    });
    const d = newDraft("Борода зимой");
    rig.S.adminBlogEdit = d; rig.mark(d);
    await rig.save(d);
    expect(line.innerHTML).toContain("Черновик — в магазине не видно");
    expect(line.innerHTML).not.toContain("Новая статья");
  });

  it("…and the header's «⋯» with «Удалить статью» appears once the article exists — in place", async () => {
    const swapped: Any[] = [];
    const oldActs: Any = { parentNode: { replaceChild: (n: Any, o: Any) => { swapped.push([n, o]); } } };
    const doc = {
      querySelector: (sel: string) => (sel === ".adm-blog2__acts" ? oldActs : null),
      createElement: () => {
        const box: Any = { html: "", set innerHTML(h: string) { box.html = h; }, querySelector: () => ({ fresh: box.html }) };
        return box;
      },
    };
    const rig = saveRig([{ status: 200, body: { ok: true, post: POST } }, { status: 200, body: { ok: true, post: POST } }], doc);
    const d = newDraft("Борода зимой");
    rig.S.adminBlogEdit = d; rig.mark(d);
    await rig.save(d);
    expect(swapped).toHaveLength(1);
    expect(swapped[0][0].fresh).toContain("data-admblogdel");
    expect(swapped[0][1]).toBe(oldActs);
    // an edit of an article that already exists leaves the header alone
    d.title.RU = "Борода зимой — 2";
    await rig.save(d);
    expect(swapped).toHaveLength(1);
  });

  it("…and an article no longer on screen is not painted over the one that is", async () => {
    const line: Any = { innerHTML: "был" };
    const rig = saveRig([{ status: 200, body: { ok: true, post: POST } }], { querySelector: () => line });
    const d = newDraft("Борода зимой");
    rig.S.adminBlogEdit = newDraft("Другая"); rig.mark(d);
    await rig.save(d);
    expect(line.innerHTML).toBe("был");
  });
});

describe("one «Создать», one article — an autosave retry carries the same key and the same body", () => {
  it("a lost answer: the retry repeats the first request exactly, then the newer text follows as an edit", async () => {
    const rig = saveRig(["lost", { status: 200, body: { ok: true, post: POST } }, { status: 200, body: { ok: true, post: POST } }]);
    const d = newDraft("Борода зимой");
    rig.S.adminBlogEdit = d; rig.mark(d);

    await rig.save(d).catch(() => {});
    expect(rig.calls[0].method).toBe("POST");
    expect(rig.calls[0].key, "the create went without an Idempotency-Key").toBe("key-1");

    d.title.RU = "Борода зимой: как не дать ей пересохнуть";   // typed while nobody knew what became of the first
    await rig.save(d);
    expect(rig.calls[1].method).toBe("POST");
    expect(rig.calls[1].key, "a retry minted a new key — a second draft").toBe("key-1");
    expect(rig.calls[1].body, "the retry is not the same request, so the server cannot replay it").toEqual(rig.calls[0].body);
    // the id is known now; what was typed since goes as an edit of that article
    expect(rig.calls[2].method).toBe("PATCH");
    expect(rig.calls[2].body.id).toBe(POST.id);
    expect(rig.calls[2].body.title.RU).toBe("Борода зимой: как не дать ей пересохнуть");
    expect(d.id).toBe(POST.id);
  });

  it("a refusal releases the key on the server: the corrected draft goes next, under the same key", async () => {
    const rig = saveRig([{ status: 400, body: { ok: false, error: "body_too_long" } }, { status: 200, body: { ok: true, post: POST } }]);
    const d = newDraft("Борода");
    rig.S.adminBlogEdit = d; rig.mark(d);
    await rig.save(d).catch(() => {});
    d.body.RU = "<p>Короче.</p>";
    await rig.save(d);
    expect(rig.calls.map((c) => c.key)).toEqual(["key-1", "key-1"]);
    expect(rig.calls[1].body.body.RU).toContain("Короче.");
  });

  it("an edit sends EVERY field — a blog PATCH replaces the whole article", async () => {
    const rig = saveRig([{ status: 200, body: { ok: true, post: { ...POST, status: "published" } } }]);
    const d = { ...newDraft("Борода"), id: POST.id, slug: "boroda", slugAuto: false, status: "published" };
    rig.S.adminBlogEdit = d; rig.mark(d);
    await rig.save(d);
    expect(rig.calls[0].method).toBe("PATCH");
    expect(rig.calls[0].key).toBeUndefined();
    for (const f of ["title", "excerpt", "body", "coverUrl", "coverAlt", "coverFocus", "tags", "products", "seoTitle", "seoDesc", "author"]) {
      expect(rig.calls[0].body, `«${f}» left out would be emptied by upsertPost`).toHaveProperty(f);
    }
  });

  it("two saves of one article never overlap: the second leaves when the first has answered", async () => {
    let release: ((v: unknown) => void) | null = null;
    const order: string[] = [];
    const S: Any = { adminBlogEdit: null, adminBlogSaved: undefined, adminBlog: [] };
    const api = new Function(
      "S", "SRV", "apiSend", "blogBody3ToHtml", "blogForget", "noop", "blogListUpsert", "idemNewKey", "blogSendKeepalive",
      `${slice("blogFieldsPayload")} ${slice("blogDraftSig")} ${sliceVar("BLOG_SIG_FIELDS")} ${slice("blogDraftSnap")}
       ${slice("blogMarkSaved")} ${slice("blogHttpErr")} ${slice("saveBlogFields")} ${slice("blogSaveOnce")}
       return saveBlogFields;`,
    )(S, { admin: true }, (_u: string, m: string) => {
      order.push(m);
      return new Promise((r) => { release = r; });
    }, (b: Any) => b, () => {}, () => {}, () => {}, () => "k", null) as (d: Any) => Promise<Any>;
    const d = { ...newDraft("Борода"), id: POST.id };
    const first = api(d), second = api(d);
    await flush();
    expect(order, "the second PATCH left while the first was in the air").toEqual(["PATCH"]);
    release!({ status: 200, body: { ok: true, post: POST } });
    await first; await flush();
    expect(order).toEqual(["PATCH", "PATCH"]);
    release!({ status: 200, body: { ok: true, post: POST } });
    await second;
  });
});

describe("the autosave refuses an article with no Russian title", () => {
  it("names the one thing missing, and says nothing once it is there", () => {
    let spec: Any = {};
    const S: Any = { adminBlogEdit: newDraft(""), adminTab: "blog" };
    const auto = new Function(
      "S", "ADM_AS_SPEC", "admAutosaveSpec", "admAutosave", "blogDraftSig", "blogAutosaveSend",
      `var BLOG_AS_N = 0; ${sliceVar("BLOG_TITLE_NEEDED")} ${slice("blogTitleMissing")} ${slice("blogAsKey")} ${slice("blogAutosave")} return blogAutosave;`,
    )(S, {}, (_k: string, s: Any) => { spec = s; }, () => true, () => "sig", () => true) as (ev: string) => boolean;
    auto("input");
    expect(spec.kind, "an article is running text: it saves a second after the typing stops").toBe("text");
    expect(spec.validate()).toBe("Заполните заголовок хотя бы на русском.");
    S.adminBlogEdit.title.RU = "Борода";
    expect(spec.validate()).toBe("");
  });
});

/* ---------- 4. a published article's guards -------------------------------- */

describe("a published article asks before its address moves or the assistant writes over it (q5)", () => {
  function ai(status: string) {
    const S: Any = { adminBlogEdit: { status } };
    const out: Any = { pending: null };
    const asks = new Function(
      "S", "render", "refocus", "out",
      `var pendingAction = null; var BLOG_AI_SURE = false; ${slice("blogAiAsks")}
       return { ask: function (s) { var r = blogAiAsks(s); out.pending = pendingAction; return r; },
                sure: function () { BLOG_AI_SURE = true; } };`,
    )(S, () => {}, () => {}, out) as { ask: (s: string) => boolean; sure: () => void };
    return { asks, out };
  }

  it("a draft is written straight away; a published article asks, naming the button that asked", () => {
    expect(ai("draft").asks.ask("[data-admblogfull]")).toBe(false);
    const pub = ai("published");
    expect(pub.asks.ask("[data-admblogfull]")).toBe(true);
    expect(pub.out.pending).toMatchObject({ type: "blog_ai", overlay: true, sel: "[data-admblogfull]", ok: "Переписать" });
    // «Переписать» presses the same button with the way through open — once
    pub.asks.sure();
    expect(pub.asks.ask("[data-admblogfull]")).toBe(false);
    expect(pub.asks.ask("[data-admblogfull]"), "the way through stayed open").toBe(true);
  });

  it("every assistant write in the editor goes through that question", () => {
    for (const head of ["if (d.admblogfull !== undefined) {", "if (d.admblogoutline !== undefined) {",
      "if (d.admblogtranslate !== undefined) {", "if (d.admblogseogen !== undefined || d.admblogseoall !== undefined) {"]) {
      expect(block(app.indexOf(head), head), head).toContain("blogAiAsks(");
    }
  });

  function leaveSlug(status: string, typed: string) {
    const d: Any = { status, slug: "boroda", slugAuto: false };
    const S: Any = { screen: "admin", adminBlogEdit: d };
    const el: Any = { value: typed, matches: (s: string) => s === "[data-blogslug]" };
    let listener: ((e: Any) => void) | null = null;
    const head = 'document.addEventListener("focusout", function (e) {\n    var t = e.target;\n    if (!t || !t.matches || !t.matches("[data-blogslug]")';
    const at = app.replace(/\r\n/g, "\n").indexOf(head);
    expect(at, "the address's focusout listener is gone").toBeGreaterThan(0);
    const src = block(app.indexOf("document.addEventListener(\"focusout\", function (e) {", app.indexOf("blog (1a): the article's address, when its box is left")), "focusout");
    const autos: string[] = [];
    const out: Any = {};
    new Function(
      "S", "document", "blogAutosave", "render", "refocus", "out",
      `var pendingAction = null; ${sliceVar("BLOG_SLUG_WARN")} ${src}); out.get = function () { return pendingAction; };`,
    )(S, { addEventListener: (_n: string, fn: (e: Any) => void) => { listener = fn; } }, (ev: string) => autos.push(ev), () => {}, () => {}, out);
    listener!({ target: el });
    return { d, el, autos, pending: out.get() };
  }

  it("a published article's new address is asked about, and the box shows the live one meanwhile", () => {
    const r = leaveSlug("published", "Boroda Zimoj");
    expect(r.pending).toMatchObject({ type: "blog_slug", slug: "boroda-zimoj", ok: "Поменять адрес" });
    expect(r.el.value, "the new address stood in the box as if it were saved").toBe("boroda");
    expect(r.d.slug, "the draft took the address before the answer").toBe("boroda");
    expect(r.autos).toEqual([]);
  });

  it("a draft's address saves when the box is left, no question", () => {
    const r = leaveSlug("draft", "boroda-zimoj");
    expect(r.pending).toBeNull();
    expect(r.autos).toEqual(["change"]);
  });
});

/* ---------- 5. a delete held for as long as «Вернуть» is offered ------------ */

describe("«Удалить статью» is held while «Вернуть» is on the toast (q8)", () => {
  afterEach(() => { vi.useRealTimers(); });

  function rig() {
    vi.useFakeTimers();
    const d: Any = { id: POST.id, title: { RU: "Борода" } };
    const S: Any = { adminTab: "blog", adminBlogEdit: d, adminBlogSaved: "sig", adminBlogLang: "RU", adminBlog: [{ id: POST.id }] };
    const deletes: string[] = [];
    const toasts: Array<{ msg: string; undo: Any }> = [];
    const api = new Function(
      "S", "render", "toast", "apiJson", "blogForget", "loadAdminBlog", "blogFail", "blogHttpErr", "ADM_UNDO_MS", "window", "BLOGSEL", "BLOGCARET",
      `${slice("blogListDrop")} var BLOG_HELD = {}; var BLOG_HOLDS = [];
       ${slice("blogDeleteHold")} ${slice("deleteBlogPost")}
       return { hold: blogDeleteHold, held: function () { return BLOG_HELD; } };`,
    )(S, () => {}, (msg: string, undo: Any) => toasts.push({ msg, undo }), (url: string, o: Any) => {
      deletes.push(`${o.method} ${url}`);
      return Promise.resolve({ status: 200, body: { ok: true } });
    }, () => {}, () => {}, () => {}, () => new Error("x"), 6000, undefined, null, null) as { hold: (d: Any) => void; held: () => Any };
    return { S, d, deletes, toasts, api };
  }

  it("nothing is deleted while «Вернуть» is offered, and «Вернуть» brings the article back open", async () => {
    const r = rig();
    r.api.hold(r.d);
    expect(r.S.adminBlogEdit, "the editor stayed on a deleted article").toBeNull();
    expect(r.api.held()[POST.id], "the list still shows it").toBe(true);
    expect(r.toasts[0].msg).toBe("Статья удалена");
    vi.advanceTimersByTime(5900);
    expect(r.deletes).toEqual([]);
    r.toasts[0].undo.undo();
    expect(r.S.adminBlogEdit).toBe(r.d);
    expect(r.api.held()[POST.id]).toBeUndefined();
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(r.deletes, "«Вернуть» did not stop the delete").toEqual([]);
  });

  it("…and when the offer is over, the DELETE goes", async () => {
    const r = rig();
    r.api.hold(r.d);
    vi.advanceTimersByTime(6000);
    await flush();
    expect(r.deletes).toEqual([`DELETE /api/admin/blog/?id=${encodeURIComponent(POST.id)}`]);
    expect(r.S.adminBlog).toEqual([]);
  });
});

/* ---------- 6. «Подключения» ----------------------------------------------- */

describe("«Подключения»: one action per problem, and the assistant is not one (q19)", () => {
  const T = (ru: string) => ({ RU: ru, ET: ru, EN: ru });
  function rows(montonio: Any, admAI: boolean | null = false) {
    return new Function(
      "PAYMETHODS", "S", "GSC", "gscBadKeyLine", "ANALYTICS", "admAI", "MONTONIO", "OWNER_MAIL", "esc", "scanSupportInfo", "admDevLink",
      `${sliceObject("APPS_HOWTO")} ${slice("admIntegrationRows")} return admIntegrationRows();`,
    )({ banks: [1], settled: true }, { lang: "RU", shipLiveRates: { EE: [1] } }, { ok: true }, () => "", { "7d": { data: {} } }, admAI,
      montonio, { key: true, to: "a@b.c" }, esc, () => ({ camera: false }), () => "[DIM]") as Any[];
  }
  const mont = {
    rows: [
      { key: "env", ok: false, quiet: true, name: T("Montonio · режим"), sub: T("Песочница") },
      { key: "keys", ok: false, name: T("Ключи Montonio"), sub: T("не тот ключ") },
      { key: "bank_payments", ok: false, name: T("Оплата банковской ссылкой"), sub: T("не включены") },
      { key: "refunds", ok: false, name: T("Возврат денег покупателю"), sub: T("ВЫКЛЮЧЕНЫ") },
      { key: "carriers", ok: false, name: T("Перевозчики у Montonio"), sub: T("ни одного") },
      { key: "ship_webhook", ok: false, name: T("Montonio сообщает о посылках"), sub: T("не знает") },
      { key: "pending_refunds", ok: false, name: T("Возвраты в пути"), sub: T("висят") },
    ],
    pending: [{ id: "o-1", number: "R-100042", overdue: true }, { id: "o-2", number: "R-100043", overdue: false }],
  };

  it("Dim's rows say «Написать Диму», Renat's say «Как включить», stuck refunds open their order", () => {
    const byKey = Object.fromEntries(rows(mont).filter((r) => r.key).map((r) => [r.key, r]));
    for (const k of ["env", "keys", "ship_webhook"]) expect(byKey[k].act, k).toBe("[DIM]");
    for (const k of ["bank_payments", "refunds", "carriers"]) {
      expect(byKey[k].help, `${k} has no «Как включить»`).toContain("Montonio Partner System");
      expect(byKey[k].helpLabel).toBe("Как включить");
    }
    expect(byKey.pending_refunds.act).toContain('data-admorder="o-1"');
    expect(byKey.pending_refunds.act).toContain("R-100042");
    expect(byKey.pending_refunds.act, "a refund still inside its ten days is not stuck").not.toContain("o-2");
    // the camera keeps «Как разрешить», as a panel now
    expect(byKey.camera.helpLabel).toBe("Как разрешить");
    expect(byKey.camera.help).toContain("Safari");
  });

  it("the assistant with no model is grey and fine — under «Работает», with its «Написать Диму»", () => {
    const ai = rows({ rows: [] }, false).find((r) => r.name === "ИИ-помощник")!;
    expect(ai.ok).toBe(true);
    expect(ai.quiet).toBe(true);
    expect(ai.act).toBe("[DIM]");
  });

  it("the screen: the count is of problems only, cards first, working ones folded, «Как разрешить» kept", () => {
    const html = new Function(
      "SRV", "S", "PAYMETHODS", "GSC", "gscBadKeyLine", "ANALYTICS", "admAI", "MONTONIO", "OWNER_MAIL", "esc", "scanSupportInfo",
      "admDevLink", "admDevHref", "admHead", "pl", "admFoldHTML", "ADM_HELP", "admDomId", "admHelpHTML", "ADM_DEV_MAIL",
      "loadPayMethods", "loadShipLiveRates", "loadGsc", "loadMontonio", "loadOwnerMail", "loadAnalytics",
      `${sliceObject("APPS_HOWTO")} ${slice("admIntegrationRows")} ${slice("admAppHelpHTML")} ${slice("admAppsHTML")} return admAppsHTML();`,
    )({ admin: false }, { lang: "RU", shipLiveRates: { EE: [1] } }, { banks: [1], settled: true }, { ok: true }, () => "",
      { "7d": { data: {} } }, false, { rows: [] }, { key: true, to: "a@b.c" }, esc, () => ({ camera: false }),
      () => "[DIM]", () => "mailto:x", (_k: string, t: string, r: string) => `<h1>${t}</h1>${r}`,
      (n: number, one: string, few: string) => (n === 1 ? one : few),
      (k: string, t: string, s: string, b: string) => `<fold ${k}>${t}|${s}|${b}</fold>`, {}, (p: string, k: string) => p + k,
      (k: string, t: string) => `<help ${k}>${t}</help>`, "info@diipsolutions.eu",
      () => {}, () => {}, () => {}, () => {}, () => {}, () => {}) as string;
    // one problem: the camera; the assistant (grey) is not counted
    expect(html).toContain("1 требует внимания");
    expect(html.indexOf("Сканер · камера телефона"), "the problem card is not above the fold").toBeLessThan(html.indexOf("<fold apps-ok>"));
    expect(html).toContain("data-admcamerahelp");
    expect(html).toContain("Как разрешить");
    const fold = html.slice(html.indexOf("<fold apps-ok>"));
    expect(fold).toContain("ИИ-помощник");
    expect(html).toContain("Отправить проверочное письмо");
    expect(html).toContain("Что-то непонятно — напишите Диму:");
  });
});

/* ---------- 7. «Аналитика» and «Вход» ---------------------------------------- */

describe("«Аналитика»: the comparison in words (screen 17)", () => {
  const kpi = new Function("num1", `${sliceObject("STATS_CMP")} ${slice("admKpiHTML")} return admKpiHTML;`)(
    (n: number) => String(n).replace(".", ","),
  ) as (l: string, v: string, d: number | null, w: string, r: string) => string;

  it("says what the change is measured against, per period — and «today» honestly", () => {
    expect(kpi("Выручка", "190 €", 12.5, "", "7d")).toContain("<span>+12,5 %</span> <span>к прошлой неделе</span>");
    expect(kpi("Выручка", "190 €", -3, "", "30d")).toContain("<span>−3 %</span> <span>к прошлому месяцу</span>");
    expect(kpi("Выручка", "190 €", 1, "", "90d")).toContain("к прошлым 90 дням");
    // «today» is compared with as many hours straight before it (rangeBounds), not «ко вчера»
    expect(kpi("Выручка", "190 €", 1, "", "today")).toContain("к стольким же часам до полуночи");
    expect(kpi("Выручка", "190 €", null, "", "7d")).toContain("нет данных для сравнения");
  });

  it("names the fourth number for what it is, and keeps every list the screen had, folded", () => {
    const screen = slice("admStatsScreen") + slice("admStatsMoreHTML");
    expect(screen).toContain('admKpiHTML("Покупают"');
    expect(screen).not.toContain('"Из корзины в заказ"');
    for (const t of ["Что искали и не нашли", "Бренды: на какую сумму заказали", "Промокоды", "С чего заходят", "Из каких стран",
      "С каких сайтов приходят", "Смотрят, но не покупают", "Что искали чаще всего", "Открытий чата",
      "Подарочных карт потрачено", "Вернулись по письму", "Магазин в поиске Google"]) {
      expect(screen, t).toContain(t);
    }
    expect(screen, "the top products lost the title that says they are not money").toContain("Топ товаров: на какую сумму заказали");
  });
});

describe("«Вход» (screen 19): restyled, the password kept", () => {
  const login = (lang = "RU") => new Function(
    "SRV", "esc", "admLangsHTML", "S",
    `${slice("admGateMarkHTML")} ${slice("admGateFootHTML")} ${slice("admLoginScreen")} return admLoginScreen();`,
  )({ err: "", busy: false }, esc, () => "<langs>", { lang }) as string;

  it("the same password field and button; the brand panel says «салон», never «касса»", () => {
    const html = login();
    expect(html).toContain('data-admpw autocomplete="current-password"');
    expect(html).toContain("data-admlogin");
    expect(html).toContain("Заказы, склад и салон — в одном месте.");
    expect(html).not.toMatch(/касс/i);
    expect(html).not.toContain("код на почту");
  });

  it("the 30-day line is true — a phone and any other device", () => {
    const html = login();
    expect(html).toContain("На этом телефоне вход запомнится на 30 дней.");
    expect(html).toContain("На этом устройстве вход запомнится на 30 дней.");
    const auth = readFileSync(fileURLToPath(new URL("../src/lib/auth.ts", import.meta.url)), "utf8");
    expect(auth).toContain("export const SESSION_DAYS = 30;");
  });
});
