/**
 * «Маркетинг → Письма» and «Подключения» after the owner's /test answers of
 * 23.09.2026 — all four «bad»:
 *
 *   · mail-abandoned — «I do not seem to have gotten the letter.» The letter
 *     goes once a day at 07:00 UTC; there was no way to see it on a test day.
 *     Every row with a switch now has «Прислать пример».
 *   · mail-abandoned-discount — «I cannot manually force … I cannot modify
 *     what the discount is. Also I cannot modify when it goes out.» The row
 *     carried a switch key the server does not know («abandonedDiscount»), so
 *     it always read «off», nothing opened under it — no «Запустить сейчас» —
 *     and the four numbers were a card at the very bottom of the page.
 *   · mail-daily-limit — «There is no «Настройки» → «Письма»». There is now a
 *     door there; and the card's draft no longer freezes the factory 100 / 30
 *     over the owner's saved numbers when it paints before they arrive.
 *   · mail-owner-ping — «Phone notification arrived — e-mail to
 *     shop@rempireshop.com not.» «Подключения» names RESEND_TO in red when it
 *     is missing.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so — like
 * tests/admin-panel-truth.test.ts — the functions are cut out of
 * public/shop2/app.js by source text and run against stubs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { FLOW_DEFAULTS, RUNNABLE_FLOWS, SKIP_REASONS } from "@/lib/flows";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");
const runRoute = readFileSync(
  fileURLToPath(new URL("../src/app/api/admin/flows/run/route.ts", import.meta.url)),
  "utf8",
);

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

/** `var NAME = { … };` by brace matching, or `var NAME = [ … ];` up to its own closing line. */
function decl(name: string): string {
  const obj = src.indexOf(`var ${name} = {`);
  if (obj >= 0) {
    let depth = 0;
    for (let i = src.indexOf("{", obj); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return `${src.slice(obj, i + 1)};`;
    }
  }
  const arr = src.indexOf(`var ${name} = [`);
  if (arr >= 0) {
    const end = src.indexOf("\n  ];", arr);
    if (end > arr) return `${src.slice(arr, end + 4)};`;
  }
  throw new Error(`public/shop2/app.js no longer declares ${name}`);
}

