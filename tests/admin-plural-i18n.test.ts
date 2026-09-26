/**
 * Every COUNTED string the shop and the panel compose, rendered for 1, 2, 5,
 * 11, 21 and 22 through the real dictionaries (UI, UI_RX in
 * public/shop2/app.js), in Estonian and in English.
 *
 * Russian takes three forms and pl() picks one; the dictionaries only see
 * the finished sentence. Estonian and English take two, and only a literal
 * «1» is singular — «21 товар» is «21 products», «21 toodet». The panel
 * still said «1 lines» under a salon sale, «1 products» over a search, «1
 * days overdue» on an invoice (staging, 26.09.2026) — one rule per sentence
 * had been written for «1 orders» and no more. And the other way round:
 * «21 slide», «· 21 day», «21 person waiting», because a rule keyed on the
 * Russian singular form took 21 for one.
 *
 * So, per sentence:
 *   - nothing Russian is left, whatever the count;
 *   - 5, 11, 21 and 22 read exactly like 2 with the number swapped — the
 *     plural, in both languages;
 *   - 1 carries no plural noun in English and no partitive in Estonian.
 *
 * The composers below are the call sites' own, written out; each names the
 * piece of app.js source it copies, and the test fails when that piece is
 * gone — a sentence that changed shape has to be looked at again here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}
type Lang = "ET" | "EN";
const UI = runInNewContext("(" + sliceLiteral("var UI = ", "\n  };") + ")") as Record<Lang, Record<string, string>>;
const UI_RX = runInNewContext("(" + sliceLiteral("var UI_RX = ", "\n  ];") + ")") as Array<[RegExp, Record<Lang, string>]>;

/** trText() of app.js: an own key first, then the first rule that matches, its captures looked up again. */
function tr(s: string, lang: Lang): string {
  const d = UI[lang];
  const own = (k: string) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : "");
  if (own(s)) return own(s);
  for (const [rx, to] of UI_RX) {
    const m = s.match(rx);
    if (m) return to[lang].replace(/\$(\d)/g, (_, n: string) => own(m[+n]) || m[+n] || "");
  }
  return s;
}

/** pl() of app.js. */
function pl<T>(n: number, one: T, few: T, many: T): T {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}
const goods = (n: number) => `${n} ${pl(n, "товар", "товара", "товаров")}`;
const points = (n: number) => `${n} ${pl(n, "точка", "точки", "точек")}`;
const days = (n: number) => `${n} ${pl(n, "день", "дня", "дней")}`;
const inDays = (n: number) => `${n} ${pl(n, "дня", "дня", "дней")}`;   // «в течение 1 дня»
const times = (n: number) => pl(n, "раз", "раза", "раз");

