/**
 * Product descriptions with sections (Dim, 02.11.2026) — the light markup in
 * the owner's plain text and the one renderer that draws it
 * (src/lib/desc-format.mjs): a short line ending in «:» is a bold heading,
 * «— » / «- » starts a point of a list, **word** is bold, everything else is
 * escaped. Held here:
 *   · the two copies — the module and the block app.js carries — are one;
 *   · headings, the «Объём: 30 мл» label that is NOT one, dash lists and the
 *     implicit-list rule, on the shop's own texts (Proraso Azur Lime in all
 *     three languages, as the live catalogue has them on 02.11.2026);
 *   · bold and escaping — no tag ever comes out of the stored text;
 *   · descPlain() for every plain-text copy (the Merchant feed, search);
 *   · the static product page draws what app.js draws;
 *   · the panel's «Ж» / «Заголовок» / «• Список» transforms;
 *   · the AI: the «Разбить на разделы» word check, the writers' prompts, and
 *     the wrong-language guard with the marks in the text.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { descBlocks, descHeading, descHtml, descPlain } from "@/lib/desc-format.mjs";
import { descFormatBlock } from "../tools/lib/seo-copy-block.mjs";
import { descriptionHtml } from "@/lib/product-page";
import { buildFeed, feedIntro } from "@/lib/merchant-feed";
import { DEFAULT_SHIPPING_RULES } from "@/lib/shipping";
import {
  buildDescribePrompt, buildPrompt, buildSectionsPrompt, buildTranslatePrompt, DESC_FORMAT_EXAMPLE, descStructure,
  isAiTask, sectionsKeepWords, seoOffLanguage,
} from "@/lib/ai-prompts";

const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const MOD = readFileSync(fileURLToPath(new URL("../src/lib/desc-format.mjs", import.meta.url)), "utf8");

/* The shop's own text, as get_product answered for proraso-beard-oil-azur-lime-30ml
   on 02.11.2026 (the INCI line shortened): the points under «Преимущества:»
   are plain lines with no dash, after an empty line. */
const PRORASO_RU = [
  "Proraso Azur Lime — масло для бороды",
  "",
  "Масло для бороды Proraso из серии Azur Lime помогает усмирить, разгладить, напитать и защитить длинную густую бороду. Масло грецкого ореха и масло подсолнечника, богатые омега-3 и омега-6, увлажняют и кондиционируют волосы бороды.",
  "",
  "Преимущества:",
  "",
  "для длинной и густой бороды",
  "усмиряет и разглаживает бороду",
  "питает, увлажняет и защищает волосы бороды",
  "смягчает бороду и придаёт ей стойкий блеск",
  "97% ингредиентов природного происхождения",
  "без ингредиентов животного происхождения, не тестируется на животных",
  "без парабенов, фталатов, силиконов, минеральных масел, искусственных красителей и SLS",
  "дерматологически протестировано",
  "произведено в Италии",
  "",
  "Ключевые ингредиенты:",
  "",
  "Масло подсолнечника и грецкий орех. Богаты омега-3 и омега-6, увлажняют и кондиционируют волосы бороды.",
  "Масла авокадо и макадамии. Дополнительно защищают бороду, смягчают её и придают стойкий блеск.",
  "",
  "Аромат: свежая композиция из бодрящих цитрусовых нот, мяты и можжевельника на фоне мха, древесных нот и пачули.",
  "",
  "Как использовать: нанесите несколько капель масла на ладони и распределите по бороде от корней до кончиков.",
  "",
  "Объём: 30 мл",
  "",
  "Состав (INCI): Helianthus Annuus (Sunflower) Seed Oil, Parfum (Fragrance), Eucalyptus Globulus Leaf Oil.",
].join("\n");
const PRORASO_ET = [
  "Proraso Azur Lime — habemeõli",
  "",
  "Proraso sarja Azur Lime habemeõli aitab taltsutada, siluda, toita ja kaitsta pikka ning tihedat habet.",
  "",
  "Eelised:",
  "",
  "sobib pikale ja tihedale habemele",
  "taltsutab ja silub habet",
  "ei sisalda parabeene, ftalaate, silikoone, mineraalõlisid, kunstlikke värvaineid ega SLS-i",
  "toodetud Itaalias",
  "",
  "Kasutamine: kanna paar tilka õli peopesadele ja jaota habemele juurtest otsteni.",
  "",
  "Maht: 30 ml",
].join("\n");
const PRORASO_EN = [
  "Proraso Azur Lime — beard oil",
  "",
  "Proraso beard oil from the Azur Lime range helps tame, smooth, nourish and protect a long, thick beard.",
  "",
  "Benefits:",
  "",
  "for long, thick beards",
  "tames and smooths the beard",
  "free from parabens, phthalates, silicones, mineral oils, artificial colourants and SLS",
  "made in Italy",
  "",
  "How to use: apply a few drops of oil to your palms and distribute through the beard from roots to ends.",
  "",
  "Volume: 30 ml",
].join("\n");

