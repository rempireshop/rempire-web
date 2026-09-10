/**
 * Render checks for the five customer letters in three languages.
 *
 * The bugs these are here to catch are the ones a human proof-read misses on
 * the fifteenth variant: a template that prints the word "undefined" because
 * a guest checkout had no name, a relative image URL that shows as a broken
 * icon in Gmail, an Estonian subject line that quietly stayed Russian, or a
 * jsonb address rendered as "[object Object]".
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALL_LANGS,
  TEMPLATE_IDS,
  renderAbandonedCart,
  renderBackInStock,
  renderBirthday,
  renderDemo,
  renderOrderConfirmed,
  renderOrderShipped,
  type Lang,
  type OrderLike,
} from "@/emails";

const BASE = "https://test.rempireshop.com";
let priorBase: string | undefined;

beforeAll(() => {
  priorBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = BASE;
});

afterAll(() => {
  if (priorBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = priorBase;
});

/** Anything that means "a value fell through a hole". */
const HOLES = ["undefined", "NaN", "[object Object]", "Infinity", "{{"];

function expectNoHoles(label: string, ...parts: string[]) {
  for (const part of parts) {
    for (const hole of HOLES) {
      expect(part.includes(hole), `${label} leaked "${hole}"`).toBe(false);
    }
  }
}

/* ---------- every template × every language ----------------------------- */

