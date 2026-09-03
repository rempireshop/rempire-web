/**
 * The e-mail registry: what templates exist, and a demo render of each for
 * the admin preview iframe and the «отправить тест» button.
 *
 * Demo data mirrors the sample content of public/shop/emails/*.html so the
 * preview in the admin looks like the design files Renat already signed off.
 */

import { normalizeLang } from "./layout";
import { renderAbandonedCart } from "./abandoned-cart";
import { renderBackInStock } from "./back-in-stock";
import { renderBirthday } from "./birthday";
import { renderGiftCard, type GiftCardLike } from "./gift-card";
import { renderOrderConfirmed } from "./order-confirmed";
import { renderOrderShipped } from "./order-shipped";
import type {
  CartLike,
  CustomerLike,
  Lang,
  OrderLike,
  ProductLike,
  RenderedEmail,
} from "./types";

export * from "./types";
export { renderOrderConfirmed } from "./order-confirmed";
export { renderOrderShipped } from "./order-shipped";
export { renderAbandonedCart } from "./abandoned-cart";
export { renderBackInStock } from "./back-in-stock";
export { renderBirthday } from "./birthday";
export { renderGiftCard } from "./gift-card";
export type { GiftCardLike } from "./gift-card";
export { normalizeLang, isLang, ALL_LANGS, baseUrl } from "./layout";

export const TEMPLATE_IDS = [
  "order-confirmed",
  "order-shipped",
  "abandoned-cart",
  "back-in-stock",
  "gift-card",
  "birthday",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(v: unknown): v is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(String(v));
}

/** Admin-facing names, Russian source (the UI dictionary translates them). */
export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  "order-confirmed": "Заказ принят",
  "order-shipped": "Заказ отправлен",
  "abandoned-cart": "Брошенная корзина",
  "back-in-stock": "Товар снова в наличии",
  "gift-card": "Подарочная карта",
  birthday: "Скидка ко дню рождения",
};

/* ---------- demo data --------------------------------------------------- */

const DEMO_ITEMS: Record<Lang, Array<[string, string, number, number]>> = {
  ru: [
    ["Kevin.Murphy Fresh.Hair", "шампунь", 2, 27],
    ["Uppercut Deluxe Matt Clay", "глина для укладки", 1, 24],
    ["Proraso Wood & Spice", "масло для бороды", 1, 17],
  ],
  et: [
    ["Kevin.Murphy Fresh.Hair", "šampoon", 2, 27],
    ["Uppercut Deluxe Matt Clay", "juuksesavi", 1, 24],
    ["Proraso Wood & Spice", "habemeõli", 1, 17],
  ],
  en: [
    ["Kevin.Murphy Fresh.Hair", "shampoo", 2, 27],
    ["Uppercut Deluxe Matt Clay", "styling clay", 1, 24],
    ["Proraso Wood & Spice", "beard oil", 1, 17],
  ],
};

const DEMO_CART: Record<Lang, Array<[string, string, number, number]>> = {
  ru: [
    ["Reuzel Clay Matte", "матовая глина", 1, 21],
    ["Kevin.Murphy Bedroom.Hair", "текстурирующий спрей", 1, 32],
  ],
  et: [
    ["Reuzel Clay Matte", "matt savi", 1, 21],
    ["Kevin.Murphy Bedroom.Hair", "tekstuurisprei", 1, 32],
  ],
  en: [
    ["Reuzel Clay Matte", "matte clay", 1, 21],
    ["Kevin.Murphy Bedroom.Hair", "texturising spray", 1, 32],
  ],
};

const DEMO_VARIANT: Record<Lang, string> = {
  ru: "сухой шампунь, 250 мл",
  et: "kuivšampoon, 250 ml",
  en: "dry shampoo, 250 ml",
};

const DEMO_POINT: Record<Lang, string> = {
  ru: "Kristiine keskus, Таллинн",
  et: "Kristiine keskus, Tallinn",
  en: "Kristiine keskus, Tallinn",
};

function items(rows: Array<[string, string, number, number]>) {
  return rows.map(([title, variant, qty, price], i) => ({
    id: `demo-${i + 1}`,
    title,
    variant,
    qty,
    price,
  }));
}

export function demoOrder(lang: Lang): OrderLike {
  const list = items(DEMO_ITEMS[lang]);
  return {
    id: 42,
    number: "R-100042",
    email: "klient@example.com",
    customer_name: "Renat",
    lang,
    items: list,
    shipping: { method: "pickup", country: "EE", name: "Renat" },
    subtotal: 95,
    shipping_price: 0,
    discount: 0,
    total: 95,
    currency: "EUR",
    status: "paid",
  };
}

export function demoShippedOrder(lang: Lang): OrderLike {
  return {
    ...demoOrder(lang),
    shipping: {
      method: "parcel",
      carrier: "omniva",
      pointName: DEMO_POINT[lang],
      country: "EE",
      name: "Renat",
      price: 3.5,
    },
    shipping_price: 3.5,
    total: 98.5,
    status: "shipped",
  };
}

export function demoCart(lang: Lang): CartLike {
  const list = items(DEMO_CART[lang]);
  return {
    id: "demo-cart",
    email: "klient@example.com",
    customer_name: "Renat",
    lang,
    items: list,
    subtotal: 53,
    total: 53,
  };
}

export function demoProduct(lang: Lang): ProductLike {
  return {
    id: "km-fresh-hair",
    brand: "Kevin.Murphy",
    title: "Fresh.Hair",
    variant: DEMO_VARIANT[lang],
    price: 34,
    slug: "kevin-murphy-fresh-hair",
  };
}

export function demoCustomer(lang: Lang): CustomerLike {
  return {
    id: 7,
    email: "klient@example.com",
    customer_name: "Renat",
    lang,
  };
}

export function demoGiftCard(lang: Lang): GiftCardLike {
  const L = normalizeLang(lang);
  const names = { ru: ["Андрей", "Мария"], et: ["Andres", "Maria"], en: ["Andrew", "Maria"] } as const;
  const msgs = {
    ru: "С днём рождения! Выбери себе что-нибудь для бороды.",
    et: "Palju õnne sünnipäevaks! Vali endale midagi habeme jaoks.",
    en: "Happy birthday! Pick something for the beard.",
  } as const;
  return {
    code: "RMP-DEMO-CARD",
    amount: 50,
    balance: 50,
    lang: L,
    recipient: { name: names[L][0], email: "demo@example.com", message: msgs[L], from: names[L][1] },
  };
}

/* ---------- demo render ------------------------------------------------- */

/**
 * A sample letter for the admin preview and the test send. Deterministic
 * apart from the birthday expiry, which is genuinely "14 days from now".
 */
export function renderDemo(
  template: TemplateId,
  lang: Lang | string = "ru",
): RenderedEmail {
  const L = normalizeLang(lang);
  switch (template) {
    case "order-shipped":
      return renderOrderShipped(demoShippedOrder(L), L, {
        code: "CE123456789EE",
        carrier: "Omniva",
      });
    case "abandoned-cart":
      return renderAbandonedCart(demoCart(L), L, "/shop2/checkout/");
    case "gift-card":
      return renderGiftCard(demoGiftCard(L), L);
    case "back-in-stock":
      return renderBackInStock(demoProduct(L), L);
    case "birthday":
      return renderBirthday(demoCustomer(L), L, "REM-BDAY-2417", {
        percent: 15,
      });
    case "order-confirmed":
    default:
      return renderOrderConfirmed(demoOrder(L), L);
  }
}
