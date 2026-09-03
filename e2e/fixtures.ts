/**
 * Shared constants and helpers for the e2e suite. See docs/testing.md for the
 * big picture; this file is just the plumbing every spec imports.
 *
 * Selector philosophy (docs/testing.md, build-contracts.md): app.js has no
 * `data-testid` anywhere — every screen is driven by `document.body.dataset
 * .screen` (one universal `body[data-screen="…"]` hook, set at the end of
 * every render) plus a large, stable vocabulary of semantic `data-*` action
 * attributes (`data-add`, `data-pay`, `data-admtab`, …) and roles/text. All
 * locators in this suite are built from those — never a CSS class or
 * nth-child position, which is exactly what could move out from under this
 * suite while app.js is still being edited.
 */
import { expect, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";

export type LangCode = "RU" | "ET" | "EN";

/** `pathFor()`'s SEG_OF_LANG (app.js) — RU is the default, unprefixed language. */
export const LANGS: Array<{ code: LangCode; seg: string; htmlLang: string }> = [
  { code: "RU", seg: "", htmlLang: "ru" },
  { code: "ET", seg: "/et", htmlLang: "et" },
  { code: "EN", seg: "/en", htmlLang: "en" },
];

/** `/shop2<seg><path>` — path must start with "/" (or be "" for the home page). */
export function shopUrl(seg: string, path: string): string {
  return `/shop2${seg}${path}`;
}

/** A product with 3 differently-priced sizes (src/data/catalogue.variants.json),
 *  in stock — the fixed subject of the gallery/size/price/add-to-cart tests. */
export const PRODUCT = {
  id: "system-4-bio-botanical-shampoo",
  brand: "System 4",
  sizes: ["75 мл", "250 мл", "500 мл"],
  prices: [9, 16, 25],
};

/** A second, out-of-the-box in-stock product, single size — dedicated to the
 *  admin "goods editor" price-change test so that test's mutation can never
 *  collide with PRODUCT's hardcoded prices used everywhere else. */
export const PRODUCT_2 = { id: "kevin-murphy-un-tangled-spray", brand: "Kevin.Murphy", price: 8 };

export const CATEGORY = { id: "beard", nameRu: "Уход за бородой" };

/** tools/bundles.config.mjs — a real set, `stock: "low"` overall (one
 *  component is "low", none "out"), so "add to cart" stays available. */
export const BUNDLE = {
  id: "beard-start",
  titleRu: "Борода — стартовый набор",
  price: 34.9,
  componentNames: ["Beard Oil Wood Spice", "Wood & Spice", "Чёрное мыло 666"],
};

/** Waits for the SPA's one universal screen marker (app.js: `document.body
 *  .dataset.screen = S.screen` at the end of every render()). Far more
 *  reliable than waiting on content, since it flips only once the new
 *  screen's markup is already in the DOM. */
export async function waitForScreen(page: Page, screen: string): Promise<void> {
  await expect(page.locator(`body[data-screen="${screen}"]`)).toBeAttached();
}

/** `data-step="N"` is ambiguous on its own: coHead() (app.js) puts the same
 *  attribute on each checkout step's clickable *header* (`.costep__head`,
 *  jumps straight to that step) as well as on the *continue* button at the
 *  bottom of the current step's body (`.btn.btn--wide`, "Далее — …") —
 *  scope to the latter, which is the one every spec means. */
export function continueButton(page: Page, step: 2 | 3) {
  return page.locator(`button.btn--wide[data-step="${step}"]`);
}

/** RFC 5737 TEST-NET-3 — never a real address. Each spec file (and, where a
 *  file logs in as a fresh customer per language, each language within it)
 *  gets its own last octet so the server's per-IP rate limits
 *  (src/lib/auth.ts rateLimit: admin login 5/min, orders 10/min, account
 *  codes 3/15min, …) never see two specs as "the same caller" and starve
 *  each other — see docs/testing.md "Rate limits and test isolation". */
export function ipHeaders(lastOctet: number): Record<string, string> {
  return { "x-forwarded-for": `203.0.113.${lastOctet}` };
}

/** A fresh, never-reused address — order/account flows must not collide
 *  with a previous run's data (the in-memory database is fresh per server
 *  start, but not necessarily per test file within one run). */
export function freshEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Logs the current page in as the fixed e2e test admin (docs/testing.md).
 *  Assumes the page is (or will be navigated to) `/shop2/admin/`. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto(shopUrl("", "/admin/"));
  const pwField = page.locator("[data-admpw]");
  await expect(pwField).toBeVisible();
  await pwField.fill(E2E_ADMIN_PASSWORD);
  await page.locator("[data-admlogin]").click();
  // Login replaces the card with the admin nav — [data-admpw] is gone.
  await expect(page.locator("[data-admpw]")).toHaveCount(0);
  // [data-admtab="orders"] alone is ambiguous: the main nav tab AND a
  // separate "Все заказы" shortcut link both carry it. [aria-current] is
  // unique to the nav tab.
  await expect(page.locator('[data-admtab="orders"][aria-current]')).toBeVisible();
}

