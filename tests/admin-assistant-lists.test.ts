/**
 * The assistant's answer, drawn as something a person can read at a glance.
 *
 * The owner, /test pass of 23.09.2026 (ai-assistant-ask): «Hard to read the
 * answer to "Что заканчивается и что дозаказать?" — it's just a list of
 * words», e.g. «Заканчиваются или мало на складе: Kevin.Murphy
 * HYDRATE-ME.MASQUE — маска 40 мл (нет), Kevin.Murphy …, …». The prompt
 * asked for «1-3 short sentences», so twelve products were strung into one,
 * and the bubble printed the reply as one escaped string.
 *
 * Both halves change: the model is asked for one item per line («• name —
 * state»), and the bubble draws a list as a list — one product a line, the
 * count or state at the end, «нет» marked — out of TEXT, escaped before
 * anything is built from it. An answer that still arrives as the old run-on
 * sentence is split the same way.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8");
const routeSrc = readFileSync(fileURLToPath(new URL("../src/app/api/assistant/route.ts", import.meta.url)), "utf8");

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

const reply = new Function(
  `${slice("esc")}\n${slice("admReplyItem")}\n${slice("admReplyHTML")}\nreturn admReplyHTML;`,
)() as (text: string) => string;

const items = (html: string) => [...html.matchAll(/<li class="adm-msg__li">([\s\S]*?)<\/li>/g)].map((m) => m[1]);

describe("a list is drawn as a list", () => {
  it("one product a line, the state at the end, «нет» marked", () => {
    const html = reply(
      "Заканчиваются 3 товара:\n" +
      "• Kevin.Murphy HYDRATE-ME.MASQUE — маска 40 мл — нет (0 шт)\n" +
      "• Proraso Beard Oil Azur Lime — масло для бороды 30 мл — мало (2 шт)\n" +
      "- Davines OI Oil — масло для волос 50 мл — мало (1 шт)",
    );
    expect(html).toContain('<p class="adm-msg__p">Заканчиваются 3 товара:</p>');
    const li = items(html);
    expect(li).toHaveLength(3);
    expect(li[0]).toBe(
      '<span class="adm-msg__nm">Kevin.Murphy HYDRATE-ME.MASQUE — маска 40 мл</span>' +
      '<span class="adm-msg__st adm-msg__st--out">нет (0 шт)</span>',
    );
    expect(li[1]).toContain('<span class="adm-msg__st">мало (2 шт)</span>');
    expect(html).toMatch(/^<div class="adm-msg__txt" data-notr>/);
  });

  it("the owner's run-on sentence is split the same way", () => {
    const html = reply(
      "Заканчиваются или мало на складе: Kevin.Murphy HYDRATE-ME.MASQUE — маска 40 мл (нет), " +
      "Kevin.Murphy ANGEL.WASH — шампунь 250 мл (мало), Proraso Wood & Spice — бальзам 100 мл (нет). " +
      "Могу собрать заказ поставщику.",
    );
    expect(html).toContain('<p class="adm-msg__p">Заканчиваются или мало на складе:</p>');
    const li = items(html);
    expect(li).toHaveLength(3);
    expect(li[0]).toBe(
      '<span class="adm-msg__nm">Kevin.Murphy HYDRATE-ME.MASQUE — маска 40 мл</span>' +
      '<span class="adm-msg__st adm-msg__st--out">нет</span>',
    );
    expect(li[2]).toContain("Proraso Wood &amp; Spice — бальзам 100 мл");
    expect(html).toContain('<p class="adm-msg__p">Могу собрать заказ поставщику.</p>');
  });

  it("English and Estonian answers mark their own «out»", () => {
    expect(reply("• Hydrate.Me Masque 40 ml — out (0)")).toContain("adm-msg__st--out");
    expect(reply("• Hydrate.Me Masque 40 ml — otsas (0 tk)")).toContain("adm-msg__st--out");
  });

  it("an item with no state at its end is just the item", () => {
    const li = items(reply("• R-100042 · Иван Петров — 45,00 € · этикетка готова, ждёт отправки уже третий день подряд"));
    expect(li[0]).toBe('<span class="adm-msg__nm">R-100042 · Иван Петров — 45,00 € · этикетка готова, ждёт отправки уже третий день подряд</span>');
  });

  it("plain sentences stay sentences, one paragraph a line", () => {
    const html = reply("Всё в порядке.\n\nЗаказов в очереди нет, a sentence with, commas, in it.");
    expect(html).toBe(
      '<div class="adm-msg__txt" data-notr><p class="adm-msg__p">Всё в порядке.</p>' +
      '<p class="adm-msg__p">Заказов в очереди нет, a sentence with, commas, in it.</p></div>',
    );
  });

  it("it is text, never markup — whatever the model wrote", () => {
    const html = reply('• <img src=x onerror="alert(1)"> — нет\n<script>alert(2)</script>');
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });
});

describe("the bubble uses it, and the model is asked for lines", () => {
  it("the admin's answer goes through the list drawer — the model's words kept out of the dictionary", () => {
    expect(slice("admAnswerHTML")).toContain("admReplyHTML(a.reply || \"\")");
    expect(css).toMatch(/\.adm-msg__li\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.adm-msg__st--out\s*\{/);
    expect(css).toMatch(/\.adm-msg__txt\s*\{[^}]*white-space:\s*normal/);
  });

  it("the prompt asks for one item a line, the state last", () => {
    expect(routeSrc).toContain("each item on its own line starting with «• »");
  });
});
