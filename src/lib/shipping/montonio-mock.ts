/**
 * A stand-in for Montonio Shipping — the browser test suite's carrier.
 *
 * The e2e run (playwright.config.ts) has no Montonio keys, and must not: the
 * sandbox needs a merchant account, the live host books real parcels. Yet the
 * order card's whole fulfilment flow — «Создать этикетку» → «Отправлен» →
 * «Доставлен» — has to be driven end to end by e2e/admin.spec.ts, label PDF
 * and tracking link included. So, exactly like PAYMENT_PROVIDER=mock for the
 * bank (src/lib/payments/index.ts), the shipping side has one explicit
 * switch: **SHIPPING_PROVIDER=mock**, honoured only outside production.
 * Nothing is inferred from a missing key — a shop without keys still gets
 * `not_configured`, never an invented parcel.
 *
 * What it stands in for is the three calls the admin routes make
 * (src/lib/shipping/montonio.ts): register a shipment, make a label file, and
 * fetch that file's PDF. Pickup points, carrier lists and tariffs are NOT
 * mocked — with the switch on they behave exactly as with no keys (public
 * feeds and the seed file), so the storefront specs see the same checkout
 * they always did.
 *
 * The shapes are the real ones (MontonioShipment / MontonioLabelFile), so the
 * routes, the order row in the database and the admin panel cannot tell the
 * difference — which is the point: the test proves the shop's own code, and
 * only Montonio itself is replaced.
 */
import type { Order } from "@/lib/orders";
import type { MontonioLabelFile, MontonioShipment } from "./montonio";

/** `SHIPPING_PROVIDER=mock`, and never under NODE_ENV=production. */
export function shippingMockOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.SHIPPING_PROVIDER === "mock";
}

/** A label URL the mock made — fetchLabelPdf() renders these itself. */
export const MOCK_LABEL_PREFIX = "mock:label/";

/** Where the mock's tracking links point. Not a real host on purpose: a
 *  letter with this link in it can only have come from a test run. */
export const MOCK_TRACKING_HOST = "https://tracking.example";

let seq = 0;

/**
 * The parcel Montonio would have registered: a carrier's tracking number in
 * Omniva's shape (two letters, nine digits, «EE»), a tracking page, and a
 * drop-off PIN — so the admin's shipment box has every field to show.
 */
export function mockShipment(
  order: Pick<Order, "number">,
  opts: { carrier: string; method: "pickupPoint" | "courier"; country: string },
): MontonioShipment {
  seq += 1;
  const digits = String((Date.now() % 10_000_000) * 100 + (seq % 100)).padStart(9, "0").slice(-9);
  const trackingCode = `MK${digits}EE`;
  return {
    provider: "montonio",
    shipmentId: `mock-${order.number.toLowerCase()}-${seq}`,
    status: "registered",
    carrier: opts.carrier || (opts.method === "courier" ? "dpd" : "omniva"),
    country: opts.country,
    method: opts.method,
    trackingCode,
    trackingUrl: `${MOCK_TRACKING_HOST}/${trackingCode}`,
    dropOffPin: "4821",
    createdAt: new Date().toISOString(),
  };
}

/** The label file, «ready» at once — its URL is one this module renders. */
export function mockLabel(shipmentId: string, size: "A4" | "A6"): MontonioLabelFile {
  return {
    labelFileId: `mock-label-${size}-${shipmentId}`,
    status: "ready",
    url: `${MOCK_LABEL_PREFIX}${encodeURIComponent(shipmentId)}/${size}`,
  };
}

/**
 * A one-page PDF for a mock label URL — A4 or A6 by the URL's tail, with the
 * shipment id printed on it in Helvetica, one of the fourteen fonts every
 * PDF reader carries without embedding. Byte offsets in the xref table are
 * computed, not typed, so strict readers open it too. ASCII throughout: the
 * text stream cannot escape it, which is why the id is sanitised.
 */
export function mockLabelPdf(url: string): Uint8Array {
  const tail = url.slice(MOCK_LABEL_PREFIX.length);
  const [rawId, rawSize] = tail.split("/");
  const size = rawSize === "A4" ? "A4" : "A6";
  const id = decodeURIComponent(rawId || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "shipment";
  const [w, h] = size === "A4" ? [595, 842] : [298, 420];
  const content = `BT /F1 14 Tf 24 ${h - 48} Td (Rempire mock label ${size}) Tj 0 -20 Td (${id}) Tj ET`;
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

function buildPdf(objects: string[]): Uint8Array {
  const enc = new TextEncoder();
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(enc.encode(out).length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = enc.encode(out).length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}