/** One callable from declarations, sliced functions and named stubs. */
function build<T>(decls: string[], names: string[], scope: Record<string, unknown>, expr: string): T {
  const keys = Object.keys(scope);
  /* "?name" — a helper this fix introduced; left out when app.js has none, so
     the same test can be run against the code before the fix and fail on its
     assertions rather than on a missing function. */
  const fns = names.map((n) =>
    n.startsWith("?") ? (src.includes(`function ${n.slice(1)}(`) ? slice(n.slice(1)) : "") : slice(n),
  );
  const body = decls.map(decl).join("\n") + "\n" + fns.join("\n") + `\nreturn ${expr};`;
  return new Function(...keys, body)(...keys.map((k) => scope[k])) as T;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ------------------------------------------------------------------------ */

describe("the words for every reason a run can give", () => {
  it("cover every code the server counts — the discounted letter's two included", () => {
    const words = build<Record<string, string>>(["FLOW_SKIP_WORDS"], [], {}, "FLOW_SKIP_WORDS");
    const missing = SKIP_REASONS.filter((r) => !words[r]);
    expect(missing, "a reason the panel cannot say drops out of «Последний запуск»").toEqual([]);
  });

  it("no longer promise three hours — the wait is the owner's number now", () => {
    const words = build<Record<string, string>>(["FLOW_SKIP_WORDS"], [], {}, "FLOW_SKIP_WORDS");
    expect(words.too_fresh).not.toContain("трёх часов");
  });
});

describe("«Письма»: every switch is one the server reads", () => {
  const rows = build<string[][]>(["ADM_MAIL_ROWS"], [], {}, "ADM_MAIL_ROWS");
  const switches = Object.keys(FLOW_DEFAULTS).filter(
    (k) => typeof FLOW_DEFAULTS[k as keyof typeof FLOW_DEFAULTS] === "boolean",
  );

  it("the fourth column is a boolean of settings.flows or nothing", () => {
    for (const r of rows) {
      if (!r[3]) continue;
      expect(switches, `${r[0]} carries «${r[3]}», which src/lib/flows.ts never reads`).toContain(r[3]);
    }
  });

  it("the discounted cart letter obeys «Брошенная корзина»'s switch", () => {
    const disc = rows.find((r) => r[0] === "abandoned-cart-discount");
    expect(disc?.[3]).toBe("abandoned");
  });

  it("every «Запустить сейчас» is one the run route accepts", () => {
    const { run, runnable } = build<{ run: Record<string, string>; runnable: Record<string, boolean> }>(
      ["MAIL_RUN_FLOW", "FLOW_RUNNABLE"], [], {}, "{ run: MAIL_RUN_FLOW, runnable: FLOW_RUNNABLE }",
    );
    for (const flow of Object.values(run)) {
      expect(runRoute, `the route refuses «${flow}»`).toContain(`flow !== "${flow}"`);
      expect(RUNNABLE_FLOWS as readonly string[]).toContain(flow);
      expect(runnable[flow], `FLOW_RUNNABLE drops «${flow}»`).toBe(true);
    }
    expect(run["abandoned-cart-discount"]).toBe("abandonedDiscount");
  });
});

describe("«Письма»: the list the owner sees", () => {
  function list(flows: Record<string, unknown>, admin = true): string {
    return build<() => string>(
      ["ADM_MAIL_ROWS", "FLOW_RUNNABLE", "MAIL_RUN_FLOW"],
      ["admMailHTML", "admMailSampleToHTML", "admMailSampleHTML"],
      {
        loadMailTexts: () => {},
        loadFlowCounts: () => {},
        SRV: { admin },
        S: { mailOpen: false, mailTo: "", mailSampleBusy: "" },
        DEMO: { flows },
        esc,
        admMailEditorHTML: () => "[EDITOR]",
        admBirthdayDaysHTML: () => "[BDAYS]",
        admBirthdayPercentHTML: () => "[BPCT]",
        admFlowRunHTML: (f: string) => `[RUN:${f}]`,
        ADM_ROW_OPEN: "",
        flowCountLine: (f: string) => (f ? `[COUNT:${f}]` : ""),
        admSwitch: (attrs: string, on: boolean) => `[SWITCH ${attrs} ${on}]`,
        mailBudgetCard: () => "[BUDGET]",
        cartFlowSettingsCard: () => "[CART]",
        unpaidSettingsCard: () => "[UNPAID]",
      },
      "admMailHTML",
    )();
  }

  it("the four cart numbers sit under the cart letters, switch off or on, above the daily limit", () => {
    for (const on of [false, true]) {
      const html = list({ abandoned: on });
      const disc = html.indexOf('data-mailtpl="abandoned-cart-discount"');
      const cart = html.indexOf("[CART]");
      expect(cart, `switch ${on}: the numbers are not on the page`).toBeGreaterThan(-1);
      expect(cart, "the numbers are above the letter they time").toBeGreaterThan(disc);
      expect(cart, "the numbers are below the daily limit again").toBeLessThan(html.indexOf("[BUDGET]"));
      // …and before the next letter's row, i.e. inside the pair's own group
      expect(cart).toBeLessThan(html.indexOf('data-mailtpl="birthday"'));
      expect(html.split("[CART]").length - 1, "drawn twice").toBe(1);
    }
  });

  it("draws one switch for the pair, and the second row says whose it follows", () => {
    const off = list({ abandoned: false });
    expect(off).not.toContain("abandonedDiscount]");
    expect(off).not.toContain('data-admflow="abandonedDiscount"');
    expect(off.split('data-admflow="abandoned"').length - 1).toBe(1);
    expect(off).toContain("выключено вместе с первым");
    const on = list({ abandoned: true });
    expect(on).toContain("включено вместе с первым");
    // the queue under the second row would be the first letter's number again
    expect(on.split("[COUNT:abandoned]").length - 1).toBe(1);
  });

  it("offers «Запустить сейчас» for BOTH cart letters when the switch is on", () => {
    const on = list({ abandoned: true });
    expect(on).toContain("[RUN:abandoned]");
    expect(on).toContain("[RUN:abandonedDiscount]");
    const off = list({ abandoned: false });
    expect(off).not.toContain("[RUN:");
  });

  it("offers «Прислать пример» for every automatic letter, whatever its switch says", () => {
    const html = list({});
    for (const tpl of ["order-unpaid", "back-in-stock", "abandoned-cart", "abandoned-cart-discount", "birthday"]) {
      expect(html, tpl).toContain(`data-mailsample="${tpl}"`);
    }
    // the order letters are samples in their editor already; the list stays short
    expect(html).not.toContain('data-mailsample="order-confirmed"');
  });

  it("asks where to send the samples above the list — and only the owner", () => {
    const html = list({});
    const field = html.indexOf("data-mailto");
    expect(field).toBeGreaterThan(-1);
    expect(field).toBeLessThan(html.indexOf('<div class="adm-list">'));
    const guest = list({}, false);
    expect(guest).not.toContain("data-mailto");
    expect(guest).not.toContain("data-mailsample");
  });
});

describe("«Прислать пример» sends the demo letter to the typed address", () => {
  function rig(address: string) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const toasts: string[] = [];
    const S = { mailTo: address, mailSampleBusy: "", admMailKey: null as unknown };
    const fetchStub = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { status: 200, json: async () => ({ ok: true }) };
    });
    const send = build<(tpl: string) => void>(
      [],
      ["srvMailSample", "mailSendToast"],
      {
        S,
        fetch: fetchStub,
        keepMailTo: () => {},
        toast: (m: string) => toasts.push(m),
        refocus: () => {},
        render: () => {},
        mailLang: () => "RU",
        admPanesSave: () => {},
      },
      "srvMailSample",
    );
    return { calls, toasts, send, S };
  }

  it("posts the letter's template to the route «Отправить мне тест» uses", async () => {
    const r = rig("dim@example.com");
    r.send("abandoned-cart-discount");
    await vi.waitFor(() => expect(r.toasts.length).toBe(1));
    expect(r.calls).toEqual([
      { url: "/api/admin/mail/test/", body: { template: "abandoned-cart-discount", to: "dim@example.com", lang: "RU" } },
    ]);
    expect(r.toasts[0]).toContain("Пример отправлен");
    expect(r.S.admMailKey).toBe(true);
  });

  it("with no address it asks for one and sends nothing", () => {
    const r = rig("");
    r.send("abandoned-cart");
    expect(r.calls).toEqual([]);
    expect(r.toasts).toEqual(["Введите e-mail — на него придёт образец"]);
  });
});

