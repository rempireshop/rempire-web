/**
 * Four places in public/shop2/app.js where the customer half of the shop said
 * something it had not checked, found by the r21 audit sweep:
 *
 *   · «Одобрить Pro» toasted «письмо ушло» on any 200, while the route sends
 *     the partner letter best-effort and reports `mail.sent` in the answer —
 *     so a Resend outage was reported to the owner as a letter that had gone;
 *   · «Выйти» said «Вы вышли ✓» and only then fired an unawaited, unchecked
 *     POST. The session is a signed cookie and nothing else, so a failed POST
 *     left it working — on a shared machine, under a toast that said it did
 *     not;
 *   · a customer card whose GET failed drew grey bars for ever and asked for
 *     the card again on every render, with nothing to say it had failed;
 *   · «Скачать XLSX/CSV» asked for neither a limit nor anything else, so the
 *     route's default of 200 newest rows silently truncated a file the screen
 *     above it had fetched 500 rows for.
 *
 * The storefront is a vanilla-JS IIFE with no DOM here, so the functions are
 * **sliced out of app.js by source text** and run against stubs — the same
 * technique tests/admin-panel-truth.test.ts and tests/checkout-parity.test.ts
 * use. Retyping them would test this file instead of the shop, and the slice
 * fails loudly if app.js drops or renames one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redeemCapPoints } from "@/lib/loyalty";

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

/** Build a callable from one or more sliced functions plus named stubs. */
function build<T>(names: string[], scope: Record<string, unknown>, expr = names[0]): T {
  const keys = Object.keys(scope);
  const body = names.map(slice).join("\n") + `\nreturn ${expr};`;
  return new Function(...keys, body)(...keys.map((k) => scope[k])) as T;
}

/** Let the promise chains inside a sliced function settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/* ---------- «Одобрить Pro»: the letter the route really sent --------------- */

interface PatchAnswer {
  status: number;
  body: { ok: boolean; customer?: { id: string }; mail?: { sent: boolean } };
}

function approver(answer: PatchAnswer): { approve: (id: string) => void; toasts: string[] } {
  const toasts: string[] = [];
  const approve = build<(id: string) => void>(["approveCustomer", "admCustPatch", "custSend", "admCustAdopt", "mergeInto"], {
    apiSend: () => Promise.resolve(answer),
    apiJson: () => Promise.resolve(answer),
    S: { admCustDetail: null, admCustBusy: false },
    SRV: { admin: true },
    render: () => {},
    loadAdminCustomerDetail: () => {},
    loadAdminCustomers: () => {},
    toast: (m: string) => toasts.push(m),
    shopPoke: () => {},
  });
  return { approve, toasts };
}

const APPROVED = { id: "c-1" };

describe("«Одобрить Pro» reports the letter the route actually sent", () => {
  it("says the letter went out when it did", async () => {
    const { approve, toasts } = approver({ status: 200, body: { ok: true, customer: APPROVED, mail: { sent: true } } });
    approve("c-1");
    await settle();
    expect(toasts).toEqual(["Партнёр одобрен · письмо ушло"]);
  });

  it("does not claim a letter Resend refused", async () => {
    const { approve, toasts } = approver({ status: 200, body: { ok: true, customer: APPROVED, mail: { sent: false } } });
    approve("c-1");
    await settle();
    expect(toasts).toEqual(["Партнёр одобрен · письмо не ушло"]);
  });

  it("an answer with no letter in it keeps the plain message", async () => {
    /* «Отклонить» and a notes save come through the same door and carry no
       `mail` at all — no letter was due, so nothing to correct. */
    const toasts: string[] = [];
    const patch = build<(id: string, body: unknown, ok: string, noMail?: string) => void>(["admCustPatch", "custSend", "admCustAdopt", "mergeInto"], {
      apiSend: () => Promise.resolve({ status: 200, body: { ok: true, customer: APPROVED } }),
      apiJson: () => Promise.resolve({ status: 200, body: { ok: true, customer: APPROVED } }),
      S: { admCustDetail: null, admCustBusy: false },
      SRV: { admin: true },
      render: () => {},
      loadAdminCustomerDetail: () => {},
      loadAdminCustomers: () => {},
      toast: (m: string) => toasts.push(m),
      shopPoke: () => {},
    });
    patch("c-1", { action: "reject" }, "Заявка отклонена");
    await settle();
    expect(toasts).toEqual(["Заявка отклонена"]);
  });

  it("both messages are in the dictionary, RU/ET/EN", () => {
    for (const phrase of ["Партнёр одобрен · письмо ушло", "Партнёр одобрен · письмо не ушло"]) {
      // the RU source string, plus one ET and one EN translation of it
      expect(src.split(`"${phrase}":`).length - 1).toBe(2);
    }
  });
});

