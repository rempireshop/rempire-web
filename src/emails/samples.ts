/**
 * Realistic sample data for the letters — the awkward order, not the
 * signed-off design sample.
 *
 * index.ts's demoOrder() is what the admin preview shows and what Renat
 * approved; it stays as it is. This set is what the mail-client checks
 * render: two lines including a set, a parcel machine, a promo code, loyalty
 * points, a long product title, a gift card with a message, a login code —
 * in all three languages, with per-language names and variants so that a
 * Cyrillic character in an ET/EN letter can only ever be untranslated
 * template copy. tools/render-emails.mjs writes these to disk (HTML, text
 * and PNGs); tests/emails-compat.test.ts holds every one of them to the
 * compatibility rules. Both go through renderSample(), so what the test
 * checks is byte-for-byte what the screenshots show.
 */

import {
  demoInvoice,
  renderAbandonedCart,
  renderBackInStock,
  renderBirthday,
  renderGiftCard,
  renderInvoice,
  renderInvoiceCancelled,
  renderInvoiceReminder,
  renderLoginCode,
  renderOrderCancelled,
  renderOrderConfirmed,
  renderOrderShipped,
  renderOrderUnpaid,
  renderPartnerWelcome,
  TEMPLATE_IDS,
  type GiftCardLike,
  type TemplateId,
} from "./index";
import { setBrandOverride, type BrandOverride } from "./layout";
import type {
  CartLike,
  CustomerLike,
  Lang,
  OrderItem,
  OrderLike,
  ProductLike,
  RenderedEmail,
} from "./types";

export const SAMPLE_LANGS: readonly Lang[] = ["ru", "et", "en"];
export const SAMPLE_TEMPLATES: readonly TemplateId[] = TEMPLATE_IDS;

/** What checkout stores in `orders.items` (src/lib/orders.ts): the renderers
 *  ignore `kind`, but a sample that has it is a sample of the real row. */
type StoredItem = OrderItem & { kind: "product" | "bundle" | "gift" };

interface SampleText {
  /** The customer's full name — Latin outside RU, so the Cyrillic check stays honest. */
  name: string;
  /** The gift card's recipient and giver. */
  first: string;
  giver: string;
  /** A volume and a weight as the catalogue writes them in this language. */
  volume: string;
  weight: string;
  /** The set's title exactly as bundleTitle() stores it (tools/bundles.config.mjs). */
  set: string;
  /** The back-in-stock product's variant line. */
  variant: string;
  /** A giver's message long enough to wrap twice at 360 px. */
  message: string;
  /** The owner's own extra footer line (settings.content → BrandOverride.note). */
  note: string;
}

const TEXT: Record<Lang, SampleText> = {
  ru: {
    name: "Андрей Петров",
    first: "Андрей",
    giver: "Мария",
    volume: "250 мл",
    weight: "113 г",
    set: "Борода — стартовый набор",
    variant: "сухой шампунь, 250 мл",
    message: "С днём рождения! Выбери себе что-нибудь для бороды — и не экономь на масле, оно того стоит.",
    note: "Салон открыт пн–сб 10:00–19:00, Mardi 1, Таллинн",
  },
  et: {
    name: "Mari-Liis Tamm",
    first: "Mari-Liis",
    giver: "Kadri",
    volume: "250 ml",
    weight: "113 g",
    set: "Habe — stardikomplekt",
    variant: "kuivšampoon, 250 ml",
    message: "Palju õnne sünnipäevaks! Vali endale midagi habeme jaoks — ja ära koonerda õliga, see on seda väärt.",
    note: "Salong on avatud E–L 10:00–19:00, Mardi 1, Tallinn",
  },
  en: {
    name: "Alex Johnson",
    first: "Alex",
    giver: "Maria",
    volume: "250 ml",
    weight: "113 g",
    set: "Beard starter kit",
    variant: "dry shampoo, 250 ml",
    message: "Happy birthday! Pick something for the beard — and do not skimp on the oil, it is worth it.",
    note: "The salon is open Mon–Sat 10:00–19:00, Mardi 1, Tallinn",
  },
};

/** The footer as an owner who filled in Настройки → Контент would have it:
 *  a reply address and a line of his own in each language. */
export const SAMPLE_BRAND: BrandOverride = {
  email: "info@rempireshop.com",
  note: { ru: TEXT.ru.note, et: TEXT.et.note, en: TEXT.en.note },
};

/** A paid order: two lines, one of them a set; an Omniva parcel machine; a
 *  promo code; loyalty points credited on the paid transition. */
export function sampleOrder(lang: Lang): OrderLike {
  const t = TEXT[lang];
  const items: StoredItem[] = [
    {
      id: "kevin-murphy-fresh-hair",
      kind: "product",
      brand: "Kevin.Murphy",
      title: "Fresh.Hair Dry Shampoo",
      variant: t.volume,
      qty: 2,
      price: 27,
      sum: 54,
    },
    {
      id: "bundle:beard-start",
      kind: "bundle",
      title: t.set,
      variant: null,
      qty: 1,
      price: 34.9,
      sum: 34.9,
    },
  ];
  return {
    id: "6f1d2c3a-0000-4000-8000-000000000073",
    number: "R-100073",
    status: "paid",
    lang,
    currency: "EUR",
    email: "klient@example.com",
    phone: "+372 5555 5555",
    name: t.name,
    shipping: {
      method: "parcel",
      carrier: "omniva",
      pointId: "96091",
      pointName: "Kristiine keskus",
      address: null,
      country: "EE",
      name: t.name,
      phone: "+372 5555 5555",
      price: 3.5,
    },
    items,
    subtotal: 88.9,
    shippingPrice: 3.5,
    discount: 8.89,
    discountCode: "REM10",
    total: 83.51,
    loyaltyEarned: 83,
  };
}