describe("the settings cards show what the shop runs on, not what the first paint guessed", () => {
  it("«Сколько писем в сутки»: numbers that arrive after the first paint fill the boxes", () => {
    const S: Record<string, unknown> = { newsBudget: null };
    const rig = build<{ card: () => string; dirty: () => boolean; draft: () => Record<string, unknown> }>(
      [],
      ["?mailBudgetStored", "mailBudgetDraft", "mailBudgetCard", "mailBudgetDirty", "mailBudgetActsHTML"],
      { S, esc, loadNewsAudience: () => {}, newsBudgetLineHTML: () => "" },
      "{ card: mailBudgetCard, dirty: mailBudgetDirty, draft: mailBudgetDraft }",
    );
    expect(rig.card()).toContain('value="100"');   // before the server answered
    S.newsBudget = { cap: 4, reserve: 2 };           // …and after
    const html = rig.card();
    expect(html).toContain('data-mbf="cap" value="4"');
    expect(html).toContain('data-mbf="reserve" value="2"');
    expect(rig.dirty(), "the owner's own saved numbers read as unsaved").toBe(false);
    // the warning is in the markup either way; unsaved, it loses its `hidden`
    expect(html).toContain(" hidden>Изменения не сохранены</span>");
    // typing still makes a draft, and the draft is what the box shows
    rig.draft().cap = "5";
    expect(rig.dirty()).toBe(true);
    expect(rig.card()).toContain('data-mbf="cap" value="5"');
  });

  it("«Брошенные корзины»: the same for the four cart numbers", () => {
    const DEMO = { flows: {} as Record<string, unknown> };
    const S: Record<string, unknown> = {};
    const rig = build<{ card: () => string; dirty: () => boolean }>(
      [],
      ["?cartFlowStored", "cartFlowDraft", "cartFlowSettingsCard", "cartFlowDirty", "cartFlowActsHTML"],
      { S, DEMO, esc },
      "{ card: cartFlowSettingsCard, dirty: cartFlowDirty }",
    );
    expect(rig.card()).toContain('data-cartf="hours" value="3"');
    DEMO.flows = { abandonedHours: 12, abandonedDiscountDays: 2, abandonedDiscountPercent: 7, abandonedDiscountMinTotal: 80 };
    const html = rig.card();
    for (const [k, v] of [["hours", "12"], ["days", "2"], ["percent", "7"], ["min", "80"]]) {
      expect(html).toContain(`data-cartf="${k}" value="${v}"`);
    }
    expect(rig.dirty()).toBe(false);
    // one line of explanation under every box, and the button that saves them
    expect(html.split('<span class="adm-hint">').length - 1).toBe(4);
    expect(html).toContain("data-admcartsave");
  });

  it("«Неоплаченные заказы»: the card beside them follows the same rule", () => {
    const DEMO = { flows: {} as Record<string, unknown> };
    const S: Record<string, unknown> = {};
    const rig = build<{ card: () => string; dirty: () => boolean }>(
      [],
      ["?unpaidStored", "unpaidDraft", "unpaidSettingsCard", "unpaidDirty", "unpaidActsHTML"],
      { S, DEMO, esc },
      "{ card: unpaidSettingsCard, dirty: unpaidDirty }",
    );
    expect(rig.card()).toContain('data-unpaidf="remind" value="3"');
    DEMO.flows = { unpaidRemindDays: 2, unpaidCancelDays: 5 };
    const html = rig.card();
    expect(html).toContain('data-unpaidf="remind" value="2"');
    expect(html).toContain('data-unpaidf="cancel" value="5"');
    expect(rig.dirty()).toBe(false);
  });
});

