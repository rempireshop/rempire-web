/**
 * A box whose text the model took keystroke by keystroke shows whatever the
 * model later puts back — a reset to the value drawn before the typing too.
 *
 * Verification pass on staging, 25.09.2026, item panel-promo-create: «+
 * Промокод» → a code → «Сумма» → 150 → «Процент». promoSetKind() empties the
 * discount in S, but the box still read 150 and «Создать» answered «Проверьте
 * размер скидки: процент от 1 до 90…» under it. The panel is morph-patched
 * (admMorphNode) and wrote `.value` only when the markup's value ATTRIBUTE
 * changed; the promo form is typed into without a render, so the attribute
 * still said "" (drawn for «Сумма» before the typing) and the reset to ""
 * looked like «nothing changed». posBoxSync, syncShipInputs and the points
 * box each had a hand-written workaround for the same thing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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

/** An <input>/<textarea> as the morph sees it; every `.value` write is counted (the caret). */
class Box {
  nodeType = 1;
  attrs = new Map<string, string>();
  textContent = "";
  checked = false;
  writes = 0;
  private v = "";
  __admHeld: string | undefined;
  constructor(public tagName: string, attrs: Record<string, string>, text = "") {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    if (tagName === "INPUT") this.v = attrs.value ?? "";
    else { this.textContent = text; this.v = text; }
  }
  get value() { return this.v; }
  set value(x: string) { this.writes++; this.v = x; }
  /** what the owner's keyboard does: the text changes, the markup does not */
  type(x: string) { this.v = x; }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(n: string) { return this.attrs.has(n) ? this.attrs.get(n)! : null; }
  hasAttribute(n: string) { return this.attrs.has(n); }
  setAttribute(n: string, v: string) { this.attrs.set(n, String(v)); }
  removeAttribute(n: string) { this.attrs.delete(n); }
  get isContentEditable() { return false; }
}

const rig = new Function(`
  var admPaintedKey = "drawn";
  ${["admFieldKey", "admMorphAttrs", "admSelectedIdx", "admMorphChildren", "admHeld", "admMorphNode"].map(slice).join("\n")}
  return { morph: admMorphNode, held: admHeld, key: function () { return admPaintedKey; } };
`)() as { morph: (from: Box, to: Box) => void; held: (el: Box, v?: string) => void; key: () => string };

const promoValue = (value: string) => new Box("INPUT", { class: "adm-input", "data-promof": "value", inputmode: "decimal", value });

describe("a box the model mirrors (admHeld) follows the model, a reset included", () => {
  it("«Сумма» 150 → «Процент»: the emptied discount reaches the box", () => {
    const live = promoValue("");          // drawn for «Сумма», empty
    live.type("150");                      // typed; S.promoForm.value = "150", no render
    rig.held(live);                        // the input listener: the model took it
    rig.morph(live, promoValue(""));       // promoSetKind emptied it — the markup says "" again
    expect(live.value).toBe("");
  });

  it("a background render carrying the typed text back leaves the box and its caret alone", () => {
    const live = promoValue("");
    live.type("15");
    rig.held(live);
    rig.morph(live, promoValue("15"));
    expect(live.value).toBe("15");
    expect(live.writes).toBe(0);
    expect(live.getAttribute("value")).toBe("15");
  });

  it("the mark is used once: a later render with the same markup keeps the box as the last render left it", () => {
    const live = promoValue("");
    live.type("150");
    rig.held(live);
    rig.morph(live, promoValue("150"));
    expect(live.__admHeld).toBeUndefined();
    rig.morph(live, promoValue("150"));
    expect(live.value).toBe("150");
    expect(live.writes).toBe(0);
  });

  it("a box the model does NOT mirror keeps what was typed under an unchanged markup (the product card)", () => {
    const live = new Box("INPUT", { "data-edprice": "p1", value: "12" });
    live.type("12,90");
    rig.morph(live, new Box("INPUT", { "data-edprice": "p1", value: "12" }));
    expect(live.value).toBe("12,90");
  });

  it("a held textarea: a reset reaches it, the same text does not rewrite it", () => {
    const mk = (text: string) => new Box("TEXTAREA", { "data-admcustnotesf": "", "data-autosave": "cust:7:notes" }, text);
    const a = mk("");
    a.type("постоянный клиент");
    rig.held(a);
    rig.morph(a, mk(""));
    expect(a.value).toBe("");

    const b = mk("");
    b.type("оптовик");
    rig.held(b);
    rig.morph(b, mk("оптовик"));
    expect(b.value).toBe("оптовик");
    expect(b.writes).toBe(0);
    expect(b.textContent).toBe("оптовик");
  });

  it("the next render is not skipped as «the same markup as last time»", () => {
    const live = promoValue("");
    live.type("1");
    rig.held(live);
    expect(rig.key()).toBe("");
  });
});

