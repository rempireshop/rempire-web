/**
 * «Данные и аккаунт» at the foot of «Кабинет» and the «Удалить аккаунт»
 * dialog (Dim, 28.09.2026) — the app.js half. The server half is
 * tests/account-privacy.test.ts.
 *
 * What this pins: the red «Удалить» is off until the account's own e-mail is
 * typed; the dialog is a real modal (role, aria-modal, a label, the error
 * line tied to the box) and says what happens — orders kept, reviews
 * anonymised, points lost only when there are any; the «order still on its
 * way» answer replaces the confirmation; typed text cannot become markup; the
 * send path does what each answer means (home + «Аккаунт удалён», the blocking
 * orders, signed out, a refusal line) and never fires twice; and the dialog
 * goes away with the account screen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(process.cwd(), "public", "shop2", "app.js"), "utf8");

/** A top-level `function name(...) {...}` of app.js, as source. */
function fn(name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${name}()`);
}
/** A top-level `var NAME = {...};` of app.js, as source. */
function objVar(name: string): string {
  const at = src.indexOf(`var ${name} = {`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1) + ";";
  }
  throw new Error(`unbalanced ${name}`);
}

const EMAIL = "mari.tamm@example.com";
const HTML_SRC = [fn("esc"), fn("acctDelMatch"), objVar("ACCT_DEL_ERRS"), fn("acctDelErrText"), fn("acctDelHTML")].join("\n");

type St = { typed: string; busy: boolean; err: string; open: string[] | null };
const html = (st: Partial<St>, points = 0, email = EMAIL): string =>
  new Function("st", "email", "points", `${HTML_SRC}\nreturn acctDelHTML(st, email, points);`)(
    { typed: "", busy: false, err: "", open: null, ...st },
    email,
    points,
  );
const match = (typed: unknown, email: unknown): boolean =>
  new Function("a", "b", `${fn("acctDelMatch")}\nreturn acctDelMatch(a, b);`)(typed, email);

/** The red button's own tag. */
const redButton = (h: string) => /<button class="btn btn--wide btn--danger"[^>]*>/.exec(h)?.[0] ?? "";

describe("acctDelMatch — the typed confirmation", () => {
  it("is the account's own address, whatever the case and the spaces", () => {
    expect(match(EMAIL, EMAIL)).toBe(true);
    expect(match("  Mari.Tamm@Example.COM ", EMAIL)).toBe(true);
  });
  it("is never an empty box, another address or half of this one", () => {
    expect(match("", EMAIL)).toBe(false);
    expect(match(null, EMAIL)).toBe(false);
    expect(match("", "")).toBe(false);
    expect(match("mari.tamm@example", EMAIL)).toBe(false);
    expect(match("somebody@example.com", EMAIL)).toBe(false);
  });
});

describe("acctDelHTML — the dialog", () => {
  it("is a real modal: role, aria-modal, a title it is labelled by, a sentence it is described by", () => {
    const h = html({});
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-modal="true"');
    expect(h).toContain('aria-labelledby="acctdel-t"');
    expect(h).toContain('id="acctdel-t">Удалить аккаунт?</h2>');
    expect(h).toContain('aria-describedby="acctdel-d"');
    expect(h).toContain('id="acctdel-d"');
    // ✕, «Отмена» and the scrim all close it
    expect(h.match(/data-acctdelclose/g)).toHaveLength(3);
    expect(h).toContain('aria-label="Закрыть"');
  });

  it("keeps the red «Удалить» disabled until the account's own e-mail is typed", () => {
    expect(redButton(html({}))).toContain(" disabled");
    expect(redButton(html({ typed: "mari@" }))).toContain(" disabled");
    expect(redButton(html({ typed: "Mari.Tamm@example.com" }))).not.toContain(" disabled");
    expect(html({ typed: EMAIL })).toContain(">Удалить</button>");
    // while it is on its way it says so, and says it is not pressable again
    const busy = redButton(html({ typed: EMAIL, busy: true }));
    expect(busy).toContain('aria-disabled="true"');
    expect(html({ typed: EMAIL, busy: true })).toContain(">Удаляем…</button>");
  });

  it("ties the box to its refusal line and marks it invalid on a mismatch", () => {
    const quiet = html({});
    expect(quiet).toContain('data-acctdelmail value="" aria-describedby="acctdel-e"');
    expect(quiet).toContain('<div class="err acctdel__err" id="acctdel-e" role="alert"></div>');
    const refused = html({ typed: "x@example.com", err: "confirm_mismatch" });
    expect(refused).toContain('aria-invalid="true"');
    expect(refused).toContain(">E-mail не совпадает с адресом этого аккаунта</div>");
    expect(html({ err: "rate_limited" })).toContain(">Слишком много попыток — подождите минуту</div>");
    expect(html({ err: "db_unavailable" })).toContain(">Не получилось удалить — попробуйте ещё раз</div>");
  });

  it("says plainly what happens — profile gone, orders kept by law, reviews without the name, no more letters", () => {
    const h = html({});
    expect(h).toContain("Это нельзя отменить. Мы удалим ваш профиль:");
    expect(h).toContain("Заказы останутся у магазина: закон о бухгалтерии требует хранить их 7 лет.");
    expect(h).toContain("подпись будет «Покупатель»");
    expect(h).toContain("это будет новый, пустой аккаунт");
    expect(h).toContain("Чтобы подтвердить, введите свой e-mail");
  });

  it("names the points that will be lost — only when there are any, the number a node of its own", () => {
    expect(html({}, 12)).toContain('<p><span>Ваши баллы сгорят:</span> <span class="num">12</span></p>');
    expect(html({}, 0)).not.toContain("баллы");
  });

  it("an order still on its way replaces the confirmation with the reason, the numbers and «Понятно»", () => {
    const h = html({ open: ["R-100123", "R-100124"] });
    expect(h).toContain("Пока заказ не доставлен, удалить аккаунт нельзя");
    expect(h).toContain('<p class="num acctdel__orders">R-100123, R-100124</p>');
    expect(h).toContain("Когда заказ доставят, удалить аккаунт можно будет здесь же.");
    expect(h).toContain(">Понятно</button>");
    expect(h).not.toContain("data-acctdelmail");
    expect(h).not.toContain("btn--danger");
    // an empty answer (the server said: nothing blocks) is the confirmation
    expect(html({ open: [] })).toContain("data-acctdelmail");
  });

  it("never lets typed text or an order number become markup", () => {
    const h = html({ typed: '"><img src=x onerror=alert(1)>', open: null });
    expect(h).not.toContain("<img");
    expect(h).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html({ open: ["<b>R-1</b>"] })).toContain("&lt;b&gt;R-1&lt;/b&gt;");
  });
});

describe("acctPrivacyHTML — the block at the foot of «Кабинет»", () => {
  const block = new Function(`${fn("acctPrivacyHTML")}\nreturn acctPrivacyHTML();`)() as string;

  it("offers the file as a plain link to the export route and the deletion as a quiet, labelled button", () => {
    expect(block).toContain('<h2 class="sec__title">Данные и аккаунт</h2>');
    expect(block).toContain('<a class="btn btn--ghost btn--sm" href="/api/account/export/" data-acctexport>Скачать мои данные</a>');
    expect(block).toContain('<button class="link acct__delbtn" data-acctdel aria-haspopup="dialog">Удалить аккаунт</button>');
    expect(block).toContain("Заказы останутся у магазина — так требует закон.");
  });

  it("is the last block of the signed-in account screen, after «Доставка по умолчанию»", () => {
    const screen = fn("screenAccount");
    const at = screen.indexOf("acctPrivacyHTML()");
    expect(at).toBeGreaterThan(screen.indexOf("Доставка по умолчанию"));
    expect(at).toBeGreaterThan(screen.indexOf("acctAddrHTML()"));
    expect(screen.slice(at)).toMatch(/^acctPrivacyHTML\(\) \+\s+"<\/section><\/div>";/);
  });
});

/* ---------- the send path ---------------------------------------------------- */

type Calls = { post: Array<[string, unknown]>; forget: number; go: string[]; toast: string[]; gone: number; paint: number; patch: number };

function sender(state: Partial<St> | null, answer: () => Promise<unknown>) {
  const calls: Calls = { post: [], forget: 0, go: [], toast: [], gone: 0, paint: 0, patch: 0 };
  const S: Record<string, unknown> = {
    acctDel: state ? { typed: "", busy: false, err: "", open: null, ...state } : null,
    cust: { email: EMAIL },
  };
  const run = new Function(
    "S", "postJSON", "acctForget", "go", "toast", "acctDelGone", "paintAcctDel", "patchAcctDel", "settleModalFocus",
    `${fn("acctDelMatch")}\n${objVar("ACCT_DEL_ERRS")}\n${fn("acctDelEmail")}\n${fn("acctDelSend")}\nreturn acctDelSend;`,
  )(
    S,
    (url: string, body: unknown) => { calls.post.push([url, body]); return answer(); },
    () => { calls.forget++; },
    (s: string) => { calls.go.push(s); },
    (m: string) => { calls.toast.push(m); },
    () => { calls.gone++; },
    () => { calls.paint++; },
    () => { calls.patch++; },
    () => {},
  ) as () => void;
  return { S, calls, run };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("acctDelSend — what each answer means", () => {
  it("sends nothing until the address matches, and says why", async () => {
    const { S, calls, run } = sender({ typed: "other@example.com" }, async () => ({ status: 200, body: { ok: true } }));
    run();
    await flush();
    expect(calls.post).toEqual([]);
    expect((S.acctDel as St).err).toBe("confirm_mismatch");
  });

  it("deleted: forgets the account, opens the shop's home page and says «Аккаунт удалён»", async () => {
    const { S, calls, run } = sender({ typed: " Mari.Tamm@example.com " }, async () => ({ status: 200, body: { ok: true } }));
    run();
    expect((S.acctDel as St).busy).toBe(true);
    await flush();
    expect(calls.post).toEqual([["/api/account/delete/", { confirm: "Mari.Tamm@example.com" }]]);
    expect(calls.forget).toBe(1);
    expect(calls.go).toEqual(["home"]);
    expect(calls.toast).toEqual(["Аккаунт удалён"]);
    expect(S.acctDel).toBeNull();
  });

  it("an idempotent repeat («already») is the same success", async () => {
    const { calls, run } = sender({ typed: EMAIL }, async () => ({ status: 200, body: { ok: true, already: true } }));
    run();
    await flush();
    expect(calls.go).toEqual(["home"]);
  });

  it("an order still on its way: the dialog turns into the reason with the numbers, nothing is forgotten", async () => {
    const { S, calls, run } = sender({ typed: EMAIL }, async () => ({ status: 409, body: { ok: false, error: "open_orders", orders: ["R-100123"] } }));
    run();
    await flush();
    expect((S.acctDel as St).open).toEqual(["R-100123"]);
    expect((S.acctDel as St).busy).toBe(false);
    expect(calls.paint).toBe(1);
    expect(calls.forget).toBe(0);
    expect(calls.go).toEqual([]);
  });

  it("a session the server no longer knows signs the page out", async () => {
    const { calls, run } = sender({ typed: EMAIL }, async () => ({ status: 401, body: { ok: false, error: "unauthorized" } }));
    run();
    await flush();
    expect(calls.gone).toBe(1);
    expect(calls.go).toEqual([]);
  });

  it("a refusal or a dead network leaves the dialog open with its line, ready to try again", async () => {
    const limited = sender({ typed: EMAIL }, async () => ({ status: 429, body: { ok: false, error: "rate_limited" } }));
    limited.run();
    await flush();
    expect(limited.S.acctDel).toMatchObject({ busy: false, err: "rate_limited" });

    const down = sender({ typed: EMAIL }, async () => ({ status: 503, body: { ok: false, error: "db_unavailable" } }));
    down.run();
    await flush();
    expect(down.S.acctDel).toMatchObject({ busy: false, err: "error" });

    const offline = sender({ typed: EMAIL }, () => Promise.reject(new Error("offline")));
    offline.run();
    await flush();
    expect(offline.S.acctDel).toMatchObject({ busy: false, err: "error" });
    expect(offline.calls.forget).toBe(0);
  });

  it("a second tap while the first is on its way sends nothing; a blocked dialog sends nothing at all", async () => {
    let release: (v: unknown) => void = () => {};
    const { calls, run } = sender({ typed: EMAIL }, () => new Promise((r) => { release = r; }));
    run();
    run();
    expect(calls.post).toHaveLength(1);
    release({ status: 200, body: { ok: true } });
    await flush();

    const blocked = sender({ typed: EMAIL, open: ["R-1"] }, async () => ({ status: 200, body: { ok: true } }));
    blocked.run();
    await flush();
    expect(blocked.calls.post).toEqual([]);
  });

  it("an answer that lands after the dialog was closed changes nothing", async () => {
    let release: (v: unknown) => void = () => {};
    const { S, calls, run } = sender({ typed: EMAIL }, () => new Promise((r) => { release = r; }));
    run();
    S.acctDel = null; // closed meanwhile (a navigation)
    release({ status: 200, body: { ok: true } });
    await flush();
    expect(calls.go).toEqual([]);
    expect(calls.toast).toEqual([]);
  });
});

/* ---------- mounting ---------------------------------------------------------- */

function painter(S: Record<string, unknown>) {
  const slot = { id: "", innerHTML: "", querySelector: () => null };
  const cls = new Set<string>();
  let created = 0;
  let patched = 0;
  let found = false;
  const document = {
    getElementById: (id: string) => (id === "acctdelslot" && found ? slot : null),
    createElement: () => { created++; found = true; return slot; },
    body: { classList: { add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c) } },
  };
  const app = { appendChild: () => {} };
  const paint = new Function(
    "S", "document", "app", "translateTree", "acctDelHTML", "acctDelEmail", "acctDelPoints", "patchAcctDel",
    `var acctDelOn = "";\n${fn("paintAcctDel")}\nreturn paintAcctDel;`,
  )(
    S, document, app, () => {},
    (st: St) => `<div role="dialog" data-state="${st.open && st.open.length ? "b" : "c"}"></div>`,
    () => EMAIL, () => 0, () => { patched++; },
  ) as () => void;
  return { slot, cls, paint, counts: () => ({ created, patched }) };
}

describe("paintAcctDel — a slot of its own, mounted only when what it shows changes", () => {
  it("costs nothing while nobody opened it", () => {
    const p = painter({ screen: "account", loggedIn: true, lang: "RU" });
    p.paint();
    expect(p.counts().created).toBe(0);
  });

  it("mounts once, patches after that, remounts for the «order on its way» answer, and locks the page behind", () => {
    const S: Record<string, unknown> = { screen: "account", loggedIn: true, lang: "RU", acctDel: { typed: "", busy: false, err: "", open: null } };
    const p = painter(S);
    p.paint();
    expect(p.slot.innerHTML).toContain('data-state="c"');
    expect(p.cls.has("is-locked")).toBe(true);
    p.paint();
    expect(p.counts().patched).toBe(1); // a render() while typing is a patch, never a rebuild
    (S.acctDel as St).open = ["R-1"];
    p.paint();
    expect(p.slot.innerHTML).toContain('data-state="b"');
  });

  it("goes with the account screen: a navigation or a sign-out closes it and unlocks the page", () => {
    const S: Record<string, unknown> = { screen: "account", loggedIn: true, lang: "RU", acctDel: { typed: "", busy: false, err: "", open: null } };
    const p = painter(S);
    p.paint();
    S.screen = "home";
    p.paint();
    expect(S.acctDel).toBeNull();
    expect(p.slot.innerHTML).toBe("");
    expect(p.cls.has("is-locked")).toBe(false);
  });
});
