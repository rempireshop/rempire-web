/**
 * The panel's ASSEMBLED sentences, in the shape the browser paints them.
 *
 * A confirm card's detail and a journal line are not written, they are
 * composed: a label, then live values, joined with « · », with a newline
 * between the facts and what follows. translateTree() rewrites a text node
 * only when it recognises the WHOLE of it, so until 17.09.2026 a glued
 * sentence was a sentence the dictionary could not touch — «Цены и
 * лояльность: партнёры и баллы включены · скидка для салонов 20% · …» read
 * Russian under an English heading (Renat).
 *
 * public/shop2/app.js paints them in pieces now: admDetailHTML() gives each
 * LINE an element and each « · » fact inside it an element of its own, which
 * is what nodes() below reproduces. This file is the guard on that: every
 * piece the panel can compose has to be a whole key or a whole UI_RX rule, in
 * ET and in EN, with no Russian left in the answer.
 *
 * The fixtures are the real shapes, written out with sample values — an order
 * number, a Latin customer name, a sum — so that a piece that stays Russian is
 * OUR text and never the data. Add a shape here when you add a confirm card.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  if (end < 0) throw new Error(`${marker} has no terminator ${JSON.stringify(terminator)}`);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

type Lang = "ET" | "EN";
type Rule = [RegExp, Record<Lang, string>];
const UI = runInNewContext("(" + sliceLiteral("var UI = ", "\n  };") + ")") as Record<Lang, Record<string, string>>;
const UI_RX = runInNewContext("(" + sliceLiteral("var UI_RX = ", "\n  ];") + ")") as Array<Rule | undefined>;

const CYR = /[А-Яа-яЁё]/;

/** trText() from app.js, without the product-name branch these never take. */
function trText(s: string, lang: Lang): string {
  const d = UI[lang];
  if (d[s]) return d[s];
  for (const e of UI_RX) {
    if (!e) continue;
    const m = s.match(e[0]);
    if (m) return e[1][lang].replace(/\$(\d)/g, (_, n: string) => d[m[+n]] ?? m[+n] ?? "");
  }
  return s;
}

/** The text nodes admDetailHTML()/admPiecesHTML() put in the DOM. */
function nodes(text: string): string[] {
  return text.split("\n").flatMap((line) => line.split(" · ")).map((p) => p.trim()).filter(Boolean);
}

/* A volume label is the owner's own typing — «100 мл» is what he put in the
   goods form and what the catalogue file carries — so it travels with the
   price as data, exactly like an order number or a customer's name. It is
   Cyrillic all the same, so it is named here rather than silently skipped. */
const OWNER_DATA = /^\d[\d,.]*\s*мл(\s*×\s*\d+)?(\s+—\s+.+)?$/;

/* ------------------------------------------------------------------------ *
 * The shapes. Data holes carry Latin samples on purpose (see the header).   *
 * ------------------------------------------------------------------------ */
const ORDER = "R-100042 · Mart Tamm";

