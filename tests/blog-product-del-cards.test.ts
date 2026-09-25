/**
 * The × in «Товары в статье» takes the product's cards out of the text too —
 * verification pass on staging, 25.09.2026: the × «removes from that list and
 * saves but leaves the inline card». The product was off the article's list
 * and its card still stood in the Russian, Estonian and English text, selling
 * it to every reader.
 *
 * Now the × takes every card of that product out of all three texts (with the
 * line a card stood on alone), the article saves itself, and «Вернуть» on the
 * toast puts the product back on the list and the cards back into every text
 * nobody has touched since — never over words written after the ×.
 *
 * The panel's own click branch and helper are cut out of public/shop2/app.js
 * and run with the draft and the toast caught.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
function braces(start: number, what: string): string {
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${what} in app.js`);
}
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  return braces(start, name);
}
function block(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  return braces(start, head);
}

const SHAMPOO = "system-4-bio-botanical-shampoo";
const SERUM = "system-4-bio-botanical-serum";
const card = (id: string, L: string, name: string) =>
  `<a data-product="${id}" data-price="live" href="/shop2${L === "RU" ? "" : "/" + L.toLowerCase()}/p/${id}/">${name}</a>`;

function draft() {
  return {
    products: [SHAMPOO, SERUM],
    body: {
      RU: `<p>Осенью волосы сохнут.</p><p>${card(SHAMPOO, "RU", "Bio Botanical Shampoo — шампунь")}</p>` +
        `<p>Мягкий шампунь.</p><p>Капля ${card(SERUM, "RU", "Bio Botanical Serum — сыворотка")}&nbsp;на кончики, и ${card(SHAMPOO, "RU", "шампунь")}&nbsp;раз в два дня.</p>`,
      ET: `<p>Sügisel kuivavad juuksed.</p><p>${card(SHAMPOO, "ET", "Bio Botanical Shampoo — šampoon")}</p><p>Õrn šampoon.</p>`,
      EN: `<p>Hair dries out in autumn.</p><p>${card(SERUM, "EN", "Bio Botanical Serum — serum")}</p>`,
    },
  };
}

/** Presses × on `id` in «Товары в статье» — the panel's own branch, with the toast caught. */
function press(d: ReturnType<typeof draft>, id: string) {
  const S: Record<string, unknown> = { adminBlogEdit: d };
  const toasts: Array<{ msg: string; undo?: { prev: boolean; undo: () => void } }> = [];
  let saves = 0;
  let reads = 0;
  const names = ["blogDropCard"].filter((n) => src.includes(`function ${n}(`));
  new Function(
    "S", "d", "blogAutosave", "toast", "render", "blogReadForm", "BLOG_PRODUCTS_MAX",
    `${names.map(slice).join("\n")}\n${block("if (d.admblogproductdel) {")}`,
  )(
    S, { admblogproductdel: id }, () => { saves++; },
    (msg: string, undo?: { prev: boolean; undo: () => void }) => toasts.push({ msg, undo }),
    () => {}, () => { reads++; }, 12,
  );
  return { toasts, saves: () => saves, reads: () => reads };
}

describe("× in «Товары в статье» takes the product's cards out of the text", () => {
  it("every card of it leaves all three texts — a card alone on its line with the line, one in a sentence without the sentence", () => {
    const d = draft();
    const { toasts, saves, reads } = press(d, SHAMPOO);
    expect(d.products).toEqual([SERUM]);
    expect(d.body.RU, "a card of the product stayed in the Russian text").not.toContain(`data-product="${SHAMPOO}"`);
    expect(d.body.ET, "…in the Estonian text").not.toContain(`data-product="${SHAMPOO}"`);
    expect(d.body.RU).toBe(
      `<p>Осенью волосы сохнут.</p><p>Мягкий шампунь.</p><p>Капля ${card(SERUM, "RU", "Bio Botanical Serum — сыворотка")}&nbsp;на кончики, и раз в два дня.</p>`,
    );
    expect(d.body.ET).toBe("<p>Sügisel kuivavad juuksed.</p><p>Õrn šampoon.</p>");
    // the other product's cards are not touched
    expect(d.body.EN).toBe(draft().body.EN);
    expect(saves(), "the article did not save itself").toBe(1);
    expect(reads(), "the box's latest words were not read in before the cards were taken out").toBe(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toBe("Товар и его карточки убраны из статьи");
    expect(toasts[0].undo?.prev, "no «Вернуть» on the toast").toBe(true);
  });

  it("«Вернуть» puts the product and its cards back, in their places", () => {
    const d = draft();
    const { toasts, saves } = press(d, SHAMPOO);
    toasts[0].undo!.undo();
    expect(d.products).toEqual([SHAMPOO, SERUM]);
    expect(d.body).toEqual(draft().body);
    expect(saves()).toBe(2);
  });

  it("…but never over words written after the ×: that text keeps them, the product still comes back", () => {
    const d = draft();
    const { toasts } = press(d, SHAMPOO);
    d.body.ET += "<p>Uus lõik.</p>";
    toasts[0].undo!.undo();
    expect(d.products).toEqual([SHAMPOO, SERUM]);
    expect(d.body.ET).toBe("<p>Sügisel kuivavad juuksed.</p><p>Õrn šampoon.</p><p>Uus lõik.</p>");
    expect(d.body.RU).toBe(draft().body.RU);
  });

  it("a card followed by words and another link on its line takes only itself out", () => {
    const d = draft();
    d.body.RU = `<p>${card(SHAMPOO, "RU", "шампунь")} и <a href="https://example.com/">статья</a></p><p>Дальше.</p>`;
    press(d, SHAMPOO);
    expect(d.body.RU).toBe('<p> и <a href="https://example.com/">статья</a></p><p>Дальше.</p>');
  });

  it("a product with no card in the text says what it always said", () => {
    const d = draft();
    d.body = { RU: "<p>Текст.</p>", ET: "", EN: "" };
    const { toasts } = press(d, SERUM);
    expect(d.products).toEqual([SHAMPOO]);
    expect(d.body.RU).toBe("<p>Текст.</p>");
    expect(toasts[0].msg).toBe("Товар убран из статьи");
  });
});