/** [what, the app.js source it copies, the sentence for a count] */
const SHAPES: Array<[string, string, (n: number) => string]> = [
  // ---- the shop and the panel's product counts ----
  ["a product count", 'function plural(n) { return pl(n, "товар", "товара", "товаров"); }', goods],
  ["«Показаны все …»", "'<p class=\"allshown\">Показаны все ' + tot + \" \" + plural(tot)", (n) => `Показаны все ${goods(n)}`],
  ["«Показать N товаров»", 'return "Показать " + n + " " + plural(n);', (n) => `Показать ${goods(n)}`],
  ["«Склад»: the count over a search", '" по запросу «"', (n) => `${goods(n)} по запросу «Reuzel»`],
  ["the assistant's low-stock lead", '"Заканчиваются " + low.length + " " + plural(low.length) + ". Срочно:"', (n) => `Заканчиваются ${goods(n)}. Срочно:`],
  ["…and the rest of that list", "…и ещё ' + (low.length - 3) + \" \" + plural(low.length - 3)", (n) => `…и ещё ${goods(n)}`],
  // ---- points, pickup points ----
  ["the loyalty balance", 'pl(S.loyalty.balance, "балл", "балла", "баллов")', (n) => `${n} ${pl(n, "балл", "балла", "баллов")}`],
  ["points granted", '(n > 0 ? "Начислено " : "Списано ") + k + " " + pl(k, "балл", "балла", "баллов")', (n) => `Начислено ${n} ${pl(n, "балл", "балла", "баллов")}`],
  ["points taken off", '(n > 0 ? "Начислено " : "Списано ") + k + " " + pl(k, "балл", "балла", "баллов")', (n) => `Списано ${n} ${pl(n, "балл", "балла", "баллов")}`],
  ["the loyalty floor", 'bits.push("от " + plo.minRedeem + " баллов")', (n) => `от ${n} баллов`],
  ["a pickup-point count", 'function points(n) { return n + " " + pl(n, "точка", "точки", "точек"); }', points],
  ["the account's default locker", 'head + " — " + points(', (n) => `Пакомат по умолчанию — ${points(n)}`],
  ["…or locker and counter", '"Пакомат или пункт выдачи по умолчанию" : "Пакомат по умолчанию"', (n) => `Пакомат или пункт выдачи по умолчанию — ${points(n)}`],
  // ---- «Обзор», «Ещё» ----
  ["an order count", 'function admOrdersLabel(n) { return n + " " + pl(n, "заказ", "заказа", "заказов"); }', (n) => `${n} ${pl(n, "заказ", "заказа", "заказов")}`],
  ["«Отправить N заказов»", 'return "Отправить " + admOrdersLabel(n);', (n) => `Отправить ${n} ${pl(n, "заказ", "заказа", "заказов")}`],
  ["partner requests", 'pl(a.proRequests, "заявка", "заявки", "заявок")', (n) => `${n} ${pl(n, "заявка", "заявки", "заявок")}`],
  ["reviews waiting", 'pl(a.reviewsPending, "отзыв", "отзыва", "отзывов")', (n) => `${n} ${pl(n, "отзыв", "отзыва", "отзывов")}`],
  ["articles", 'pl(b.published, "статья", "статьи", "статей")', (n) => `${n} ${pl(n, "статья", "статьи", "статей")}`],
  ["drafts", 'pl(b.drafts, "черновик", "черновика", "черновиков")', (n) => `${n} ${pl(n, "черновик", "черновика", "черновиков")}`],
  ["connections needing attention", 'pl(ig.problems, "требует внимания", "требуют внимания", "требуют внимания")', (n) => `${n} ${pl(n, "требует внимания", "требуют внимания", "требуют внимания")}`],
  // ---- «По счёту» ----
  ["an invoice overdue", '"Просрочен на " + n + " день."', (n) => `Просрочен на ${days(n)}.`],
  ["the method's hint", '"Счёт на почту, оплата в течение " + n + " дня"', (n) => `Счёт на почту, оплата в течение ${inDays(n)}`],
  ["the note under the company form", '"Счёт придёт на почту сразу после оформления. Оплата — переводом в течение " + n + " дня; заказ отправим после поступления денег."',
    (n) => `Счёт придёт на почту сразу после оформления. Оплата — переводом в течение ${inDays(n)}; заказ отправим после поступления денег.`],
  ["the receipt", '"Оплатите в течение " + n + " дня — после оплаты отправим заказ."', (n) => `Оплатите в течение ${inDays(n)} — после оплаты отправим заказ.`],
  ["the settings' journal line", '"Счета для компаний: префикс «" + prefix + "», срок оплаты " + days + " день"', (n) => `Счета для компаний: префикс «A-», срок оплаты ${days(n)}`],
  ["…its reminder", '"Счета для компаний: напоминание за " + remind + " дн. до срока"', (n) => `Счета для компаний: напоминание за ${n} дн. до срока`],
  ["…its cancellation", '"Счета для компаний: автоотмена через " + cancel + " дн. после срока"', (n) => `Счета для компаний: автоотмена через ${n} дн. после срока`],
  ["the fold's term", '"оплата " + c.dueDays + " дн."', (n) => `оплата ${n} дн.`],
  ["the fold's reminder", '"напомнить за " + c.remindBeforeDays + " дн."', (n) => `напомнить за ${n} дн.`],
  // ---- «Доставлен сам», letters, the journal ----
  ["«Доставлен сам»: the fold's piece", '"через " + d.autoDays + " " + pl(d.autoDays, "день", "дня", "дней")', (n) => `через ${days(n)}`],
  ["«Доставлен сам»: the journal line", '"через " + dv.autoDays + " " + pl(dv.autoDays, "день", "дня", "дней")', (n) => `Доставлен сам: спрашивать перевозчика · через ${days(n)}`],
  ["the birthday letter", '"Поздравление: " + (a.value ? "за " + a.value + " " + pl(a.value, "день", "дня", "дней") + " до дня рождения"', (n) => `Поздравление: за ${days(n)} до дня рождения`],
  ["the banner", '"Баннер: " + hsl.length + " " + pl(hsl.length, "слайд", "слайда", "слайдов") +', (n) => `Баннер: ${n} ${pl(n, "слайд", "слайда", "слайдов")}, первый — «Summer»`],
  ["letter texts", '"Тексты писем: " + mtn + " " + pl(mtn, "свой текст", "своих текста", "своих текстов")', (n) => `Тексты писем: ${n} ${pl(n, "свой текст", "своих текста", "своих текстов")}`],
  ["a gallery", 'gl + " " + pl(gl, "фотография", "фотографии", "фотографий")', (n) => `Фото «Reuzel Pomade»: ${n} ${pl(n, "фотография", "фотографии", "фотографий")}`],
  ["a product save's photo line", '"фото: " + gNew.length + " " + pl(gNew.length, "фотография", "фотографии", "фотографий")', (n) => `фото: ${n} ${pl(n, "фотография", "фотографии", "фотографий")}`],
  ["a promo code's limit", 'pr.maxUses + " " + pl(pr.maxUses, "использование", "использования", "использований")', (n) => `${n} ${pl(n, "использование", "использования", "использований")}`],
  ["unpaid orders", 'journalNote("Неоплаченные заказы: напоминание через " + remind + ", отмена через " + cancel);', (n) => `Неоплаченные заказы: напоминание через ${n}, отмена через 60`],
  ["abandoned carts", 'journalNote("Брошенные корзины: напоминание через " + hours + " ч, скидка " + percent + " % через " + days + " дн.");',
    (n) => `Брошенные корзины: напоминание через 3 ч, скидка 10 % через ${n} дн.`],
  // ---- «Рассылка» ----
  ["the send plan", 'return "· " + plainDays(Number(p.days));', (n) => `· ${days(n)}`],
  ["the send button", 'return n === 1 ? "Отправить 1 подписчику" : "Отправить " + n + " подписчикам";', (n) => (n === 1 ? "Отправить 1 подписчику" : `Отправить ${n} подписчикам`)],
  ["the send confirm", '"» уйдёт подписчикам: " + (aud.total || 0) +', (n) => `Письмо «Autumn» уйдёт подписчикам: ${n} — по-русски ${n}, по-эстонски 0, по-английски 0.`],
  // ---- «Склад», «Салон» ----
  ["a stock move in", '"Принято +" + n + " · теперь " + res.qtyAfter + " шт"', (n) => `Принято +7 · теперь ${n} шт`],
  ["a stock move out", '"Списано −" + n + " · теперь " + res.qtyAfter + " шт"', (n) => `Списано −7 · теперь ${n} шт`],
  ["the salon basket", '(n ? n + " шт" : "пусто")', (n) => `${n} шт`],
  ["a salon sale", 'return d.items + " поз. · " + POS_HOW[d.how] + " · остатки списаны";', (n) => `${n} поз. · наличные · остатки списаны`],
  ["a salon sale with a receipt by e-mail", 'if (d.mailed) return d.items + " поз. · " + POS_HOW[d.how] + " · остатки списаны · чек ушёл на почту";',
    (n) => `${n} поз. · терминал · остатки списаны · чек ушёл на почту`],
  // ---- the product card, «Аналитика» ----
  ["people waiting (letter on)", 'return k === 1 ? n + " человек ждёт — получит письмо"',
    (n) => pl(n, `${n} человек ждёт — получит письмо`, `${n} человека ждут — получат письмо`, `${n} человек ждут — получат письмо`)],
  ["people waiting (letter off)", 'return k === 1 ? n + " человек ждёт — но письмо «Товар снова в наличии» выключено"',
    (n) => pl(n, `${n} человек ждёт — но письмо «Товар снова в наличии» выключено`, `${n} человека ждут — но письмо «Товар снова в наличии» выключено`,
      `${n} человек ждут — но письмо «Товар снова в наличии» выключено`)],
  ["languages filled in", 'return n ? n + " из 3 языков"', (n) => `${n} из 3 языков`],
  ["Google, the shop", '"Google показал магазин " + v + " раз, в среднем на " + pos + "-м месте."', (n) => `Google показал магазин ${n} ${times(n)}, в среднем на 3-м месте.`],
  ["Google, a page", '"Google показал эту страницу " + v + " раз, в среднем на " + pos + "-м месте."', (n) => `Google показал эту страницу ${n} ${times(n)}, в среднем на 3-м месте.`],
  ["Google, the clicks", '"На ссылку нажали " + v + " раз."', (n) => `На ссылку нажали ${n} ${times(n)}.`],
];