const CONFIRM_CARDS: Array<[string, string]> = [
  // ---- «Заказы»: the order card's own six ----
  ["«Отправлен», with a tracking number",
    `${ORDER}\nDPD, Tallinn\nКлиенту уйдёт письмо «Заказ отправлен» с трек-номером TRK123456.`],
  ["«Отправлен», without one",
    `${ORDER}\nDPD, Tallinn\nКлиенту уйдёт письмо «Заказ отправлен» — без трек-номера.`],
  ["«Отменить заказ», paid",
    `${ORDER}\nЗаказ получит статус «отменён», товары вернутся на склад, клиенту уйдёт письмо «Заказ отменён». Деньги отмена не возвращает — для этого есть кнопка «Вернуть деньги».`],
  ["«Отменить заказ», unpaid",
    `${ORDER}\nЗаказ ещё не оплачен — возвращать нечего. Клиенту уйдёт письмо «Заказ отменён».`],
  ["«Оформить возврат» by hand",
    `${ORDER}\nЗаказ получит статус «возврат», товары вернутся на склад, клиенту уйдёт письмо «Деньги возвращены». Сами деньги отсюда не уходят — для этого есть кнопка «Вернуть деньги».`],
  ["«Отметить оплаченным», money already in",
    `${ORDER}\nСтатус вернётся на «оплачен». Деньги не трогаем — они уже учтены; товары, которые вернула отмена, снова спишутся со склада.`],
  ["«Отметить оплаченным», money arriving now",
    `${ORDER}\nТак же, как при обычной оплате: товары спишутся со склада, клиенту уйдёт письмо «Заказ принят». Отмечайте, только если деньги действительно пришли.`],
  ["«Написать клиенту»", "R-100042 · mart@example.com\nПисьмо уйдёт сразу, отозвать его нельзя."],
  ["«Деньги по счёту пришли»",
    `${ORDER}\nДеньги по счёту №2026-014 пришли на счёт? Заказ станет оплаченным, клиенту уйдёт письмо «Заказ принят».`],
  // ---- «Вернуть деньги», all four splits ----
  ["refund, first one",
    `${ORDER}\nВернём 34,90 € через Montonio — тем же путём, каким деньги пришли. Клиенту уйдёт письмо, товары вернутся на склад, заказ станет «возврат». Можно вернуть часть — измените сумму.`],
  ["refund, second one",
    `${ORDER}\nПо заказу уже возвращено 10 €. Осталось 24,90 € — деньги уйдут через Montonio тем же путём, каким пришли, и клиент получит письмо.`],
  ["refund split with a gift card, money left over",
    `${ORDER}\nВернём на подарочную карту: 10 € · на счёт покупателя: 24,90 €\nСначала возвращается часть, оплаченная картой, остаток уйдёт через Montonio тем же путём, каким деньги пришли. Клиенту уйдёт письмо.`],
  ["refund split with a gift card, card only",
    `${ORDER}\nВернём на подарочную карту: 34,90 € · на счёт покупателя: 0 €\nКартой снова можно будет платить. Клиенту уйдёт письмо.`],
  // ---- «Клиенты»: the partner switches ----
  ["partner on", "Партнёр · mart@example.com\nВключим цены для салонов и отправим письмо «Цены для салонов включены»."],
  ["partner off", "Розница · mart@example.com\nЦены для салонов выключатся со следующего заказа. Письмо не отправляется."],
  ["partner approved", "Уже партнёр · mart@example.com\nВключим цены для салонов и отправим письмо на эту почту."],
  ["partner rejected", "Партнёр · mart@example.com\nЗаявка закроется, цены для салонов не включатся. Письмо не отправляется."],
  // ---- «Настройки» ----
  ["«Цены и баллы», everything moved at once",
    "Цены и лояльность · партнёры и баллы включены · скидка для салонов 20% · от 0 € · баллы включены · начисление 5% · списание до 30% · от 5 баллов\nНовые условия начнут действовать сразу — для всех покупателей и партнёров."],
  ["«Цены и баллы», one number and the switches off",
    "Цены и лояльность · партнёры и баллы выключены · баллы выключены · начисление 7,5%\nНовые условия начнут действовать сразу — для всех покупателей и партнёров."],
  ["«Цены и баллы», nothing moved",
    "Цены и лояльность · без изменений\nНовые условия начнут действовать сразу — для всех покупателей и партнёров."],
  ["«Главная страница», the banner",
    "Слайдов на сайте: 3.\nПокупатели увидят изменение сразу. Вернуть прежний баннер можно из журнала изменений."],
  ["«О компании», one field",
    "Контент · телефон → +372 5555 1234\nИзменится везде: в подвале магазина, на «Контактах», в правовых текстах и в письмах."],
  ["«О компании», several blocks",
    "Контент · часы работы · соцсети · реквизиты\nИзменится везде: в подвале магазина, на «Контактах», в правовых текстах и в письмах."],
  // ---- «Товары» ----
  ["«Снять с продажи»",
    "Davines — OI Shampoo\nТовар исчезнет из магазина — из каталога, поиска и корзины. Вернуть можно здесь же, в «Товарах», или из журнала."],
  ["«Нет в наличии»",
    "Davines — OI Shampoo\nВ магазине останется страница товара, но купить его будет нельзя. Вернуть можно здесь же — «Наличие»."],
  ["a new product",
    "Новый товар «Proraso — Beard Balm» · Уход за бородой · 100 мл — 14,90 € · описание: RU, ET, EN\nФото добавите на вкладке «Фото и видео» — она откроется сама."],
  ["a product save, field by field",
    "Товар «Proraso — Beard Balm»\nбренд: «Proraso» → «Proraso Classic»\nцена: 14,90 € → 9,90 €\nописание: RU, ET, EN\nфото: 3 фотографии\nтексты для Google: свои"],
  // ---- «Наборы», the blog and the assistant's photo cards ----
  ["«Удалить набор»",
    "Удалить набор «Beard kit» · 39 €\nСтраница набора перестанет открываться, вернуть его будет нельзя. Уже оформленные заказы не изменятся."],
  ["the assistant's main photo",
    "Главное фото «Proraso Beard Balm»\nФото появится на странице товара, в каталоге, в поиске и в письмах. Отменить можно в журнале."],
  ["the assistant's extra photo",
    "Ещё одно фото «Proraso Beard Balm»\nФото появится на странице товара. Отменить можно в журнале."],
  ["an article cover", "Обложка статьи «Beard care in winter»\nОтменить можно в журнале."],
  ["a photo inside an article",
    "Фото в статью «beard-care-winter»\nВстанет в конец текста, на всех языках статьи. Передвинуть или убрать — в редакторе блога."],
  ["a whole article",
    "Новая статья целиком на тему «Beard care in winter»\nЗаголовок, анонс, текст, теги, товары и текст для Google — по-русски, потом на эстонском и английском. Откроется в редакторе блога черновиком: прочитаете и опубликуете."],
  // ---- «Салон»: the till's receipt ----
  ["the salon receipt", "Kevin.Murphy Fresh.Hair · 250 мл × 2 — 28,84 €\n\nИтого 28,84 € · наличные"],
];