/**
 * Fills contact + courier delivery + card payment on an already-open
 * checkout screen, clicks Pay, and follows the mock bank
 * (src/app/api/payments/mock/route.ts) through to a paid or failed receipt.
 * Returns the order number from the receipt URL (`?n=R-100042`).
 *
 * Courier, not pickup: pickup checkout does not currently work — its UI
 * never renders a name field (shipMethod()==="pickup" skips shipField
 * ("name",…) in app.js), yet POST /api/orders/ requires customer.name
 * non-empty (src/lib/orders.ts), so a pickup order always 400s with
 * bad_name. Confirmed by driving it; flagged separately (spawn_task). Every
 * "just get me a paid order" helper in this suite uses courier instead,
 * with a fixed Estonian address — no parcel-machine/carrier API involved,
 * so it is also the fastest of the three methods to complete.
 */
export async function payOrder(page: Page, email: string, outcome: "paid" | "failed"): Promise<string> {
  await page.locator("[data-email]").fill(email);
  await continueButton(page, 2).click();
  await page.locator('input[data-dm="courier"]').check();
  await page.locator('[data-shipf="name"]').fill("E2E Buyer");
  await page.locator('[data-shipf="addr"]').fill("Testitänav 1");
  await page.locator('[data-shipf="zip"]').fill("10111");
  await page.locator('[data-shipf="city"]').fill("Tallinn");
  await page.locator('[data-shipf="phone"]').fill("+372 5550000");
  await continueButton(page, 3).click();
  // Card — the only payment method with no further sub-choice (bank links
  // show a chip row; card does not).
  await page.locator('input[data-paym="1"]').check();
  await page.locator(".co__pay[data-pay]").click();
  await page.waitForURL(/\/api\/payments\/mock\//);
  await page.getByRole("link", { name: outcome === "paid" ? "Оплатить" : "Отменить" }).click();
  await page.waitForURL(new RegExp(`/shop2.*/done/\\?.*s=${outcome}`));
  const number = new URL(page.url()).searchParams.get("n");
  if (!number) throw new Error("payOrder: no order number (?n=) in the receipt URL");
  return number;
}

/**
 * A handful of RU → {ET, EN} entries copied verbatim from app.js's own `UI`
 * dictionary (grep the literal RU string in public/shop2/app.js to add more —
 * do not guess a translation). Kept here, not re-derived at test time, so a
 * spec asserts against the exact same value the app renders (docs/testing.md
 * "text assertions via the dictionary values").
 */
const DICT: Record<string, { ET: string; EN: string }> = {
  "Корзина": { ET: "Ostukorv", EN: "Cart" },
  "В корзину": { ET: "Lisa ostukorvi", EN: "Add to cart" },
  "Наборы": { ET: "Komplektid", EN: "Sets" },
  "Оставить отзыв": { ET: "Jäta arvustus", EN: "Write a review" },
  "Отзывы": { ET: "Arvustused", EN: "Reviews" },
  "Все товары": { ET: "Kõik tooted", EN: "All products" },
  "Главная": { ET: "Avaleht", EN: "Home" },
  "Каталог": { ET: "Kataloog", EN: "Catalogue" },
  "Поиск": { ET: "Otsi", EN: "Search" },
  "Кабинет": { ET: "Konto", EN: "Account" },
  "Промокод или подарочная карта": { ET: "Sooduskood või kinkekaart", EN: "Promo code or gift card" },
  "Далее — доставка": { ET: "Edasi — tarne", EN: "Next — delivery" },
  "Далее — оплата": { ET: "Edasi — maksmine", EN: "Next — payment" },
  "Выберите пакомат": { ET: "Vali pakiautomaat", EN: "Choose a parcel locker" },
  "Выбор пакомата": { ET: "Pakiautomaadi valik", EN: "Parcel locker picker" },
  "Заказ оплачен": { ET: "Tellimus makstud", EN: "Order paid" },
  "Оплата не прошла": { ET: "Makse ebaõnnestus", EN: "Payment did not go through" },
  "Платёж обрабатывается": { ET: "Makset töödeldakse", EN: "Payment is being processed" },
  "Блог": { ET: "Ajaveeb", EN: "Blog" },
  "Отзывов пока нет — станьте первым.": { ET: "Arvustusi veel pole — ole esimene.", EN: "No reviews yet — be the first." },
  "Спасибо! Отзыв отправлен — он появится на странице после проверки.": {
    ET: "Aitäh! Arvustus on saadetud — see ilmub lehele pärast ülevaatamist.",
    EN: "Thank you! Your review has been sent — it appears on the page once checked.",
  },
  "Статей пока нет — загляните позже.": {
    ET: "Artikleid veel pole — vaata varsti uuesti.",
    EN: "No articles yet — check back soon.",
  },
};

/** RU source string → the text app.js actually renders for `lang` (identity
 *  for RU, the dictionary lookup otherwise). Throws on a missing entry
 *  rather than silently falling back to RU — a wrong assertion should fail
 *  loudly, not pass by accident. */
export function tr(ru: string, lang: LangCode): string {
  if (lang === "RU") return ru;
  const entry = DICT[ru];
  if (!entry) throw new Error(`e2e/fixtures.ts DICT is missing an entry for "${ru}" — add it (grep app.js).`);
  return entry[lang];
}

/** Byte-for-byte port of `eur(n)` in app.js (line ~2427): RU/ET "12,90 €" /
 *  "16 €", EN "€12.90" / "€16" — whole euros drop the decimals either way. */
export function eur(amount: number, lang: LangCode): string {
  const v = (Math.round(amount * 100) / 100).toFixed(2);
  if (lang === "EN") return "€" + v.replace(".00", "");
  return v.replace(".", ",").replace(",00", "") + " €";
}
