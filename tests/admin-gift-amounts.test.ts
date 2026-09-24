/**
 * «Маркетинг → Подарочные карты»: the denomination chips (map-defects #18,
 * 24.09.2026).
 *
 *   · A save the server refused left the chip in its new state. The toast said
 *     «Не удалось сохранить на сервере», but the chip stayed lit (or dark) over
 *     a shop still selling the old list until the next reload — while the
 *     promo switch and the partner switch next door go back on a refusal.
 *     Now the chips go back too, and the journal line that described the
 *     change is dropped.
 *   · The chips wrote their price as `v + " €"`, so an English panel read
 *     «25 €» beside every other price's «€25». They use eur() now.
 *
 * demoApply → srvPush → srvSaved are cut out of public/shop2/app.js by source
 * text and run over stubs (the tests/shipping-save-sticks.test.ts technique);
 * a function the fix added is simply absent when this runs on the old code.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

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
const has = (name: string) => src.includes(`function ${name}(`);

/** Anything the sandbox does not provide: callable, returns nothing, any property is itself. */
const STUB: unknown = new Proxy(function () { return undefined; }, {
  get: (_t, k) => (k === "then" || typeof k === "symbol" ? undefined : STUB),
  apply: () => undefined,
});

const FUNCS = ["demoApply", "demoUndo", "srvPush", "srvSaved", "giftAmountsOn", "journalDrop", "giftAmountsBack", "eur", "admGiftScreenHTML"];

type Answer = { status: number; body: unknown } | "offline";
type Fns = Record<string, (...a: unknown[]) => unknown>;

/** A panel with the gift amounts on `on`, whose settings PUT answers `answer`. */
function panel(on: number[], answer: Answer, lang = "RU") {
  const toasts: string[] = [];
  const puts: unknown[] = [];
  const scope: Record<string, unknown> = {
    S: { lang, screen: "admin", admGiftCards: null, admGiftErr: "" },
    SRV: { admin: true },
    DEMO: { giftAmounts: on.slice(), log: [] as unknown[] },
    GIFT_AMOUNTS: [25, 50, 75, 100],
    GIFT_AMOUNTS_DEFAULT: [25, 50, 100],
    shipRollback: null,
    apiSend: (_url: string, _method: string, body: unknown) => {
      puts.push(body);
      return answer === "offline" ? Promise.reject(new Error("offline")) : Promise.resolve(answer);
    },
    toast: (t: string) => { toasts.push(t); },
    actionText: () => "Номиналы подарочной карты",
    esc: (s: unknown) => String(s),
    admColsHTML: (l: string, r: string) => l + r,
    giftSamplePdf: () => "",
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => typeof k === "string" && (k in t || !(k in globalThis)),
    get: (t, k) => (typeof k !== "string" ? undefined : k in t ? t[k] : STUB),
    set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; return true; },
  });
  const present = FUNCS.filter(has);
  // Only this repository's own source and fixed text go into the body.
  const make = new Function(
    "__scope",
    `with (__scope) {\n${present.map(slice).join("\n")}\nreturn { ${present.map((n) => `${n}: ${n}`).join(", ")} };\n}`,
  );
  const fn = make(proxy) as Fns;
  const demo = scope.DEMO as { giftAmounts: number[]; log: unknown[] };
  return { fn, demo, toasts, puts };
}

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const REFUSED: Answer = { status: 503, body: { ok: false, error: "db_unavailable" } };
const OK: Answer = { status: 200, body: { ok: true } };

describe("a denomination the server refused goes back", () => {
  it("25 € switched off, the save refused: 25 € is on again and the journal line is gone", async () => {
    const p = panel([25, 50, 100], REFUSED);
    p.fn.demoApply({ type: "set_gift_amounts", value: [50, 100] });
    expect(p.demo.giftAmounts).toEqual([50, 100]);   // the chip answers the thumb at once
    await tick();
    expect(p.toasts).toContain("Не удалось сохранить на сервере — попробуйте ещё раз");
    expect(p.demo.giftAmounts, "the chip stayed in its new state").toEqual([25, 50, 100]);
    expect(p.demo.log).toEqual([]);
  });

  it("…and the same when the request never came back at all", async () => {
    const p = panel([25, 50, 100], "offline");
    p.fn.demoApply({ type: "set_gift_amounts", value: [25, 50, 75, 100] });
    await tick();
    expect(p.toasts).toContain("Сервер не отвечает — изменение не сохранилось");
    expect(p.demo.giftAmounts).toEqual([25, 50, 100]);
  });

  it("a save that went through stays, with its journal line", async () => {
    const p = panel([25, 50, 100], OK);
    p.fn.demoApply({ type: "set_gift_amounts", value: [50, 100] });
    await tick();
    expect(p.demo.giftAmounts).toEqual([50, 100]);
    expect(p.demo.log).toHaveLength(1);
    expect(p.puts).toEqual([{ gift_amounts: [50, 100] }]);
  });

  it("a tap made since is its own save: an older refusal does not undo it", async () => {
    const p = panel([25, 50, 100], REFUSED);
    p.fn.demoApply({ type: "set_gift_amounts", value: [50, 100] });
    // the owner taps 75 € before the first answer is back
    p.demo.giftAmounts = [50, 75, 100];
    await tick();
    expect(p.demo.giftAmounts).toEqual([50, 75, 100]);
  });

  it("«Отменить» the server refused puts the chips back to what the undo replaced", async () => {
    const ok = panel([25, 50, 100], OK);
    ok.fn.demoApply({ type: "set_gift_amounts", value: [50, 100] });
    await tick();
    const entry = ok.demo.log[0] as { prev: Record<string, unknown> };
    // the same journal line on a panel whose server now refuses
    const p = panel([50, 100], REFUSED);
    p.demo.log.push(entry);
    p.fn.demoUndo(0);
    expect(p.demo.giftAmounts).toEqual([25, 50, 100]);
    await tick();
    expect(p.demo.giftAmounts, "the undo the server refused stayed on screen").toEqual([50, 100]);
  });
});

describe("the chips say their price the way eur() does", () => {
  const chips = (lang: string) => {
    const html = panel([25, 50, 100], OK, lang).fn.admGiftScreenHTML() as string;
    return [...html.matchAll(/data-admgiftamt="\d+" aria-pressed="(?:true|false)">([^<]+)</g)].map((m) => m[1]);
  };
  it("EN: «€25», like every other price in the panel", () => {
    expect(chips("EN")).toEqual(["€25", "€50", "€75", "€100"]);
  });
  it("RU and ET: «25 €»", () => {
    expect(chips("RU")).toEqual(["25 €", "50 €", "75 €", "100 €"]);
    expect(chips("ET")).toEqual(["25 €", "50 €", "75 €", "100 €"]);
  });
});