/* Journal lines — the same composer, stored in Russian and translated on the
   way to the screen (admSetJournalHTML → jrowTextHTML). */
const JOURNAL_LINES: Array<[string, string]> = [
  ["a price", "Цена «Davines OI Shampoo»: 14,90 € → 9,90 €"],
  ["stock", "Наличие «OI Shampoo»: в наличии → нет"],
  ["pricing", "Цены и лояльность · скидка для салонов 25% · баллы включены · начисление 5%"],
  ["pricing, untouched", "Цены и лояльность · без изменений"],
  ["points", "Баллы клиента: +50"],
  ["a partner", "Партнёр: mart@example.com"],
  ["content", "Контент · верхняя полоска: выключить"],
  ["a promo code", "Промокод SUMMER: скидка 15% · от 40 € · 100 использований"],
  ["the gift-card faces", "Номиналы подарочной карты: 25 · 50 · 100 €"],
  ["a review", "Отзыв Mart Tamm: опубликован"],
];

describe("every sentence the panel assembles reaches the screen translatable", () => {
  for (const [what, text] of [...CONFIRM_CARDS, ...JOURNAL_LINES]) {
    it(what, () => {
      const left: string[] = [];
      for (const node of nodes(text)) {
        if (!CYR.test(node)) continue; // pure data — an id, a name, a sum
        if (OWNER_DATA.test(node)) continue;
        for (const lang of ["ET", "EN"] as const) {
          const out = trText(node, lang);
          if (out === node || CYR.test(out)) left.push(`${lang}: «${node}» → «${out}»`);
        }
      }
      expect(left, "these pieces stay Russian on an ET/EN panel").toEqual([]);
    });
  }
});

describe("the pieces are what app.js actually paints", () => {
  it("admPiecesHTML splits on « · » and admDetailHTML on the newline", () => {
    // the guard on the guard: nodes() above has to stay the paint's own shape
    expect(src).toContain('String(line == null ? "" : line).split(" · ")');
    expect(src).toContain('String(text == null ? "" : text).split("\\n").map(admPiecesHTML)');
  });
  it("both confirm cards and both journals go through it", () => {
    expect(src).toContain('\'<div class="adm-confirm__d">\' + admDetailHTML(');
    expect(src).toContain('\'<div class="adm-propose__d">\' + admDetailHTML(');
    expect(src).toContain('\'<span class="adm-jrow__l">\' + admPiecesHTML(line)');
    expect(src).toContain("if (typeof p.line === \"string\" && p.line) return admPiecesHTML(p.line);");
  });
});