describe("all templates render in all three languages", () => {
  for (const template of TEMPLATE_IDS) {
    for (const lang of ALL_LANGS) {
      it(`${template} / ${lang}`, () => {
        const mail = renderDemo(template, lang);

        expect(mail.subject.length).toBeGreaterThan(5);
        expect(mail.text.length).toBeGreaterThan(80);
        expectNoHoles(`${template}/${lang}`, mail.subject, mail.html, mail.text);

        // a real, complete document
        expect(mail.html.startsWith("<!DOCTYPE html>")).toBe(true);
        expect(mail.html).toContain("</html>");
        expect(mail.html).toContain('<meta charset="utf-8">');

        // brand chrome and the mandated legal line
        expect(mail.html).toContain("REMPIRE");
        expect(mail.html).toContain("Rempire Store OÜ, Tallinn");
        expect(mail.text).toContain("Rempire Store OÜ, Tallinn");

        // assets and links are absolute, built from PUBLIC_BASE_URL
        // one outlined tower, absolute, on every letter — see emails-compat
        expect(mail.html).toContain(`${BASE}/brand/tower-email-duo.png`);
        expect(mail.html).not.toMatch(/(src|href)="\//);

        // dark-mode-safe: the overrides are present and the body has a ground
        expect(mail.html).toContain("prefers-color-scheme: dark");
        expect(mail.html).toContain('name="color-scheme"');
        expect(mail.html).toContain('<body class="em-bg"');

        // inline CSS only — no external stylesheet, no <link>
        expect(mail.html).not.toContain("<link");
        expect(mail.html).not.toContain("class=\"em-px\" onclick");
      });
    }
  }
});

describe("subjects are per-language", () => {
  for (const template of TEMPLATE_IDS) {
    it(template, () => {
      const subjects = ALL_LANGS.map((l) => renderDemo(template, l).subject);
      expect(new Set(subjects).size).toBe(3);
      for (const s of subjects) expect(s).toContain("Rempire");
    });
  }
});

describe("key strings per language", () => {
  const cases: Array<[Lang, string[]]> = [
    ["ru", ["Заказ принят", "Состав заказа", "Итого"]],
    ["et", ["Tellimus vastu võetud", "Tellimuse sisu", "Kokku"]],
    ["en", ["Order confirmed", "Order summary", "Total"]],
  ];
  for (const [lang, needles] of cases) {
    it(`order-confirmed / ${lang}`, () => {
      const { html, subject } = renderDemo("order-confirmed", lang);
      for (const n of needles) expect(html).toContain(n);
      expect(subject).toContain("R-100042");
    });
  }

  it("shipped carries the tracking code and a carrier link", () => {
    const mail = renderDemo("order-shipped", "ru");
    expect(mail.html).toContain("CE123456789EE");
    expect(mail.text).toContain("CE123456789EE");
    expect(mail.html).toContain("omniva.ee");
  });

  it("birthday carries the promo code and a 14-day window", () => {
    const mail = renderDemo("birthday", "et");
    expect(mail.html).toContain("REM-BDAY-2417");
    expect(mail.html).toContain("15");
    expect(mail.text).toContain("REM-BDAY-2417");
  });

  it("marketing letters carry an unsubscribe link, service ones do not", () => {
    for (const t of ["abandoned-cart", "back-in-stock", "birthday"] as const) {
      expect(renderDemo(t, "ru").html).toContain("Отписаться");
    }
    for (const t of ["order-confirmed", "order-shipped"] as const) {
      expect(renderDemo(t, "ru").html).not.toContain("Отписаться");
      expect(renderDemo(t, "ru").html).toContain("служебное письмо");
    }
  });
});

/* ---------- the shapes real rows actually have -------------------------- */

/** What `mapOrder()` in src/lib/orders.ts hands back: camelCase, jsonb bits. */
const REAL_ORDER: OrderLike = {
  id: "6f1d2c3a-0000-4000-8000-000000000001",
  number: "R-100055",
  status: "paid",
  lang: "ET",
  currency: "EUR",
  email: "klient@example.com",
  phone: "+372 5555 5555",
  name: "Mari Tamm",
  shipping: {
    method: "courier",
    country: "EE",
    pointId: null,
    pointName: null,
    address: { street: "Mardi 1", zip: "10145", city: "Tallinn", country: "EE" },
    price: 4.9,
  },
  items: [
    {
      id: "km-fresh-hair",
      kind: "product",
      title: "Fresh.Hair",
      brand: "Kevin.Murphy",
      variant: "250 мл",
      qty: 2,
      price: 27,
      sum: 54,
    } as never,
    { id: "x", title: "Matt Clay", qty: 1, price: 24, sum: 24 },
  ],
  subtotal: 78,
  shippingPrice: 4.9,
  discount: 5,
  discountCode: "REM10",
  total: 77.9,
};

describe("real order rows", () => {
  it("renders the orders.ts shape without holes", () => {
    const mail = renderOrderConfirmed(REAL_ORDER, REAL_ORDER.lang as string);
    expectNoHoles("real order", mail.subject, mail.html, mail.text);
    expect(mail.subject).toContain("R-100055");
    // ET, because the row says so
    expect(mail.subject).toContain("Tellimus");
    // brand + title joined, jsonb address flattened
    expect(mail.html).toContain("Kevin.Murphy Fresh.Hair");
    expect(mail.html).toContain("Mardi 1");
    expect(mail.html).toContain("Tallinn");
    // stored line sums and the discount row
    expect(mail.text).toContain("54 €");
    expect(mail.text).toContain("77,90 €");
    expect(mail.html).toContain("Allahindlus");
  });

  it("survives a half-empty order", () => {
    const mail = renderOrderConfirmed({}, "en");
    expectNoHoles("empty order", mail.subject, mail.html, mail.text);
    expect(mail.html).toContain("Hello!"); // no name → plain greeting
    expect(mail.text).toContain("0 €");
  });

  it("survives a shipped order with no tracking code at all", () => {
    const mail = renderOrderShipped({ number: "R-1" }, "ru");
    expectNoHoles("no tracking", mail.subject, mail.html, mail.text);
    expect(mail.html).toContain("будет добавлен");
    // the button still points somewhere real
    expect(mail.html).toContain(`href="${BASE}/`);
  });

  it("falls back to summing the lines when no total is stored", () => {
    const mail = renderAbandonedCart(
      { items: [{ title: "A", qty: 2, price: 10 }] },
      "ru",
      "/shop2/checkout/",
    );
    expect(mail.html).toContain("20&nbsp;€");
    expectNoHoles("cart", mail.subject, mail.html, mail.text);
  });

  it("escapes customer-controlled text", () => {
    const mail = renderOrderConfirmed(
      { number: "R-2", name: "<script>alert(1)</script>", items: [] },
      "ru",
    );
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("normalises whatever language code the row carries", () => {
    for (const v of ["ET", "et-EE", "ee", "Eesti"]) {
      expect(renderOrderConfirmed({ number: "R-3" }, v).subject).toContain(
        "Tellimus",
      );
    }
    for (const v of ["", null, undefined, "xx"]) {
      expect(
        renderOrderConfirmed({ number: "R-3" }, v as string).subject,
      ).toContain("Заказ");
    }
  });

  it("back-in-stock and birthday cope with missing data", () => {
    expectNoHoles("product", ...Object.values(renderBackInStock({}, "en")));
    expectNoHoles("birthday", ...Object.values(renderBirthday({}, "ru", "")));
  });
});

/* ---------- product names in the customer's language ---------------------- */

describe("product names", () => {
  const ITEMS = [
    { brand: "Rempire", title: "Чёрное мыло 666 — ручная работа", qty: 1, price: 12, sum: 12 },
    { brand: "System 4", title: "Bio Botanical Shampoo — шампунь", variant: "215 мл", qty: 2, price: 9, sum: 18 },
    { brand: "Davines", title: "OI Oil", qty: 1, price: 34, sum: 34 },
  ];

  it("carry the type tail in the letter's language, as the storefront shows it", () => {
    const en = renderOrderConfirmed({ number: "R-4", items: ITEMS }, "en");
    expect(en.text).toContain("Rempire Чёрное мыло 666 — handmade");
    // …and the volume after it: «215 мл» is the storefront's «215 ml» on both sites
    expect(en.text).toContain("System 4 Bio Botanical Shampoo — shampoo · 215 ml");
    expect(en.text).not.toMatch(/ручная работа|шампунь|мл/);
    const et = renderOrderConfirmed({ number: "R-4", items: ITEMS }, "et");
    expect(et.text).toContain("— käsitöö");
    expect(et.text).toContain("— šampoon · 215 ml");
    const ru = renderOrderConfirmed({ number: "R-4", items: ITEMS }, "ru");
    expect(ru.text).toContain("— ручная работа");
    expect(ru.text).toContain("— шампунь · 215 мл");
    // a Latin name is not touched in any language
    for (const mail of [en, et, ru]) expect(mail.text).toContain("Davines OI Oil");
  });

  it("…in the back-in-stock subject and body too", () => {
    const mail = renderBackInStock({ brand: "System 4", title: "Bio Botanical Shampoo — шампунь", price: 9 }, "en");
    expect(mail.subject + mail.text).toContain("Bio Botanical Shampoo — shampoo");
    expect(mail.subject + mail.text).not.toContain("шампунь");
  });
});
