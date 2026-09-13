/**
 * «Чек о продаже в салоне» — the receipt for a sale rung up at the till.
 *
 * Renat, 13.09.2026: «The receipt should also land in the users e-mail.» The
 * register screen offered a printable slip and an e-mail box side by side, and
 * the letter that actually went out was «Заказ принят» — which promises to
 * write again when the order is ready and tells the customer how to collect
 * it. Both are wrong about a sale where the goods left with the person: what
 * they want in their inbox is what the printer would have handed them.
 *
 * So this is the printable slip as a letter: what was bought, the discount the
 * cashier typed, the total, and how it was paid. Same shell, same footer and
 * the same owner-editable subject / intro / signature as every other letter
 * (./texts.ts, «Письма» in the admin).
 *
 * Design source: src/app/api/admin/pos-orders/[id]/receipt/route.ts — the
 * paper version, which stays exactly as it was.
 */

import { customerName, greeting, itemsBlock, orderNumber, totalsOf } from "./common";
import {
  BRAND,
  COMMON,
  esc,
  money,
  normalizeLang,
  rowLabel,
  rowLead,
  rowLines,
  rowNote,
  rowPanel,
  rowTitle,
  shell,
  textBody,
  textFooter,
  type LineRow,
} from "./layout";
import { mailText, mailTextHtml, type MailTextValues } from "./texts";
import type { Lang, OrderLike, RenderedEmail } from "./types";

/** How the money came in at the till. Anything else is printed as it stands. */
export interface PosReceiptOptions {
  method?: string | null;
}

interface Strings {
  preheader: string;
  title: string;
  items: string;
  discount: string;
  paid: string;
  /** The line under «Оплачено» — why there is nothing left to wait for. */
  done: string;
  textIntro: string;
  cash: string;
  terminal: string;
}

const T: Record<Lang, Strings> = {
  ru: {
    preheader: "Ваш чек за покупку в салоне Rempire.",
    title: "Чек",
    items: "Что вы купили",
    discount: "Скидка",
    paid: "Оплачено",
    done: "Покупка завершена в салоне — товары уже у вас. Этот чек можно сохранить или распечатать.",
    textIntro: "Состав покупки:",
    cash: "наличными",
    terminal: "картой на терминале",
  },
  et: {
    preheader: "Teie kviitung Rempire salongis tehtud ostu eest.",
    title: "Kviitung",
    items: "Mida ostsite",
    discount: "Allahindlus",
    paid: "Makstud",
    done: "Ost on salongis lõpetatud — kaup on juba teie käes. Selle kviitungi võib alles hoida või välja printida.",
    textIntro: "Ostu sisu:",
    cash: "sularahas",
    terminal: "kaardiga terminalis",
  },
  en: {
    preheader: "Your receipt for the purchase at the Rempire salon.",
    title: "Receipt",
    items: "What you bought",
    discount: "Discount",
    paid: "Paid",
    done: "The purchase is complete at the salon — the goods are already with you. Keep this receipt or print it.",
    textIntro: "What you bought:",
    cash: "in cash",
    terminal: "by card at the terminal",
  },
};

function methodWord(t: Strings, method: string | null | undefined): string {
  if (method === "cash") return t.cash;
  if (method === "terminal") return t.terminal;
  return String(method ?? "").trim();
}

export function renderPosReceipt(
  order: OrderLike,
  lang: Lang | string = "ru",
  options: PosReceiptOptions = {},
): RenderedEmail {
  const L = normalizeLang(lang);
  const t = T[L];
  const c = COMMON[L];

  const number = orderNumber(order);
  const name = customerName(order);
  const hello = greeting(L, name);
  const items = itemsBlock(order.items, L);
  const totals = totalsOf(order, items.sum);

  const values: MailTextValues = {
    name,
    order: number,
    total: money(totals.total),
    shop: BRAND.name,
  };
  const intro = mailText("pos-receipt", L, "intro", values);
  const signature = mailText("pos-receipt", L, "signature", values);

  /* No delivery row: nothing was shipped, so the shipping line every order
     letter prints would be an answer to a question nobody asked (the same
     reasoning the admin order card follows for an electronic order). */
  const rows: LineRow[] = [];
  const textRows: string[] = [];
  if (totals.discount > 0) {
    rows.push({ label: esc(t.discount), value: "−" + money(totals.discount, true), muted: true, last: true });
    textRows.push(`  ${t.discount} — −${money(totals.discount)}`);
  }
  rows.push({ label: esc(c.total), value: money(totals.total, true), total: true });
  textRows.push(`  ${c.total}: ${money(totals.total)}`);

  const word = methodWord(t, options.method);
  const paidLine = word ? `${money(totals.total)} · ${word}` : money(totals.total);
  const paidHtml = word ? `${money(totals.total, true)} · ${esc(word)}` : money(totals.total, true);

  const body =
    rowTitle(t.title) +
    rowLead(`${esc(hello)} ${mailTextHtml("pos-receipt", L, "intro", values)}`) +
    rowLabel(t.items) +
    rowLines([...items.lines, ...rows]) +
    rowPanel(t.paid, paidHtml, esc(t.done)) +
    rowNote([mailTextHtml("pos-receipt", L, "signature", values)]);

  const html = shell({
    lang: L,
    title: `${t.title} ${number} — Rempire`,
    preheader: t.preheader,
    body,
    footerNote: esc(c.serviceNote),
  });

  const text = textBody([
    t.title.toUpperCase(),
    "",
    `${hello} ${intro}`,
    "",
    t.textIntro,
    ...items.text,
    ...textRows,
    "",
    `${t.paid}: ${paidLine}`,
    t.done,
    "",
    signature,
    textFooter(L, c.serviceNote),
  ]);

  return { subject: mailText("pos-receipt", L, "subject", values), html, text };
}
