/**
 * Shapes the e-mail renderers accept.
 *
 * Deliberately loose: `orders` rows arrive from `pg`, which hands numerics
 * back as strings, and a half-filled order (guest checkout, no phone, no
 * variant) must still render a sensible letter instead of the word
 * "undefined". Every field is optional; the renderers fall back.
 *
 * Order shape mirrors `db/migrations/001_core.sql` (backend-core):
 *   orders(number, status, lang, currency, email, phone, name,
 *          shipping jsonb {method, country, pointId, pointName, address, price},
 *          items jsonb [{id, title, variant, qty, price, sum}],
 *          subtotal, shipping_price, discount, total, payment jsonb)
 * with `number` like "R-100042".
 */

/** Internal language code. The storefront speaks "RU"/"ET"/"EN"; normalise. */
export type Lang = "ru" | "et" | "en";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * A money column. `pg` hands numerics back as strings, and a payment webhook
 * hands them over as whatever the provider put in the JSON — so this is
 * deliberately unnarrowed and every reader goes through `num()`/`money()`,
 * which cope with anything. Callers must never have to cast to send a letter.
 */
export type Money = unknown;

export interface OrderItem {
  id?: string | number | null;
  title?: string | null;
  /** Product name under another key — tolerated so callers need not remap. */
  name?: string | null;
  /** orders.ts stores brand separately from title; the letter joins them. */
  brand?: string | null;
  variant?: string | null;
  qty?: number | string | null;
  /** Unit price, EUR. */
  price?: Money;
  /** Line total as stored by checkout; wins over qty × price when present. */
  sum?: Money;
}

export interface OrderShipping {
  /** "pickup" | "parcel" | "courier" | free text. */
  method?: string | null;
  /** "Omniva" | "DPD" | "SmartPosti" | "Itella"… */
  carrier?: string | null;
  /** Parcel-machine or pickup-point name. `pointName` is the stored column. */
  point?: string | null;
  pointName?: string | null;
  pointId?: string | number | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** orders.ts stores a jsonb object here; a plain string is tolerated. */
  address?: string | Record<string, unknown> | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  price?: Money;
}

export interface OrderLike {
  id?: string | number | null;
  /** Human order number, e.g. "R-100042". */
  number?: string | null;
  email?: string | null;
  /** Customer name; `customer_name` is the column, `name` a convenience. */
  customer_name?: string | null;
  name?: string | null;
  /** Customer language as stored ("ru"/"ET"/…). */
  lang?: string | null;
  items?: OrderItem[] | null;
  shipping?: OrderShipping | null;
  subtotal?: Money;
  discount?: Money;
  /**
   * Column name in 001_core.sql. `mapOrder()` in src/lib/orders.ts hands the
   * camelCase `shippingPrice` instead, and older callers said
   * `shipping_total` — all three are read.
   */
  shipping_price?: Money;
  shippingPrice?: Money;
  shipping_total?: Money;
  discountCode?: string | null;
  total?: Money;
  currency?: string | null;
  status?: string | null;
  phone?: string | null;
  created_at?: string | Date | null;
  /**
   * Loyalty points credited on this order's paid transition (100_tiers_
   * loyalty) — set by src/app/api/payments/return|notify on the first
   * arrival only, undefined otherwise. order-confirmed.ts prints one line
   * when this is > 0.
   */
  loyaltyEarned?: Money;
}

export interface CartLike {
  id?: string | number | null;
  email?: string | null;
  customer_name?: string | null;
  name?: string | null;
  lang?: string | null;
  items?: OrderItem[] | null;
  subtotal?: Money;
  total?: Money;
  /** Optional per-cart unsubscribe link; falls back to the shop's page. */
  unsubscribeUrl?: string | null;
}

export interface ProductLike {
  id?: string | number | null;
  title?: string | null;
  name?: string | null;
  brand?: string | null;
  /** Short line under the name — "сухой шампунь, 250 мл". */
  variant?: string | null;
  price?: Money;
  /** Absolute URL, or a path that PUBLIC_BASE_URL is prefixed to. */
  url?: string | null;
  slug?: string | null;
  unsubscribeUrl?: string | null;
}

export interface CustomerLike {
  id?: string | number | null;
  email?: string | null;
  customer_name?: string | null;
  name?: string | null;
  lang?: string | null;
  unsubscribeUrl?: string | null;
}

/** Shipping tracking: a bare code, or code + carrier + ready-made URL. */
export type Tracking =
  | string
  | null
  | undefined
  | {
      code?: string | null;
      url?: string | null;
      carrier?: string | null;
    };

export interface BirthdayOptions {
  /** Discount percent shown in the letter. Default 15. */
  percent?: number;
  /** Code expiry. Default: 14 days from render time. */
  expires?: Date | string | null;
}