const CYR = /[А-Яа-яЁё]/;
/* After a bare «1»: an English plural noun, or an Estonian partitive (the
   form after every other number). «1 päeva» is fine before «pärast» and
   «jooksul», which take the genitive — the same word. */
const EN_ONE_PLURAL = /(?<![\d.,])1 (?:more )?(?:products|orders|lines|days|points|locations|requests|reviews|articles|drafts|slides|photos|uses|subscribers|people|pcs|times|languages|need)\b/;
const ET_ONE_PARTITIVE = /(?<![\d.,])1 (?:toodet|tellimust|punkti|taotlust|arvustust|artiklit|mustandit|slaidi|fotot|oma teksti|kasutuskorda|keelt|inimest|korda)\b|(?<![\d.,])1 päeva(?! (?:pärast|jooksul))/;
/* «Näita 1 toodet» stays: «näita» takes the partitive whatever the count
   (the note on that rule in app.js). */
const ET_ONE_OK = new Set(["Näita 1 toodet"]);
/** The count swapped for another — a whole number only, not a digit of «12» or «2,50». */
const swap = (s: string, from: number, to: number) => s.replace(new RegExp(`(?<!\\d|\\d[.,])${from}(?!\\d|[.,]\\d)`, "g"), String(to));

describe("a counted sentence reads right in ET and EN, for 1 and for 21", () => {
  for (const [what, source, say] of SHAPES) {
    it(what, () => {
      expect(src, "app.js no longer composes this sentence this way — look at it again").toContain(source);
      const wrong: string[] = [];
      for (const lang of ["EN", "ET"] as const) {
        const two = tr(say(2), lang);
        for (const n of [1, 2, 5, 11, 21, 22]) {
          const ru = say(n);
          const out = tr(ru, lang);
          if (CYR.test(out)) wrong.push(`${lang} ${n}: Russian left — «${ru}» → «${out}»`);
          if (n === 1 && lang === "EN" && EN_ONE_PLURAL.test(out)) wrong.push(`EN 1: plural — «${out}»`);
          if (n === 1 && lang === "ET" && ET_ONE_PARTITIVE.test(out) && !ET_ONE_OK.has(out)) wrong.push(`ET 1: partitive — «${out}»`);
          if (n > 2 && out !== swap(two, 2, n)) wrong.push(`${lang} ${n}: «${out}», but 2 reads «${two}»`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});

describe("the ones the owner saw on staging", () => {
  it("«1 поз.» is one line, «1 товар по запросу» one product, «Просрочен на 1 день» one day", () => {
    expect(tr("1 поз. · наличные · остатки списаны", "EN")).toBe("1 line · cash · stock written off");
    expect(tr("1 товар по запросу «Reuzel»", "EN")).toBe("1 product for “Reuzel”");
    expect(tr("1 товар по запросу «Reuzel»", "ET")).toBe("1 toode otsingule „Reuzel“");
    expect(tr("Просрочен на 1 день.", "EN")).toBe("1 day overdue.");
    expect(tr("Просрочен на 1 день.", "ET")).toBe("Üle tähtaja 1 päev.");
  });
  it("…and 21 is not one", () => {
    expect(tr("21 человек ждёт — получит письмо", "EN")).toBe("21 people waiting — will get the letter");
    expect(tr("21 человек ждёт — получит письмо", "ET")).toBe("21 inimest ootab — saavad kirja");
    expect(tr("· 21 день", "EN")).toBe("· 21 days");
  });
});

/* ---- the count in a node of its own --------------------------------------
   «Обзор → Сделать сегодня» draws its rows as a big figure and, beside it,
   the words — two nodes. translateTree() reads the words alone, and pl()
   gives 21, 31, … Russian's «one» form, so an ET/EN panel said «21 order
   waiting to ship», «21 product running out». The rows are rendered here by
   app.js's own admTaskRow(), with the very argument each call site passes,
   and translated by app.js's own translateTree() over a small stand-in DOM. */

/** `<head> { … }` cut out of app.js by brace matching, `head` included. */
function block(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after «${head}» in app.js`);
}
const fnSrc = (name: string) => block(`function ${name}(`);
const varSrc = (name: string, open: "[" | "{") => {
  const start = src.indexOf(`var ${name} = ${open}`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = src.indexOf(open, start); i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return `${src.slice(start, i + 1)};`;
  }
  throw new Error(`unbalanced ${name}`);
};

/* The stand-in DOM: elements with attributes, text nodes, a tree walker —
   what translateTree() touches, nothing more. */
interface TNode { nodeValue: string; parentElement: TEl }
interface TEl {
  tagName: string; attrs: Record<string, string>; kids: Array<TEl | TNode>; parentElement: TEl | null;
  getAttribute(n: string): string | null; closest(sel: string): null; querySelectorAll(sel: string): TEl[];
}
const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' };
function parseHTML(html: string): TEl {
  const el = (tagName: string, attrs: Record<string, string>, parent: TEl | null): TEl => ({
    tagName, attrs, kids: [], parentElement: parent,
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    closest() { return null; },
    querySelectorAll() { return []; },
  });
  const root = el("DIV", {}, null);
  let cur = root;
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi)) {
    if (m[4] !== undefined) { cur.kids.push({ nodeValue: m[4].replace(/&(?:amp|lt|gt|quot);/g, (e) => ENT[e]), parentElement: cur }); continue; }
    if (m[1]) { cur = cur.parentElement ?? root; continue; }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2].replace(/&(?:amp|lt|gt|quot);/g, (e) => ENT[e]);
    const child = el(m[2].toUpperCase(), attrs, cur);
    cur.kids.push(child);
    if (!/^(br|img|path|input)$/i.test(m[2])) cur = child;
  }
  return root;
}
function textNodes(root: TEl): TNode[] {
  const out: TNode[] = [];
  const walk = (e: TEl) => { for (const k of e.kids) ("tagName" in k ? walk(k) : out.push(k)); };
  walk(root);
  return out;
}
function textOf(e: TEl): string {
  return e.kids.map((k) => ("tagName" in k ? textOf(k) : k.nodeValue)).join("");
}
function find(e: TEl, cls: string): TEl | null {
  if ((e.attrs.class || "").split(/\s+/).includes(cls)) return e;
  for (const k of e.kids) if ("tagName" in k) { const f = find(k, cls); if (f) return f; }
  return null;
}

// This repository's own source only.
const translateTree = new Function("S", "document", "NodeFilter", `
  ${varSrc("UI", "{")}
  ${varSrc("UI_RX", "[")}
  ${fnSrc("trName")}
  ${varSrc("TAIL_EXACT", "{")}
  ${varSrc("NAME_TAILS", "{")}
  ${varSrc("NAME_FRAGS", "[")}
  ${fnSrc("trText")}
  var NAME_CTX = ".never";
  var TR_ATTRS = ["placeholder", "aria-label", "title", "label"];
  ${fnSrc("translateTree")}
  return translateTree;
`);
function translated(html: string, lang: Lang): TEl {
  const root = parseHTML(html);
  const doc = { createTreeWalker: (r: TEl) => { const list = textNodes(r); let i = 0; return { nextNode: () => list[i++] ?? null }; } };
  translateTree({ lang }, doc, { SHOW_TEXT: 4 })(root);
  return root;
}

// This repository's own source only.
const admTaskRow = new Function(`
  ${fnSrc("pl")}
  ${fnSrc("esc")}
  ${fnSrc("admTaskRow")}
  return admTaskRow;
`)() as (n: number, label: unknown, detail: string, attrs: string, warn?: boolean) => string;

/* Every count row of «Сделать сегодня», as its call site writes it: the
   count's name and the label argument — whatever shape it has. */
const ROWS = [...src.matchAll(/admTaskRow\((\w+),\s*((?:pl\(\1, |\[)"[^"\n]+", "[^"\n]+", "[^"\n]+"(?:\)|\]))/g)].map((m) => ({ n: m[1], arg: m[2] }));

describe("«Сделать сегодня»: the figure and the words apart, and still one sentence in ET and EN", () => {
  it("finds every count row of «Обзор»", () => {
    expect(ROWS.map((r) => r.n)).toEqual(["shipN", "overN", "heldN", "lowN", "hidLow", "revN", "proN", "retN"]);
  });
  for (const row of ROWS) {
    it(row.n, () => {
      // the call site's own argument, cut out of this repository's app.js above
      const label = (n: number) => new Function("pl", row.n, `return ${row.arg};`)(
        (k: number, a: string, b: string, c: string) => { const x = k % 10, y = k % 100; return x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 10 || y >= 20) ? b : c; }, n);
      const wrong: string[] = [];
      for (const lang of ["EN", "ET"] as const) {
        const read = (n: number) => {
          const root = translated(admTaskRow(n, label(n), "Mart Tamm", 'data-admtab="orders"'), lang);
          return `${textOf(find(root, "adm-row__big")!)} ${textOf(find(root, "adm-todo__t")!)}`;
        };
        const two = read(2);
        for (const n of [1, 2, 5, 11, 21, 22, 31]) {
          const out = read(n);
          if (CYR.test(out)) wrong.push(`${lang} ${n}: Russian left — «${out}»`);
          if (n === 1 && out === swap(two, 2, 1)) wrong.push(`${lang} 1: «${out}» — the plural`);
          if (n > 2 && out !== swap(two, 2, n)) wrong.push(`${lang} ${n}: «${out}», but 2 reads «${two}»`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
  it("Russian keeps pl()'s own form — «21 заказ ждёт отправки»", () => {
    const html = admTaskRow(21, ["заказ ждёт отправки", "заказа ждут отправки", "заказов ждут отправки"], "", "");
    expect(textOf(find(parseHTML(html), "adm-todo__t")!)).toBe("заказ ждёт отправки");
    expect(textOf(find(parseHTML(admTaskRow(1, ["заказ ждёт отправки", "заказа ждут отправки", "заказов ждут отправки"], "", "")), "adm-todo__t")!))
      .toBe("заказ ждёт отправки");
  });
  it("a row with words and no count («Заполните IBAN») is drawn as before", () => {
    const html = admTaskRow("!" as unknown as number, "Заполните IBAN — счета не уходят", "", 'data-admtab="setup"');
    expect(html).toContain('<span class="adm-row__nm adm-todo__t">Заполните IBAN — счета не уходят</span>');
  });
});

/* «Ещё»: its status lines carry the figure inside each piece («21 заявка ·
   3 отзыва», painted a node per piece), so the rules above read the count
   with the words. Rendered by app.js's own admMoreLine() and admPiecesHTML(). */
describe("«Ещё»: the status lines under «Клиенты», «Блог» and «Подключения»", () => {
  const moreLine = new Function("OVERVIEW", `
    ${fnSrc("pl")}
    ${fnSrc("esc")}
    function eur(n) { return n + " €"; }
    ${varSrc("ADM_MORE", "[")}
    ${fnSrc("admPiecesHTML")}
    ${fnSrc("admMoreLine")}
    return function (key) { var l = admMoreLine(key); return l[2] ? admPiecesHTML(l[0]) : l[0]; };
  `) as (o: unknown) => (key: string) => string;
  for (const key of ["people", "blog", "apps"]) {
    it(key, () => {
      const wrong: string[] = [];
      for (const lang of ["EN", "ET"] as const) {
        const read = (n: number) => textOf(translated(moreLine({ data: {
          attention: { proRequests: n, reviewsPending: n },
          blog: { published: n, drafts: n },
          integrations: { problems: n },
        } })(key), lang));
        const two = read(2);
        for (const n of [1, 2, 5, 11, 21, 22]) {
          const out = read(n);
          if (CYR.test(out)) wrong.push(`${lang} ${n}: Russian left — «${out}»`);
          if (n === 1 && out === swap(two, 2, 1)) wrong.push(`${lang} 1: «${out}» — the plural`);
          if (n > 2 && out !== swap(two, 2, n)) wrong.push(`${lang} ${n}: «${out}», but 2 reads «${two}»`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});
