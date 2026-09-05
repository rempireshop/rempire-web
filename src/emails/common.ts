/**
 * Pieces every order-shaped letter needs: the customer's name, the item
 * table, and the one-line description of how the parcel reaches them.
 *
 * All of it is defensive. A guest checkout has no name, an old row may have
 * no variant, and `pg` hands numerics back as strings — none of that may end
 * up as the word "undefined" in a letter to a customer.
 */

import {
  BRAND,
  brandAddress,
  COMMON,
  esc,
  money,
  num,
  pick,
  type LineRow,
} from "./layout";
import type { Lang, OrderItem, OrderLike, OrderShipping } from "./types";

/* ---------- customer --------------------------------------------------- */

/** Name for the greeting, or "" when we only know an e-mail address. */
export function customerName(
  src:
    | { customer_name?: string | null; name?: string | null; shipping?: OrderShipping | null }
    | null
    | undefined,
): string {
  const direct = pick(src?.customer_name, src?.name, src?.shipping?.name);
  // "ivan@mail.ee" as a name reads worse than no name at all.
  if (!direct || direct.includes("@")) return "";
  return direct.split(/\s+/).slice(0, 2).join(" ");
}

export function greeting(lang: Lang, name: string): string {
  return name ? COMMON[lang].helloNamed(name) : COMMON[lang].hello;
}

/* ---------- items ------------------------------------------------------ */

export interface ItemsBlock {
  lines: LineRow[];
  text: string[];
  sum: number;
  count: number;
}

const NOT_SPECIFIED: Record<Lang, string> = {
  ru: "Товар",
  et: "Toode",
  en: "Item",
};

/**
 * orders.ts stores brand and title in separate columns ("Kevin.Murphy" +
 * "Fresh.Hair"); the shop always shows them together, and so does every
 * letter and every Telegram ping.
 */
export function itemTitle(it: OrderItem, lang: Lang = "ru"): string {
  const raw = pick(it.title, it.name, NOT_SPECIFIED[lang]);
  const brand = pick(it.brand);
  return brand && !raw.toLowerCase().startsWith(brand.toLowerCase())
    ? `${brand} ${raw}`
    : raw;
}

/** Line total: the stored `sum` when checkout wrote one, else qty × price. */
export function lineTotal(it: OrderItem): number {
  const stored = num(it.sum, NaN);
  if (Number.isFinite(stored)) return stored;
  return num(it.price) * Math.max(1, Math.round(num(it.qty, 1)));
}

function itemLabel(it: OrderItem, lang: Lang): string {
  const title = itemTitle(it, lang);
  const variant = pick(it.variant);
  const qty = Math.max(1, Math.round(num(it.qty, 1)));
  const head = variant ? `${title} · ${variant}` : title;
  const unit = COMMON[lang].qty[qty === 1 ? 0 : 1];
  return `${head} · ${qty} ${unit}`;
}

/**
 * Item rows plus their plain-text twin. Returns the summed line value too,
 * so a letter can fall back to it when the order carries no stored total.
 */
export function itemsBlock(
  items: OrderItem[] | null | undefined,
  lang: Lang,
): ItemsBlock {
  const list = Array.isArray(items) ? items : [];
  const lines: LineRow[] = [];
  const text: string[] = [];
  let sum = 0;
  let count = 0;

  for (const it of list) {
    const qty = Math.max(1, Math.round(num(it.qty, 1)));
    const value = lineTotal(it);
    sum += value;
    count += qty;
    const label = itemLabel(it, lang);
    lines.push({
      // the dots and the "2 шт" tail must not wrap on their own: the unit
      // alone on the next line reads like a lost word at 360 px
      label: esc(label).replace(/ · /g, "&nbsp;·&nbsp;").replace(/ (\S+)$/, "&nbsp;$1"),
      value: money(value, true),
    });
    text.push(`  ${label} — ${money(value)}`);
  }

  return { lines, text, sum, count };
}

/* ---------- delivery --------------------------------------------------- */

const SHIP_WORDS: Record<
  Lang,
  {
    pickup: string;
    locker: (carrier: string) => string;
    courier: (carrier: string) => string;
    post: string;
    generic: string;
  }
> = {
  ru: {
    pickup: "Самовывоз",
    locker: (c) => (c ? `Пакомат ${c}` : "Пакомат"),
    courier: (c) => (c ? `Курьер ${c}` : "Курьер"),
    post: "Почта",
    generic: "Доставка",
  },
  et: {
    pickup: "Järeletulek",
    locker: (c) => (c ? `Pakiautomaat ${c}` : "Pakiautomaat"),
    courier: (c) => (c ? `Kuller ${c}` : "Kuller"),
    post: "Post",
    generic: "Tarne",
  },
  en: {
    pickup: "Pickup",
    locker: (c) => (c ? `${c} parcel locker` : "Parcel locker"),
    courier: (c) => (c ? `Courier ${c}` : "Courier"),
    post: "Post",
    generic: "Delivery",
  },
};

/**
 * Where a pickup order is collected. Not a per-language constant any more:
 * the address is the shop's own, the owner edits it in Настройки → Контент,
 * and `setBrandOverride()` puts it here — three hard-coded copies of "Mardi 1"
 * were three places to forget on the day the salon moves. It is written the
 * same way in all three letters, because a street address is not translated.
 */
function pickupPlace(): string {
  return [BRAND.name, brandAddress()].filter(Boolean).join(", ");
}

export type ShipKind = "pickup" | "locker" | "courier" | "other";

/**
 * The shipping module stores carriers lowercase ("omniva", "dpd"). Customers
 * see the brand spelling, not the slug.
 */
