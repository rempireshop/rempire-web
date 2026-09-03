import type { PaymentAddress, PaymentLineItem, PaymentOrder } from "./types";

/**
 * Database order row → the slice a payment provider needs.
 *
 * Written against the contract's description of the `orders` table (items
 * jsonb, shipping jsonb, totals numeric, number like "R-100042") but tolerant
 * about it on purpose: `totals` may arrive as a number or as a jsonb object,
 * `pg` hands numerics back as strings, and the shipping blob's field names are
 * the storefront's. Payments must not be the thing that breaks when one of
 * those changes shape.
 */

type Row = Record<string, unknown>;

function asRow(v: unknown): Row | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** The grand total, wherever this row happens to keep it. */
export function orderTotal(row: Row): number | null {
  const direct = num(row.total) ?? num(row.grand_total) ?? num(row.grandTotal);
  if (direct !== null) return direct;
  const totals = asRow(row.totals);
  if (totals) {
    return (
      num(totals.grand) ??
      num(totals.grandTotal) ??
      num(totals.total) ??
      num(totals.sum) ??
      null
    );
  }
  return num(row.totals);
}

function toLineItems(v: unknown): PaymentLineItem[] {
  if (!Array.isArray(v)) return [];
  const out: PaymentLineItem[] = [];
  for (const raw of v) {
    const item = asRow(raw);
    if (!item) continue;
    // 001_core.sql stores items as {id, title, variant, qty, price, sum}
    const label =
      str(item.name) ??
      [str(item.brand), str(item.title), str(item.variant)].filter(Boolean).join(" ");
    const name = label || str(item.id);
    const quantity = num(item.quantity) ?? num(item.qty) ?? 1;
    const price =
      num(item.finalPrice) ?? num(item.price) ?? num(item.unit_price) ?? num(item.sum);
    if (!name || price === null) continue;
    out.push({
      name,
      quantity: Math.max(1, Math.round(quantity)),
      finalPrice: Math.round(price * 100) / 100,
    });
  }
  return out;
}

/**
 * The buyer's details live in two places: the `name`/`email`/`phone` columns
 * and the `shipping` blob ({method, country, pointId, pointName, address,
 * price}). Read both, column first.
 */
function toAddress(row: Row, shipping: Row | null, email: string | undefined): PaymentAddress | null {
  const s = shipping ?? {};
  /* src/lib/orders.ts keeps the street inside shipping.address, which is
     itself an object for a courier ({addr, zip, city}) and absent for a parcel
     machine — where the machine's own name is the delivery address. */
  const nested = asRow(s.address) ?? {};
  const full = str(row.name) ?? str(s.name) ?? str(nested.name) ?? "";
  const parts = full.split(/\s+/).filter(Boolean);
  const address: PaymentAddress = {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
    email: email ?? str(s.email) ?? str(nested.email),
    phoneNumber:
      str(row.phone) ?? str(s.phone) ?? str(nested.phone) ?? str(s.phoneNumber),
    addressLine1:
      str(s.address) ??
      str(nested.addr) ??
      str(nested.address) ??
      str(nested.addressLine1) ??
      str(nested.street) ??
      str(s.addr) ??
      str(s.pointName),
    locality: str(nested.city) ?? str(s.city) ?? str(nested.locality),
    postalCode: str(nested.zip) ?? str(s.zip) ?? str(nested.postalCode),
    country:
      (str(s.country) ?? str(nested.country) ?? str(row.country) ?? "").toUpperCase() ||
      undefined,
  };
  return Object.values(address).some(Boolean) ? address : null;
}

export function toPaymentOrder(raw: unknown): PaymentOrder | null {
  const row = asRow(raw);
  if (!row) return null;
  const id = str(row.id) ?? (num(row.id) !== null ? String(row.id) : undefined);
  const number = str(row.number) ?? str(row.order_number);
  const total = orderTotal(row);
  if (!id || !number || total === null) return null;

  const email = str(row.email) ?? str(asRow(row.shipping)?.email);
  return {
    id,
    number,
    total: Math.round(total * 100) / 100,
    currency: str(row.currency)?.toUpperCase() ?? "EUR",
    email: email ?? null,
    items: toLineItems(row.items),
    address: toAddress(row, asRow(row.shipping), email),
  };
}

/** The shipping blob's language, when the storefront stored one. */
export function orderLang(raw: unknown): "RU" | "ET" | "EN" {
  const row = asRow(raw);
  const value = String(
    str(row?.lang) ?? str(asRow(row?.shipping)?.lang) ?? "RU",
  ).toUpperCase();
  return value === "ET" || value === "EN" ? value : "RU";
}