/* ---------- «Выйти»: the words wait for the cookie ------------------------- */

function logout(answer: unknown): { run: () => void; toasts: string[]; forgotten: () => number } {
  const toasts: string[] = [];
  let forgot = 0;
  const run = build<() => void>(["acctLogout"], {
    postJSON: () => Promise.resolve(answer),
    // the pre-fix version reached for these two; kept so it runs and fails on
    // the assertion rather than on a missing name
    fetch: () => Promise.resolve({ ok: true }),
    noop: () => {},
    acctForget: () => { forgot += 1; },
    render: () => {},
    toast: (m: string) => toasts.push(m),
  });
  return { run, toasts, forgotten: () => forgot };
}

describe("«Выйти» tells the truth about the session", () => {
  it("forgets the account and says so once the cookie is cleared", async () => {
    const { run, toasts, forgotten } = logout({ status: 200, body: { ok: true } });
    run();
    await settle();
    expect(forgotten()).toBe(1);
    expect(toasts).toEqual(["Вы вышли ✓"]);
  });

  it("a POST that never arrived leaves the account open and says so", async () => {
    // postJSON answers {offline:true, lost:true, status:0} for a dead network
    const { run, toasts, forgotten } = logout({ offline: true, lost: true, status: 0 });
    run();
    await settle();
    expect(toasts).toEqual(["Не получилось выйти"]);
    // the cookie is still on this browser — pretending otherwise is the bug
    expect(forgotten()).toBe(0);
  });

  it("a 503 is not a sign-out either", async () => {
    const { run, toasts, forgotten } = logout({ status: 503, body: { ok: false } });
    run();
    await settle();
    expect(toasts).toEqual(["Не получилось выйти"]);
    expect(forgotten()).toBe(0);
  });
});

/* ---------- the customer card: a skeleton that never fills ----------------- */

function cardLoader(answer: unknown, reject = false, open = "cust-1") {
  // admCustOpen is the card on screen: an answer for another one is not its news
  const S = { admCustOpen: open, admCustDetail: null as unknown, admCustDetailErr: "" };
  let requests = 0;
  let renders = 0;
  const load = build<(id: string, force?: boolean) => void>(["loadAdminCustomerDetail"], {
    SRV: { admin: true },
    S,
    apiJson: () => {
      requests += 1;
      return reject ? Promise.reject(new Error("offline")) : Promise.resolve(answer);
    },
    render: () => { renders += 1; },
    noop: () => {},
  });
  return { load, S, requests: () => requests, renders: () => renders };
}

describe("the customer card says when it could not load", () => {
  it("a 503 leaves a line, not grey bars for ever", async () => {
    const c = cardLoader({ status: 503, body: { ok: false, error: "db_unavailable" } });
    c.load("cust-1");
    await settle();
    expect(c.S.admCustDetailErr).toBe("Карточка клиента не загрузилась.");
    expect(c.renders()).toBe(1);
  });

  it("a dead network says that instead", async () => {
    const c = cardLoader(null, true);
    c.load("cust-1");
    await settle();
    expect(c.S.admCustDetailErr).toBe("Сервер не отвечает.");
  });

  it("does not ask again on every render once it has failed", async () => {
    const c = cardLoader({ status: 503, body: { ok: false } });
    c.load("cust-1");
    await settle();
    c.load("cust-1");
    c.load("cust-1");
    await settle();
    expect(c.requests()).toBe(1);
  });

  it("does not put a second request in flight beside the first", () => {
    const c = cardLoader({ status: 200, body: { ok: true, customer: { id: "cust-1" } } });
    c.load("cust-1");
    c.load("cust-1");
    expect(c.requests()).toBe(1);
  });

  it("`force` after a PATCH asks again even though the last try failed", async () => {
    const c = cardLoader({ status: 503, body: { ok: false } });
    c.load("cust-1");
    await settle();
    c.load("cust-1", true);
    await settle();
    expect(c.requests()).toBe(2);
  });

  it("a refusal for a card the owner has already left is not shown over the next one", async () => {
    // the answer is for cust-1; by the time it lands, cust-2 is on screen
    const c = cardLoader({ status: 503, body: { ok: false } }, false, "cust-2");
    c.load("cust-1");
    await settle();
    expect(c.S.admCustDetailErr).toBe("");
    expect(c.renders()).toBe(0);
  });

  it("carries the error line in all three languages", () => {
    expect(src.split('"Карточка клиента не загрузилась.":').length - 1).toBe(2);
  });
});