const CARRIER_NAMES: Array<[RegExp, string]> = [
  [/^omniva/i, "Omniva"],
  [/^dpd/i, "DPD"],
  [/^smart ?post/i, "SmartPosti"],
  [/^itella/i, "Itella"],
  [/^venipak/i, "Venipak"],
  [/^post/i, "Post"],
];

/**
 * orders.ts stores the courier address as a jsonb object whose keys the
 * checkout agent owns. Flatten it in postal order, ignoring anything that is
 * not a plain string so a nested object can never print as "[object Object]".
 */
const ADDRESS_KEYS = [
  "street",
  "line1",
  "line2",
  "address",
  "addr",
  "house",
  "apartment",
  "flat",
  "zip",
  "postcode",
  "postalCode",
  "city",
  "region",
  "country",
];

export function addressLine(
  address: string | Record<string, unknown> | null | undefined,
): string {
  if (typeof address === "string") return pick(address);
  if (!address || typeof address !== "object") return "";
  const seen = new Set<string>();
  const parts: string[] = [];
  const push = (v: unknown) => {
    const s = pick(typeof v === "number" ? String(v) : (v as string));
    if (s && !seen.has(s)) {
      seen.add(s);
      parts.push(s);
    }
  };
  for (const k of ADDRESS_KEYS) if (k in address) push(address[k]);
  for (const [k, v] of Object.entries(address)) {
    if (ADDRESS_KEYS.includes(k)) continue;
    if (typeof v === "string" || typeof v === "number") push(v);
  }
  return parts.join(", ");
}

export function carrierName(raw: string | null | undefined): string {
  const v = pick(raw);
  if (!v) return "";
  for (const [rx, name] of CARRIER_NAMES) if (rx.test(v)) return name;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function shipKind(shipping: OrderShipping | null | undefined): ShipKind {
  const m = pick(shipping?.method).toLowerCase();
  if (!m) return pick(shipping?.point, shipping?.pointName) ? "locker" : "other";
  if (/pickup|самовыв|järele|jarele|shop|store|salon/.test(m)) return "pickup";
  if (/locker|parcel|pakiautomaat|пакомат|omniva|smartpost|itella|dpd_?p/.test(m))
    return "locker";
  if (/courier|kuller|курьер|home|dpd|door/.test(m)) return "courier";
  return "other";
}

/**
 * "Пакомат Omniva — Kristiine keskus, Таллинн" and friends. One line,
 * never empty, never containing a stray dash from a missing field.
 */
export function deliveryLine(
  shipping: OrderShipping | null | undefined,
  lang: Lang,
): string {
  const w = SHIP_WORDS[lang];
  const carrier = carrierName(shipping?.carrier);
  const kind = shipKind(shipping);

  const head =
    kind === "pickup"
      ? w.pickup
      : kind === "locker"
        ? w.locker(carrier)
        : kind === "courier"
          ? w.courier(carrier)
          : pick(shipping?.method, carrier, w.generic);

  const tail =
    kind === "pickup"
      ? pickupPlace()
      : [
          pick(shipping?.point, shipping?.pointName),
          addressLine(shipping?.address),
          pick(shipping?.zip),
          pick(shipping?.city),
        ]
          .filter(Boolean)
          .join(", ");

  return tail ? `${head} — ${tail}` : head;
}

/* ---------- totals ----------------------------------------------------- */

export interface Totals {
  itemsSum: number;
  shipping: number;
  discount: number;
  total: number;
}

/** Stored totals win; anything missing is derived from the lines. */
export function totalsOf(order: OrderLike, itemsSum: number): Totals {
  const shipping = num(
    order.shipping_price ??
      order.shippingPrice ??
      order.shipping_total ??
      order.shipping?.price,
    0,
  );
  const discount = Math.abs(num(order.discount, 0));
  const stored = num(order.total, NaN);
  const total = Number.isFinite(stored)
    ? stored
    : Math.max(0, itemsSum + shipping - discount);
  return { itemsSum, shipping, discount, total };
}

const DISCOUNT_WORD: Record<Lang, string> = {
  ru: "Скидка",
  et: "Allahindlus",
  en: "Discount",
};

/** Shipping + discount rows and the bold totals row, HTML and text at once. */
export function totalRows(
  t: Totals,
  shipLabel: string,
  lang: Lang,
): { lines: LineRow[]; text: string[] } {
  const lines: LineRow[] = [];
  const text: string[] = [];

  if (t.discount > 0) {
    lines.push({
      label: esc(DISCOUNT_WORD[lang]),
      value: "−" + money(t.discount, true),
      muted: true,
    });
    text.push(`  ${DISCOUNT_WORD[lang]} — −${money(t.discount)}`);
  }

  const shipValue =
    t.shipping > 0 ? money(t.shipping, true) : esc(COMMON[lang].free);
  lines.push({
    label: esc(`${COMMON[lang].shipping} — ${shipLabel}`).replace(
      / — /g,
      "&nbsp;— ",
    ),
    value: shipValue,
    muted: true,
    last: true,
  });
  text.push(
    `  ${COMMON[lang].shipping} — ${shipLabel}: ${t.shipping > 0 ? money(t.shipping) : COMMON[lang].free}`,
  );

  lines.push({
    label: esc(COMMON[lang].total),
    value: money(t.total, true),
    total: true,
  });
  text.push(`  ${COMMON[lang].total}: ${money(t.total)}`);

  return { lines, text };
}

/** "R-100042", or a readable stand-in when the row has no number yet. */
export function orderNumber(order: OrderLike): string {
  return pick(order.number, order.id ? `#${order.id}` : "", "R-—");
}