const kinds = (t: string) => descBlocks(t).map((b: { k: string }) => b.k).join(" ");

describe("one renderer: app.js carries src/lib/desc-format.mjs byte for byte", () => {
  it("the block between the desc-format markers is the same in both files", () => {
    const own = descFormatBlock(MOD);
    expect(own, "the module lost its markers").not.toBeNull();
    expect(descFormatBlock(APP), "app.js's copy differs — paste the module's block (tools/sync-desc-format.mjs)").toBe(own);
  });
  it("app.js draws the owner's text with it, and the request-time page too", () => {
    expect(APP).toMatch(/function descOvHtml\(t\) \{ return descHtml\(t\); \}/);
    expect(descriptionHtml(PRORASO_RU)).toBe(descHtml(PRORASO_RU));
  });
  it("…and the copy app.js runs gives the module's answer", () => {
    const block = descFormatBlock(APP)!;
    const run = new Function(block + "\nreturn { descHtml: descHtml, descPlain: descPlain };")() as { descHtml: (s: string) => string; descPlain: (s: string) => string };
    for (const t of [PRORASO_RU, PRORASO_ET, PRORASO_EN, "**<b>x</b>**\n- a\n- b"]) {
      expect(run.descHtml(t)).toBe(descHtml(t));
      expect(run.descPlain(t)).toBe(descPlain(t));
    }
  });
});

describe("headings", () => {
  it("a short line of its own ending in «:» is a bold heading, colon kept", () => {
    for (const h of ["Преимущества:", "Применение:", "Ключевые ингредиенты:", "Состав (INCI):", "Eelised:", "Benefits:", "How to use:"]) {
      expect(descHeading(h), h).toBe(h.slice(0, -1));
      expect(descHtml("Текст.\n\n" + h + "\nНанесите на волосы.")).toContain('<p class="desc-h"><strong>' + h.replace("&", "&amp;") + "</strong></p>");
    }
    // the same heading the writer also put in bold
    expect(descHeading("**Преимущества:**")).toBe("Преимущества");
    expect(descHeading("**Преимущества**:")).toBe("Преимущества");
  });
  it("«Объём: 30 мл» is not a heading — its label is drawn in bold instead", () => {
    expect(descHeading("Объём: 30 мл")).toBeNull();
    expect(descHtml("Объём: 30 мл")).toBe("<p><strong>Объём:</strong> 30 мл</p>");
    expect(descHtml("Аромат: свежий бергамот и лайм.")).toBe("<p><strong>Аромат:</strong> свежий бергамот и лайм.</p>");
    expect(descHtml("Состав (INCI): Aqua, Glycerin.")).toBe("<p><strong>Состав (INCI):</strong> Aqua, Glycerin.</p>");
  });
  it("…but only a real label: capital first, four words at most, no sentence punctuation in it", () => {
    expect(descHtml("подходит всем: и сухим, и жирным")).toBe("<p>подходит всем: и сухим, и жирным</p>");
    expect(descHtml("Масло для бороды Proraso из серии: смягчает")).toBe("<p>Масло для бороды Proraso из серии: смягчает</p>");
    expect(descHtml("Смотрите https://rempireshop.com")).toBe("<p>Смотрите https://rempireshop.com</p>");
    expect(descHtml("Время: 10:00")).toBe("<p><strong>Время:</strong> 10:00</p>");
  });
  it("not a heading: a long line, a sentence break inside, a second colon, more than eight words", () => {
    expect(descHeading("Этот шампунь подходит для ежедневного мытья любых типов волос и кожи головы:")).toBeNull();
    expect(descHeading("Мягко очищает. Подходит для:")).toBeNull();
    expect(descHeading("Время: утро:")).toBeNull();
    expect(descHeading("раз два три четыре пять шесть семь восемь девять:")).toBeNull();
    expect(descHeading("— пункт:")).toBeNull();
    expect(descHeading("100:")).toBeNull();
  });
});