/** An abandoned cart: a long product title and a two-piece line. */
export function sampleCart(lang: Lang): CartLike {
  const t = TEXT[lang];
  const items: StoredItem[] = [
    {
      id: "davines-pasta-love-hair-beard-body-wash",
      kind: "product",
      brand: "Davines",
      title: "Pasta&Love Hair, Beard & Body Wash",
      variant: t.volume,
      qty: 1,
      price: 24.5,
      sum: 24.5,
    },
    {
      id: "reuzel-clay-matte",
      kind: "product",
      brand: "Reuzel",
      title: "Clay Matte Pomade",
      variant: t.weight,
      qty: 2,
      price: 21,
      sum: 42,
    },
  ];
  return {
    id: "cart-7",
    email: "klient@example.com",
    customer_name: t.name,
    lang,
    items,
    subtotal: 66.5,
    total: 66.5,
  };
}

export function sampleProduct(lang: Lang): ProductLike {
  return {
    id: "kevin-murphy-fresh-hair",
    brand: "Kevin.Murphy",
    title: "Fresh.Hair",
    variant: TEXT[lang].variant,
    price: 34,
    slug: "kevin-murphy-fresh-hair",
  };
}

export function sampleCustomer(lang: Lang): CustomerLike {
  return { id: 7, email: "klient@example.com", customer_name: TEXT[lang].name, lang };
}

/** A 50 € card with a giver, a recipient and a message — the fullest shape. */
export function sampleGiftCard(lang: Lang): GiftCardLike {
  const t = TEXT[lang];
  return {
    code: "RMP-7K4Q-9ZT2",
    amount: 50,
    balance: 50,
    lang,
    recipient: { name: t.first, email: "kingitus@example.com", message: t.message, from: t.giver },
  };
}

/**
 * One letter with the sample data above, rendered through the same ambient
 * brand override the mail hooks set — and cleared again afterwards, so a
 * test that renders a sample leaves the defaults for whatever runs next.
 * Deterministic: the birthday expiry is fixed, not "14 days from now".
 */
export function renderSample(template: TemplateId, lang: Lang): RenderedEmail {
  setBrandOverride(SAMPLE_BRAND);
  try {
    switch (template) {
      case "order-confirmed":
        return renderOrderConfirmed(sampleOrder(lang), lang);
      case "order-shipped":
        return renderOrderShipped({ ...sampleOrder(lang), status: "shipped" }, lang, {
          code: "CE123456789EE",
          carrier: "omniva",
        });
      /* The three letters an order gets when it never becomes a parcel. The
         unpaid reminder points at the same failed receipt the real one does;
         the refund names a partial sum on purpose, because that is the case
         where «сумма возврата» and «итого» differ and a sample must show it. */
      case "order-unpaid":
        return renderOrderUnpaid({ ...sampleOrder(lang), status: "new" }, lang, {
          daysLeft: 4,
          payUrl: "/shop2/done/?n=R-100042&s=failed",
        });
      case "order-cancelled":
        return renderOrderCancelled({ ...sampleOrder(lang), status: "cancelled" }, lang, {
          kind: "cancelled",
        });
      case "order-refunded":
        return renderOrderCancelled({ ...sampleOrder(lang), status: "refunded" }, lang, {
          kind: "refunded",
          amount: 42,
        });
      case "abandoned-cart":
        return renderAbandonedCart(sampleCart(lang), lang, "/shop2/checkout/?resume=cart-7");
      case "back-in-stock":
        return renderBackInStock(sampleProduct(lang), lang);
      case "gift-card":
        return renderGiftCard(sampleGiftCard(lang), lang);
      case "birthday":
        return renderBirthday(sampleCustomer(lang), lang, "REM-BDAY-2417", {
          percent: 15,
          expires: "2026-09-19T12:00:00",
        });
      case "login-code":
        return renderLoginCode("482915", lang, { minutes: 15 });
      case "partner-welcome":
        // a salon added by e-mail alone: no person's name yet, so the
        // greeting falls back to the company the owner typed
        return renderPartnerWelcome({ ...sampleCustomer(lang), customer_name: "" }, lang, {
          percent: 20,
          company: "Salon Näidis OÜ",
        });
      case "invoice": {
        // the awkward order, unpaid, invoiced for its own total
        const order = sampleOrder(lang);
        const total = Number(order.total) || 0;
        return renderInvoice({ ...order, status: "new" }, demoInvoice(total), lang);
      }
      case "invoice-reminder": {
        // the same invoice two days before it runs out, auto-cancel a week later
        const order = sampleOrder(lang);
        const d = demoInvoice(Number(order.total) || 0);
        return renderInvoiceReminder(
          { ...order, status: "new" },
          {
            invoice: { number: d.invoice.number, dueAt: d.invoice.dueAt },
            seller: { name: d.seller.name, iban: d.seller.iban, bankName: d.seller.bankName },
            totals: { total: d.totals.total },
            cancelAt: "2026-09-20",
          },
          lang,
        );
      }
      case "invoice-cancelled": {
        // …and the same invoice a week after it ran out, with nothing owed
        const order = sampleOrder(lang);
        const d = demoInvoice(Number(order.total) || 0);
        return renderInvoiceCancelled(
          { ...order, status: "cancelled" },
          { invoice: { number: d.invoice.number, dueAt: d.invoice.dueAt }, totals: { total: d.totals.total } },
          lang,
        );
      }
    }
    throw new Error(`unknown template ${String(template)}`);
  } finally {
    setBrandOverride(null);
  }
}