/* ---------- the exports: the whole list, not the newest 200 ---------------- */

/* 1a: the pair moved into «⋯» as «Скачать список · Excel / CSV» (gap A5),
   and the file now follows the screen — the chip's tier and the search go
   along (the route takes both). The limit is still the whole list. */
describe("«Скачать список · Excel / CSV»", () => {
  function href(format: string, S: Record<string, unknown>, partners = true): URL {
    const f = build<(fmt: string) => string>(["admCustExportHref"], { S, partnersOn: () => partners });
    return new URL(f(format), "https://shop.example");
  }

  it("ask for more rows than listCustomersAdmin's default of 200", () => {
    for (const format of ["xlsx", "csv"]) {
      const u = href(format, { admCustTier: "", admCustQ: "" });
      expect(u.pathname).toBe("/api/admin/customers/");
      expect(u.searchParams.get("format")).toBe(format);
      // at least what the screen itself fetches (loadAdminCustomers: limit=500)
      expect(Number(u.searchParams.get("limit"))).toBeGreaterThanOrEqual(500);
    }
  });

  it("carry the chip and the search the owner is looking at", () => {
    const u = href("xlsx", { admCustTier: "pending", admCustQ: " Salon & Co " });
    expect(u.searchParams.get("tier")).toBe("pending");
    expect(u.searchParams.get("q")).toBe("Salon & Co");
    // «Подписаны» is not a tier the route knows — the file has every row, consent column and all
    expect(href("csv", { admCustTier: "news", admCustQ: "" }).searchParams.has("tier")).toBe(false);
    // …and with the programme off there are no tiers to carry
    expect(href("csv", { admCustTier: "pro", admCustQ: "" }, false).searchParams.has("tier")).toBe(false);
  });

  it("are both in «⋯», XLSX first", () => {
    const more = src.slice(src.indexOf("function admCustMoreHTML("), src.indexOf("function admCustMoreHTML(") + 1600);
    expect(more.indexOf('admCustExportHref("xlsx")')).toBeGreaterThan(0);
    expect(more.indexOf('admCustExportHref("xlsx")')).toBeLessThan(more.indexOf('admCustExportHref("csv")'));
  });
});

/* ---------- the checkout preview and the server agree about the cap -------- */

function maxRedeem(cart: number, pct: number, balance = 1_000_000): number {
  return build<() => number>(["loyaltyMaxRedeem"], {
    pointsOn: () => true,
    S: { loyalty: { balance, settings: { enabled: true, minRedeem: 5, redeemMaxPct: pct } } },
    cartSum: () => cart,
    discount: () => 0,
    shipCost: () => 0,
    giftDiscount: () => 0,
  })();
}

describe("«Использовать баллы» — the percentage cap floors on both sides", () => {
  it("an 11.70 € basket at 30 % offers 3 points, not 4", () => {
    expect(maxRedeem(11.7, 30)).toBe(3);
  });

  it("draws the same line as redeemCapPoints() in src/lib/loyalty.ts", () => {
    for (const cart of [0, 5, 10, 11.7, 19.99, 50, 118.4, 1234.56]) {
      for (const pct of [10, 25, 30, 50, 100]) {
        expect(maxRedeem(cart, pct)).toBe(redeemCapPoints(cart, pct));
      }
    }
  });
});