describe("lists", () => {
  it("«— », «- », «– » and «•» start a point; consecutive points are one list", () => {
    expect(descHtml("Преимущества:\n- объём без утяжеления\n- лёгкий аромат"))
      .toBe('<p class="desc-h"><strong>Преимущества:</strong></p><ul><li>объём без утяжеления</li><li>лёгкий аромат</li></ul>');
    expect(descHtml("— один\n— два\n– три\n• четыре")).toBe("<ul><li>один</li><li>два</li><li>три</li><li>четыре</li></ul>");
    // a paragraph, then a list, then a paragraph again — inside one block
    expect(descHtml("Вступление.\n— один\n— два\nИтог.")).toBe("<p>Вступление.</p><ul><li>один</li><li>два</li></ul><p>Итог.</p>");
    // a dash glued to a number is not a point
    expect(descHtml("-10% на второй")).toBe("<p>-10% на второй</p>");
  });
  it("the implicit list: the plain lines right under a heading, when every one reads as a point", () => {
    // the heading ends its paragraph and the points are the next one (Proraso)
    expect(kinds(PRORASO_RU)).toBe("p p h ul h p p p p p");
    const ul = descBlocks(PRORASO_RU).find((b: { k: string }) => b.k === "ul") as { items: string[] };
    expect(ul.items).toHaveLength(9);
    expect(ul.items[0]).toBe("для длинной и густой бороды");
    // …and in the heading's own paragraph
    expect(descHtml("Преимущества:\nобъём без утяжеления\nлёгкий аромат"))
      .toBe('<p class="desc-h"><strong>Преимущества:</strong></p><ul><li>объём без утяжеления</li><li>лёгкий аромат</li></ul>');
  });
  it("…in Estonian and English too", () => {
    expect(kinds(PRORASO_ET)).toBe("p p h ul p p");
    expect(kinds(PRORASO_EN)).toBe("p p h ul p p");
    expect(descHtml(PRORASO_EN)).toContain("<li>free from parabens, phthalates, silicones, mineral oils, artificial colourants and SLS</li>");
  });
  it("not a list: sentences under the heading, a single line, or lines with no heading above them", () => {
    // «Ключевые ингредиенты:» is followed by two sentences — they stay lines of a paragraph
    expect(descHtml(PRORASO_RU)).toContain("<p>Масло подсолнечника и грецкий орех. Богаты омега-3 и омега-6, увлажняют и кондиционируют волосы бороды.<br>Масла авокадо");
    expect(kinds("Применение:\nНанесите на влажные волосы, вспеньте, смойте")).toBe("h p");
    expect(kinds("объём без утяжеления\nлёгкий аромат")).toBe("p");
    // one sentence among the points and none of them is a point
    expect(kinds("Преимущества:\nобъём\nподходит для ежедневного мытья.\nаромат")).toBe("h p");
    // a line past DESC_ITEM_MAX is prose
    expect(kinds("Преимущества:\nкоротко\n" + "очень длинная строка ".repeat(8))).toBe("h p");
  });
  it("the shop's Proraso text, drawn whole", () => {
    const html = descHtml(PRORASO_RU);
    expect(html.startsWith("<p>Proraso Azur Lime — масло для бороды</p>")).toBe(true);
    expect(html).toContain('<p class="desc-h"><strong>Преимущества:</strong></p><ul><li>для длинной и густой бороды</li>');
    expect(html).toContain('<p class="desc-h"><strong>Ключевые ингредиенты:</strong></p>');
    expect(html).toContain("<p><strong>Как использовать:</strong> нанесите несколько капель");
    expect(html).toContain("<p><strong>Объём:</strong> 30 мл</p>");
    expect(html).toContain("<p><strong>Состав (INCI):</strong> Helianthus Annuus (Sunflower) Seed Oil");
  });
  it("a text with none of the marks is drawn exactly as before: paragraphs and <br>", () => {
    const old = (t: string) => t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
      .map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("");
    const plain = "Мягкий шампунь для тонких волос.\n\nПодходит для окрашенных волос.\nНе утяжеляет.";
    expect(descHtml(plain)).toBe(old(plain));
  });
});