/**
 * «Настройки → Тексты страниц», live test 26.10.2026: a line typed, saved,
 * a second line typed over it and saved, «Вернуть» on the toast — the server
 * had the first line back, the box still read the second. The box saves
 * itself without a render, so its markup still said the first line, and the
 * undo's markup said the first line too: «nothing changed» to the morph. It
 * needs a render after the first save (any tap does one) — the e2e
 * (admin-page-texts.spec.ts) switches the language tabs for it.
 * ptAs now tells the box what the model took (admHeld with the saved text).
 */
describe("a box that saves itself follows a «Вернуть» (ptAs)", () => {
  const intro = (text: string) => new Box("TEXTAREA", { "data-notr": "", "data-autosave": "pt:cat:beard:RU:intro" }, text);
  const title = (value: string) => new Box("INPUT", { "data-notr": "", "data-autosave": "pt:cat:beard:RU:title", value });

  it("the undone words leave the box", () => {
    const live = intro("Тестовая строка.");          // the last render drew the first line
    live.type("Вторая тестовая строка.");             // typed, saved — no render
    rig.held(live, "Вторая тестовая строка.");
    rig.morph(live, intro("Тестовая строка."));        // «Вернуть»: the first line again
    expect(live.value).toBe("Тестовая строка.");
  });

  it("…in the one-line title box too", () => {
    const live = title("Борода");
    live.type("Борода и усы");
    rig.held(live, "Борода и усы");
    rig.morph(live, title("Борода"));
    expect(live.value).toBe("Борода");
  });

  it("a background render of the saved text leaves the box and its caret alone, a trailing space included", () => {
    const live = intro("");
    live.type("Масла для бороды ");                    // still typing: the space is not stored
    rig.held(live, "Масла для бороды");
    rig.morph(live, intro("Масла для бороды"));
    expect(live.value).toBe("Масла для бороды ");
    expect(live.writes).toBe(0);
    expect(live.textContent).toBe("Масла для бороды");
  });

  it("ptAs holds the box with the text it saved", () => {
    expect(slice("ptAs")).toMatch(/admHeld\(document\.querySelector\(admAsSel\("data-autosave", as\)\), text\)/);
  });
});

describe("which boxes are marked", () => {
  const sel = (src.match(/var ADM_HELD_SEL = ([^;]+);/) || [])[1] || "";
  const list = sel.replace(/["+\s]/g, "").split(",").filter(Boolean);

  it("the promo form and the other boxes a reset used to miss", () => {
    for (const f of ["[data-promof]", "[data-promoq]", "[data-admcustpoints]", "[data-admcustnote]", "[data-posq]",
      "[data-posdiscount]", "[data-admq]", "[data-goodsq]", "[data-admorderq]", "[data-stockq]"]) {
      expect(list).toContain(f);
    }
  });

  it("never a box whose markup is not the model's copy of the keystroke", () => {
    for (const f of ["[data-edprice]", "[data-edproprice]", "[data-orderreplydraft]", "[data-shiprule]", "[data-bundlepct]"]) {
      expect(list).not.toContain(f);
    }
  });

  it("the listener marks them only on the panel", () => {
    expect(src).toMatch(/S\.screen === "admin" && t && t\.matches && t\.matches\(ADM_HELD_SEL\)\) admHeld\(t\)/);
  });
});