describe("«Подключения»: the shop's own order letter", () => {
  function rows(ownerMail: unknown, test: unknown = null) {
    return build<() => Array<{ name: string; ok: boolean; quiet?: boolean; sub: string; act: string }>>(
      [],
      ["admIntegrationRows"],
      {
        PAYMETHODS: { banks: [1] },
        S: { shipLiveRates: null, admMailKey: null, ownerMailTest: test, ownerMailBusy: false, lang: "RU" },
        GSC: null,
        gscBadKeyLine: () => "",
        ANALYTICS: {},
        admAI: null,
        MONTONIO: null,
        OWNER_MAIL: ownerMail,
        esc,
        scanSupportInfo: () => ({ camera: true }),
        admDevLink: () => "[DIM]",
      },
      "admIntegrationRows",
    )().find((r) => r.name === "Письмо магазину о заказе");
  }

  it("is red and says what to set in Vercel when RESEND_TO is missing", () => {
    const r = rows({ key: true, to: "" });
    expect(r, "«Подключения» has no row for the order letter").toBeTruthy();
    expect(r!.ok).toBe(false);
    expect(r!.sub).toContain("RESEND_TO");
    expect(r!.sub).toContain("Vercel");
    expect(r!.sub).toContain("shop@rempireshop.com");
    expect(r!.act).toBe("[DIM]");
  });

  it("is green with the address, and offers a real test letter, when it is set", () => {
    const r = rows({ key: true, to: "shop@rempireshop.com" })!;
    expect(r.ok).toBe(true);
    expect(r.sub).toContain("shop@rempireshop.com");
    expect(r.act).toContain("data-notifytest");
  });

  it("turns red with Resend's own words when the test letter was refused", () => {
    const r = rows({ key: true, to: "shop@rempireshop.com" }, { ok: false, error: "send_failed", status: 403, detail: "The domain is not verified." })!;
    expect(r.ok).toBe(false);
    expect(r.sub).toContain("The domain is not verified.");
  });

  it("says «Проверяем…» until the server answered, and grey when it could not", () => {
    expect(rows(null)!.sub).toBe("Проверяем…");
    const unknown = rows({ unknown: true })!;
    expect(unknown.ok).toBe(true);
    expect(unknown.quiet).toBe(true);
  });
});

describe("«Настройки» has a door to «Письма»", () => {
  it("between «Оповещения на телефон» and the journal, opening Маркетинг → Письма", () => {
    const html = build<() => string>(
      ["ADM_SET_PAGES"],
      ["admSetupHTML", "admSetMailLinkHTML"],
      { S: { admSetPage: "" }, admHead: () => "" },
      "admSetupHTML",
    )();
    const door = html.indexOf('data-admtab="mail"');
    expect(door).toBeGreaterThan(html.indexOf('data-admsetpage="push"'));
    expect(door).toBeLessThan(html.indexOf('data-admsetpage="journal"'));
    expect(html.slice(door, door + 400)).toContain("сколько писем в сутки");
  });
});