describe("bold and escaping", () => {
  it("**word** is bold inside a sentence; a lone ** or a spaced one is just characters", () => {
    expect(descHtml("Масло **каждый день** и вечером.")).toBe("<p>Масло <strong>каждый день</strong> и вечером.</p>");
    expect(descHtml("a ** b")).toBe("<p>a ** b</p>");
    expect(descHtml("** не жирно **")).toBe("<p>** не жирно **</p>");
  });
  it("nothing in the stored text is ever markup", () => {
    const html = descHtml("<script>alert(1)</script>\n\n**<img src=x onerror=alert(1)>**\n\n— <a href=\"javascript:x\">x</a>\n\nОбъём: <b>30</b>");
    expect(html).not.toMatch(/<(script|img|a|b)[\s>]/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<strong>&lt;img src=x onerror=alert(1)&gt;</strong>");
    expect(html).toContain("<li>&lt;a href=&quot;javascript:x&quot;&gt;x&lt;/a&gt;</li>");
    expect(html).toContain("<strong>Объём:</strong> &lt;b&gt;30&lt;/b&gt;");
    expect(descHtml("Heading «with» \"quotes\" & 'apostrophes':")).toBe(
      '<p class="desc-h"><strong>Heading «with» &quot;quotes&quot; &amp; &#39;apostrophes&#39;:</strong></p>');
  });
});

describe("descPlain — the text for every plain copy", () => {
  it("takes the ** out and leaves headings and points as the words they are", () => {
    expect(descPlain("**Преимущества:**\n— **объём** без утяжеления\nа ** б")).toBe("Преимущества:\n— объём без утяжеления\nа  б");
  });
  it("is the identity on a text without **, so no stored copy moves", () => {
    for (const t of [PRORASO_RU, PRORASO_ET, PRORASO_EN, "• пункт\n- пункт"]) expect(descPlain(t)).toBe(t);
  });
  it("the Merchant feed never carries the marks", () => {
    const id = "proraso-beard-oil-azur-lime-30ml";
    const own = "Масло для бороды **Proraso** с ароматом лайма.\n\n**Преимущества:**\n— смягчает";
    expect(feedIntro(own)).toBe("Масло для бороды Proraso с ароматом лайма.");
    const { xml } = buildFeed({
      lang: "RU", base: "https://rempireshop.com", overrides: {}, descriptions: { [id]: { RU: own } }, custom: [], eans: {},
      rules: DEFAULT_SHIPPING_RULES,
    });
    const item = xml.split("<item>").find((x) => x.includes(id))!;
    expect(item).toContain("Масло для бороды Proraso с ароматом лайма.");
    expect(item).not.toContain("**");
  });
  it("the shop's search reads the owner's text without its marks", () => {
    expect(APP).toMatch(/if \(ov\[L\]\) t\.push\(descPlain\(ov\[L\]\)\);/);
  });
});

/* ---------- the panel's format bar — pure functions of (text, selection) ---------- */

function lift(name: string): string {
  const start = APP.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = APP.indexOf("{", start); i < APP.length; i++) {
    if (APP[i] === "{") depth++;
    else if (APP[i] === "}" && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}()`);
}
type Fmt = (v: string, a: number, b: number) => { v: string; a: number; b: number; err?: string } | null;
const F = new Function(
  descFormatBlock(APP) + "\n" + lift("edFmtBold") + "\n" + lift("edFmtHead") + "\n" + lift("edFmtList") +
  "\nreturn { bold: edFmtBold, head: edFmtHead, list: edFmtList };",
)() as { bold: Fmt; head: Fmt; list: Fmt };
/** `|` marks the caret, `[…]` the selection. */
function at(s: string): [string, number, number] {
  if (s.includes("|")) { const i = s.indexOf("|"); return [s.replace("|", ""), i, i]; }
  const a = s.indexOf("["), b = s.indexOf("]") - 1;
  return [s.replace("[", "").replace("]", ""), a, b];
}
function show(r: { v: string; a: number; b: number } | null): string {
  if (!r) return "null";
  return r.a === r.b ? r.v.slice(0, r.a) + "|" + r.v.slice(r.a) : r.v.slice(0, r.a) + "[" + r.v.slice(r.a, r.b) + "]" + r.v.slice(r.b);
}
const run = (f: Fmt, s: string) => show(f(...at(s)));

describe("«Ж» — the selection in ** **", () => {
  it("wraps the selection and keeps it selected; pressed again, takes the marks off", () => {
    expect(run(F.bold, "Масло [каждый день] и вечером")).toBe("Масло **[каждый день]** и вечером");
    expect(run(F.bold, "Масло **[каждый день]** и вечером")).toBe("Масло [каждый день] и вечером");
    expect(run(F.bold, "Масло [**каждый день**] и")).toBe("Масло [каждый день] и");
  });
  it("leaves the spaces at the selection's ends outside the marks", () => {
    expect(run(F.bold, "Масло[ каждый ]день")).toBe("Масло **[каждый]** день");
  });
  it("with only a caret: the word under it, the caret after the marks", () => {
    expect(run(F.bold, "Масло кажд|ый день")).toBe("Масло **каждый**| день");
    expect(run(F.bold, "Масло **кажд|ый** день")).toBe("Масло каждый| день");
    expect(run(F.bold, "Масло | день")).toBe("Масло **|** день");
  });
  it("several lines: each line on its own, a point's «— » outside", () => {
    expect(run(F.bold, "[— один\n— два]")).toBe("[— **один**\n— **два**]");
  });
});

describe("«Заголовок» — the line under the caret becomes a heading", () => {
  it("a line of its own ending in «:», an empty line above it", () => {
    expect(run(F.head, "Шампунь для объёма.\nПреимуще|ства")).toBe("Шампунь для объёма.\n\nПреимущества:|");
    expect(run(F.head, "Преимущ|ества.")).toBe("Преимущества:|");
    expect(run(F.head, "Текст.\n\n— Применени|е")).toBe("Текст.\n\nПрименение:|");
  });
  it("a label line is cut at its colon — the rest goes on the next line", () => {
    expect(run(F.head, "Текст.\n\nПрименение: нанесите на влаж|ные волосы."))
      .toBe("Текст.\n\nПрименение:|\nнанесите на влажные волосы.");
  });
  it("a selection inside a line is the heading; the words before it stay a line above", () => {
    expect(run(F.head, "Шампунь. [Преимущества]: объём, аромат"))
      .toBe("Шампунь.\n\nПреимущества:|\nобъём, аромат");
  });
  it("pressed on a heading, it is a plain line again", () => {
    expect(run(F.head, "Текст.\n\nПреимущества:|\n— объём")).toBe("Текст.\n\nПреимущества|\n— объём");
  });
  it("refuses a sentence and an empty line, out loud", () => {
    expect(F.head(...at("Этот шампунь мягко очищает волосы и кожу головы и подходит для ежедневного мытья|"))!.err)
      .toMatch(/короткая строка/);
    expect(F.head(...at("Текст.\n|\nЕщё."))!.err).toMatch(/Поставьте курсор/);
  });
  it("the line it writes is one the page draws as a heading", () => {
    const r = F.head(...at("Текст.\nКлючевые ингредиен|ты"))!;
    expect(descHtml(r.v)).toContain('<p class="desc-h"><strong>Ключевые ингредиенты:</strong></p>');
  });
});

describe("«• Список» — «— » in front of every line the selection touches", () => {
  it("adds the marks, replaces «-» and «•», keeps empty lines; the block stays selected", () => {
    expect(run(F.list, "Преимущества:\n[объём\n- аромат\n• мягкость]")).toBe("Преимущества:\n[— объём\n— аромат\n— мягкость]");
  });
  it("takes them off when every line already has one", () => {
    expect(run(F.list, "[— объём\n— аромат]")).toBe("[объём\nаромат]");
  });
  it("with a caret: that line, the caret at its end; on an empty line, a fresh point", () => {
    expect(run(F.list, "Преимущества:\nоб|ъём\nаромат")).toBe("Преимущества:\n— объём|\nаромат");
    expect(run(F.list, "Преимущества:\n|")).toBe("Преимущества:\n— |");
  });
  it("what it writes is a list on the page", () => {
    const r = F.list(...at("Преимущества:\n[объём\nаромат.]"))!;
    expect(descHtml(r.v)).toBe('<p class="desc-h"><strong>Преимущества:</strong></p><ul><li>объём</li><li>аромат.</li></ul>');
  });
});

describe("the panel wiring", () => {
  it("the bar sits over the box, its buttons thumb-sized, the preview drawn with descHtml()", () => {
    expect(APP).toMatch(/edFmtBarHTML\(\) \+\r?\n\s+box\("ru"/);
    expect(APP).toMatch(/b\("bold", "Ж", " adm-fmtbar__bold"\) \+ b\("head", "Заголовок"\) \+ b\("list", "• Список"\)/);
    expect(APP).toMatch(/b\("preview", "Как в магазине", " adm-fmtbar__prev"\)/);
    expect(APP).toMatch(/function edDescPrevHTML\(text\) \{\s+return String\(text \|\| ""\)\.trim\(\) \? descHtml\(text\)/);
    const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.adm-fmtbar \.adm-btn \{[^}]*min-height: 44px; min-width: 44px;/);
  });
  it("mousedown on the bar is stopped — the textarea keeps its focus and selection", () => {
    expect(APP).toMatch(/if \(t && t\.closest && t\.closest\("\[data-edfmt\]"\)\) e\.preventDefault\(\);/);
  });
  it("«Написать черновик» writes a heading and «— » points, not «•»", () => {
    expect(APP).toMatch(/\(bHead \? bHead \+ ":\\n" : ""\) \+ bullets\.map\(function \(b\) \{ return "— " \+ txt\(b\); \}\)/);
    expect(APP).not.toMatch(/return "• " \+ txt\(b\)/);
  });
  it("«Перевести» asks for the description format, «Разбить на разделы» for the sections task", () => {
    expect(APP).toMatch(/keepNames: \[tp\.brand, tp\.name\], format: "desc" \}/);
    expect(APP).toMatch(/task: "sections", lang: sL, input: \{ text: sText \}/);
  });
});

/* ---------- the AI ---------- */

const SPLIT_IN = "Шампунь для тонких волос, которым не хватает объёма. Мягко очищает и делает волосы плотнее на ощупь. Преимущества: объём без утяжеления, подходит для ежедневного мытья и лёгкий свежий аромат. Применение: нанесите на влажные волосы, вспеньте, смойте.";

describe("«Разбить на разделы» — the words stay the owner's", () => {
  it("is a task of its own, with the format rule and one worked example in the prompt", () => {
    expect(isAiTask("sections")).toBe(true);
    const p = buildSectionsPrompt("RU", { text: SPLIT_IN });
    expect(p.system).toContain("WITHOUT changing a single fact or word");
    expect(p.system).toContain(DESC_FORMAT_EXAMPLE);
    expect(p.system).toContain('{"text": "..."}');
    expect(p.user).toContain(SPLIT_IN);
    expect(buildPrompt("sections", "ET", { text: "Šampoon." }).system).toContain("in Estonian");
    expect(() => buildSectionsPrompt("RU", { text: "  " })).toThrow();
  });
  it("accepts the worked example: the same words, laid out, under headings it could name", () => {
    expect(sectionsKeepWords(SPLIT_IN, DESC_FORMAT_EXAMPLE)).toMatchObject({ ok: true });
    // a heading of its own over an enumeration the text did not name
    expect(sectionsKeepWords("Шампунь для объёма. Без сульфатов, подходит для ежедневного мытья, лёгкий аромат.",
      "Шампунь для объёма.\n\nПреимущества:\n— без сульфатов\n— подходит для ежедневного мытья\n— лёгкий аромат")).toMatchObject({ ok: true });
    // the Proraso text, already laid out, back as it is
    expect(sectionsKeepWords(PRORASO_RU, PRORASO_RU)).toMatchObject({ ok: true, added: 0, dropped: 0 });
  });
  it("refuses new words, lost words, a lost «не» or number, a long invented heading, HTML and new bold", () => {
    const base = "Шампунь для объёма. Подходит для ежедневного мытья, не утяжеляет, 250 мл.";
    expect(sectionsKeepWords(base, "Шампунь для объёма и блеска с кератином и витаминами.\n\nПреимущества:\n— подходит для ежедневного мытья\n— не утяжеляет\n— 250 мл"))
      .toMatchObject({ ok: false, reason: "added" });
    expect(sectionsKeepWords(base, "Шампунь.\n\nПреимущества:\n— не утяжеляет\n— 250 мл")).toMatchObject({ ok: false, reason: "dropped" });
    expect(sectionsKeepWords(base, "Шампунь для объёма.\n\nПреимущества:\n— подходит для ежедневного мытья\n— утяжеляет\n— 250 мл"))
      .toMatchObject({ ok: false, reason: "fact" });
    expect(sectionsKeepWords(base, "Шампунь для объёма.\n\nПреимущества:\n— подходит для ежедневного мытья\n— не утяжеляет\n— 500 мл"))
      .toMatchObject({ ok: false });
    expect(sectionsKeepWords(base, "Шампунь для объёма.\n\nЛучший выбор для всех мужчин:\n— подходит для ежедневного мытья\n— не утяжеляет\n— 250 мл"))
      .toMatchObject({ ok: false, reason: "heading" });
    expect(sectionsKeepWords(base, "<p>" + base + "</p>")).toMatchObject({ ok: false, reason: "html" });
    expect(sectionsKeepWords(base, "**Шампунь** для объёма. Подходит для ежедневного мытья, не утяжеляет, 250 мл."))
      .toMatchObject({ ok: false, reason: "bold" });
    expect(sectionsKeepWords(base, "  ")).toMatchObject({ ok: false, reason: "empty" });
  });
});

describe("the writers write the format", () => {
  it("«Написать черновик»: a heading for the points, and one worked example in the asked language", () => {
    for (const [lang, head] of [["RU", "Преимущества"], ["ET", "Eelised"], ["EN", "Benefits"]] as const) {
      const p = buildDescribePrompt(lang, { name: "Beard Oil — масло для бороды", brand: "Proraso" });
      expect(p.system).toContain('"heading"');
      expect(p.system).toContain(`"heading": "${head}"`);
      expect(p.system).toMatch(/EXAMPLE of the shape only — another product, never copy its words or facts/);
      expect(p.system).toContain('{"description": "...", "heading": "...", "bullets": ["...", "...", "..."]}');
    }
  });
  it("«Перевести на ET и EN» of a description keeps its lines, headings, points and bold — with an example", () => {
    const text = "Шампунь.\n\nПреимущества:\n— объём\n— **лёгкий** аромат";
    const p = buildTranslatePrompt("RU", { text, sourceLang: "RU", targetLangs: ["ET", "EN"], format: "desc" });
    expect(p.system).toContain("THE SOURCE IS A PRODUCT DESCRIPTION");
    expect(p.system).toContain("Translate a heading's words and keep its «:»");
    expect(p.system).toContain("Eelised:\n— kohevus ilma raskuseta");
    expect(p.user).toContain(text);
    // every other text the translator carries (a banner, a letter) is told nothing of it
    expect(buildTranslatePrompt("RU", { text, sourceLang: "RU", targetLangs: ["ET"] }).system).not.toContain("PRODUCT DESCRIPTION");
  });
  it("descStructure counts what a translation must keep", () => {
    expect(descStructure("Шампунь.\n\nПреимущества:\n— объём\n— **лёгкий** аромат\n\nОбъём: 30 мл")).toEqual({ heads: 1, points: 2, bold: 1 });
    expect(descStructure("Šampoon.\n\nEelised:\n— kohevus\n— **kerge** lõhn\n\nMaht: 30 ml")).toEqual({ heads: 1, points: 2, bold: 1 });
    expect(descStructure("Šampoon. Eelised: kohevus, kerge lõhn.")).toEqual({ heads: 0, points: 0, bold: 0 });
  });
  it("«Помощник» and Claude are told the same format, with an example", () => {
    const route = readFileSync(fileURLToPath(new URL("../src/app/api/assistant/route.ts", import.meta.url)), "utf8");
    expect(route).toContain("a short line of its own ending in «:» is a section heading, shown in bold");
    expect(route).toContain("Преимущества:\\\\n— объём без утяжеления");
    expect(route).not.toContain("no markdown, no «**»");
    const mcp = readFileSync(fileURLToPath(new URL("../src/lib/mcp/tools.ts", import.meta.url)), "utf8");
    expect(mcp).toContain("Plain text in the shop's description format");
    expect(mcp).not.toContain("no HTML and no markdown (**, #, * lists)");
  });
});

describe("the wrong-language guard reads through the marks", () => {
  const who = { name: "Beard Oil Azur Lime — масло для бороды", brand: "Proraso" };
  it("an Estonian text laid out in the format, with no Russian in it, passes", () => {
    expect(seoOffLanguage("Proraso habemeõli.\n\n**Eelised:**\n— pehmendab habet\n- **kerge** lõhn\n\nMaht: 30 ml", "ET", who)).toBe(false);
  });
  it("…and one Russian word under a heading or inside the bold is still refused", () => {
    expect(seoOffLanguage("Proraso habemeõli.\n\nEelised:\n— смягчает habet", "ET", who)).toBe(true);
    expect(seoOffLanguage("Proraso beard oil.\n\nBenefits:\n— **мягкость**", "EN", who)).toBe(true);
  });
});
