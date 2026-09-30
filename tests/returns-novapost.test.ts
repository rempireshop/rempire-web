/**
 * A return asked for on an order that went out with Nova Post.
 *
 * Montonio support, 24.09.2026, on returns through Montonio International
 * Shipping (Nova Post): «Returns are currently not supported, we are waiting
 * behind Nova Post's development.» The order card's return line told the owner
 * to write the customer that «код на возврат присылает перевозчик» — which, for
 * a Nova Post parcel, is a promise nobody will keep: no code is coming. The
 * card now says what the terms already say (public/shop/legal.*.js): the buyer
 * sends it back himself. Every other carrier keeps the line it had.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(
  /\r\n/g,
  "\n",
);

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(name);
}

const card = new Function(`
  var SRV = { returnBusy: "" };
  function esc(s) { return String(s); }
  function admInvoiceDate(s) { return String(s); }
  // 1a: what «Обработано» does is behind the notice's «?»
  function admHelpBtnHTML() { return "<button>?</button>"; }
  function admHelpHTML(k, text) { return "<div>" + text + "</div>"; }
  ${slice("admReturnCarrierNovaPost")}
  ${slice("admReturnStateHTML")}
  return admReturnStateHTML;
`)() as (v: unknown) => string;

const order = (shipping: Record<string, unknown>) => ({
  id: "o1",
  returnAskedAt: "2026-09-24T10:00:00.000Z",
  returnDoneAt: "",
  srv: { shipping },
});

const CARRIER_CODE = "код на возврат присылает перевозчик";

describe("the return line on the order card", () => {
  it("does not promise a carrier's return code on a Nova Post order", () => {
    for (const shipping of [
      { carrier: "novapost", method: "parcel" },
      // Montonio's own spelling, as the booking reply stores it
      { method: "courier", montonio: { shipmentId: "s1", carrier: "novaPost" } },
    ]) {
      const html = card(order(shipping));
      expect(html).not.toContain(CARRIER_CODE);
      expect(html).toContain("Nova Post");
      expect(html).toContain("отправляет обратно сам");
    }
  });

  /* Dim's screenshot, 30.09.2026: the notice is a flex column, so loose
     spans, « · » and <br> each took a row — title, a lone dot, the date. */
  it("puts the title and the day on one line — no loose dot between rows", () => {
    const open = card(order({ carrier: "dpd", method: "parcel" }));
    expect(open).toContain(
      '<div><span class="adm-hint--warn">Покупатель просит вернуть заказ</span> · <span class="adm-mono">2026-09-24T10:00:00.000Z</span></div>',
    );
    const done = card({ ...order({ carrier: "dpd" }), returnDoneAt: "2026-09-30T09:00:00.000Z" });
    expect(done).toContain('<div><span>Возврат обработан</span> · <span class="adm-mono">2026-09-30T09:00:00.000Z</span></div>');
    expect(done).toContain('<div><span>Просили вернуть заказ</span> · <span class="adm-mono">2026-09-24T10:00:00.000Z</span></div>');
    for (const html of [open, done]) {
      expect(html).not.toContain("<br>");
      // up to the buttons, the section holds nothing but whole <div> lines
      expect(html).toMatch(/^<section[^>]*>(?:<div>(?:(?!<\/?div)[\s\S])*<\/div>)+<div class="adm-acts /);
    }
  });

  it("keeps the line it had for every other carrier", () => {
    for (const carrier of ["omniva", "smartpost", "dpd", "unisend", ""]) {
      const html = card(order({ carrier, method: "parcel" }));
      expect(html, carrier || "no carrier").toContain(CARRIER_CODE);
    }
  });
});
