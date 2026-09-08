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
import { expect, type Page, type TestInfo } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";

export type LangCode = "RU" | "ET" | "EN";

/** `pathFor()`'s SEG_OF_LANG (app.js) — RU is the default, unprefixed language. */
export const LANGS: Array<{ code: LangCode; seg: string; htmlLang: string }> = [
  { code: "RU", seg: "", htmlLang: "ru" },
  { code: "ET", seg: "/et", htmlLang: "et" },
  { code: "EN", seg: "/en", htmlLang: "en" },
];

/** The projects a functional storefront spec runs on. "desktop" is the
 *  suite's Chromium default; "mobile-safari" (playwright.config.ts) is the
 *  real WebKit engine on an iPhone 13 profile — a different browser, not a
 *  third viewport, which is why it is not covered by the "desktop only" rule
 *  in docs/testing.md. Everything else (tablet, mobile — Chromium at other
 *  sizes) is still skipped for the reasons given there. */
export function functionalProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === "desktop" || testInfo.project.name === "mobile-safari";
}

/** `/shop2<seg><path>` — path must start with "/" (or be "" for the home page). */
export function shopUrl(seg: string, path: string): string {
  return `/shop2${seg}${path}`;
}

/** A product with 3 differently-priced sizes (src/data/catalogue.variants.json),
 *  in stock — the fixed subject of the gallery/size/price/add-to-cart tests.
 *
 *  Stock: this product must stay *untracked* in the inventory sense
 *  (src/lib/inventory.ts — no goods_in/adjust/return move for any of its
 *  sizes, ever, in this suite). Every spec that mock-pays for it (checkout,
 *  account, giftcard, …) fires a `sale_web` move on the paid transition, and
 *  move() skips a sale on an untracked variant — so PRODUCT reads «в наличии»
 *  for the whole server run no matter how many orders the suite completes.
 *  A spec that counted it (the admin «Склад» qty editor, a goods-in scan)
 *  would turn every later purchase into a real decrement, and at 0 the
 *  product page swaps .pdp__add for «нет в наличии» and every add-to-cart
 *  after that fails. PRODUCT_2 is the one the warehouse/register sweep
 *  (sweep-admin-ops.spec.ts) counts on purpose — it leaves it at 500. */
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

/** Types a query into whichever search field this viewport actually has.
 *  The header's own input (`[data-search]`) is hidden below 768px
 *  (styles.css, "v2 mobile: give the screen back": it duplicated the bottom
 *  nav's «Поиск» tab), so on a phone the tab is the real path and the search
 *  screen's own box (`[data-search2]`) takes the query — the same branch the
 *  storefront sweep takes. Resolves once the search screen is on. */
export async function searchFor(page: Page, query: string): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 768) {
    await page.locator('[data-nav="search"]').click();
    await waitForScreen(page, "search");
    await page.locator("[data-search2]").fill(query);
  } else {
    await page.locator("[data-search]").fill(query);
  }
  await waitForScreen(page, "search");
}

/** `data-step="N"` is ambiguous on its own: coHead() (app.js) puts the same
 *  attribute on each checkout step's clickable *header* (`.costep__head`,
 *  jumps straight to that step) as well as on the *continue* button at the
 *  bottom of the current step's body (`.btn.btn--wide`, "Далее — …") —
 *  scope to the latter, which is the one every spec means. */
export function continueButton(page: Page, step: 2 | 3) {
  return page.locator(`button.btn--wide[data-step="${step}"]`);
}

/** The «Оплатить» button this viewport actually shows. `.co__pay` sits
 *  inside the order summary on a laptop; below 768px styles.css hides it and
 *  the sticky bottom bar carries a twin (`.stickybar [data-pay]`) — the same
 *  data-pay handler either way, so a spec presses whichever one is visible
 *  rather than assuming the laptop's. */
export function payButton(page: Page) {
  return page.locator("button[data-pay]:visible").first();
}

/** The checkout's order summary is a `<details data-sum>`: open on a laptop,
 *  folded on a phone until the shopper taps it (`S.sumOpen` in app.js follows
 *  the breakpoint until touched). Anything a spec fills or reads inside it —
 *  the promo field, the lines, a set's breakout — needs it open first. */
export async function openSummary(page: Page): Promise<void> {
  const sum = page.locator("details[data-sum]");
  await expect(sum).toBeAttached();
  if (!(await sum.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await sum.locator("summary").click();
    await expect(sum).toHaveAttribute("open", "");
  }
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
  /* Re-check the value right before the click. app.js now carries the typed
     password across a render (renderImpl's `pwKeep`), but a render landing
     between `fill` and `click` still replaces the node the click was aimed
     at, and a click that submits an empty box never even reaches the route —
     the panel answers «Введите пароль» locally. Poll instead of assuming. */
  await expect
    .poll(async () => {
      await pwField.fill(E2E_ADMIN_PASSWORD);
      return pwField.inputValue();
    }, { timeout: 10_000 })
    .toBe(E2E_ADMIN_PASSWORD);
  await page.locator("[data-admlogin]").click();
  // Login replaces the card with the admin nav — [data-admpw] is gone.
  await expect(page.locator("[data-admpw]")).toHaveCount(0);
  /* [data-admtab="orders"] alone is ambiguous: the shortcut links on «Обзор»
     and the assistant's «Открыть …» buttons carry it too; [aria-current] is
     what only a nav item has. The redesigned shell renders BOTH navs — the
     232-px sidebar and the 64-px phone bottom bar — and hides one of them in
     CSS, so `:visible` is what picks the one this viewport actually uses. */
  await expect(page.locator('[data-admtab="orders"][aria-current]:visible').first()).toBeVisible();
}

/**
 * Opens one of the panel's sections by the key it has always had, then its
 * sub-tab if the screen has one.
 *
 * The eleven sections sit in the desktop sidebar, but on a 375-px viewport
 * only five are in the bottom bar and the other six live behind «Ещё» — so a
 * spec that reaches straight for `[data-admtab="promos"]` passes on a desktop
 * and times out on a phone, which is exactly how «Маркетинг» broke the mobile
 * shard. One helper, so a spec cannot get this right on one viewport only.
 */
export async function adminSection(page: Page, key: string, sub?: string): Promise<void> {
  const direct = page.locator(`[data-admtab="${key}"][aria-current]:visible`);
  const more = page.locator("[data-admmore]:visible");
  /* Wait for whichever navigation this viewport draws before counting: after a
     reload the shell is a frame or two behind, and an immediate count of zero
     would send a desktop run looking for the phone's «Ещё» button. */
  await expect(direct.or(more).first()).toBeVisible();
  if (await direct.count()) {
    await direct.first().click();
  } else {
    await more.first().click();
    await page.locator(`.adm-sheet [data-admtab="${key}"]`).first().click();
  }
  if (sub) await page.locator(`[data-admtab="${sub}"][aria-current]:visible`).first().click();
}

/**
 * Switches the panel's own language (RU · ET · EN).
 *
 * The strip is drawn twice, like the navigation: once in the desktop sidebar
 * and once in the phone's «Ещё» sheet, which is not in the document at all
 * until the sheet is open. So a phone has to open the sheet, pick, and close
 * it again — the caller is looking at the screen underneath.
 */
export async function adminLang(page: Page, code: "RU" | "ET" | "EN"): Promise<void> {
  const button = page.locator(`.adm-langs button[data-lang="${code}"]:visible`);
  if (await button.count()) { await button.first().click(); return; }
  await page.locator("[data-admmore]:visible").first().click();
  await page.locator(`.adm-sheet .adm-langs button[data-lang="${code}"]`).first().click();
  /* Near the top-left corner, not the middle: the scrim is the whole screen
     and the sheet is stacked on top of its lower half, so a click aimed at
     the scrim's centre lands on the sheet. The dark strip above the sheet is
     where a thumb taps, and it is the only part of the scrim that is clear. */
  await page.locator("[data-admmoreclose]").first().click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".adm-sheet")).toHaveCount(0);
}

/**
 * Fills contact + courier delivery + card payment on an already-open
 * checkout screen, clicks Pay, and follows the mock bank
 * (src/app/api/payments/mock/route.ts) through to a paid or failed receipt.
 * Returns the order number from the receipt URL (`?n=R-100042`).
 *
 * Courier, not pickup: every "just get me a paid order" caller in this suite
 * (account, admin, gift-card specs) needs the order itself, not delivery
 * method coverage — a fixed Estonian address with no parcel-machine/carrier
 * API involved is also the fastest of the three methods to complete.
 * Pickup's own checkout path (once broken — a pickup order always 400ed with
 * bad_name, since its UI never rendered a name field at all) has its own
 * dedicated end-to-end test in checkout.spec.ts ("checkout — pickup").
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
  await payButton(page).click();
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
  "Наборы сейчас недоступны": { ET: "Komplektid pole praegu saadaval", EN: "Sets are not available right now" },
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
  // ET is «Blogi», not «Ajaveeb» — the owner's own word for the section,
  // settled 07.09.2026 so the label matches the sentences that decline it.
  "Блог": { ET: "Blogi", EN: "Blog" },
  // the aria-label on a product card's size picker (cardSizeHTML in app.js)
  "Объём": { ET: "Maht", EN: "Size" },
  "Подарочная карта": { ET: "Kinkekaart", EN: "Gift card" },
  // the 404 screen (screenNotFound in app.js, 07.09.2026)
  "Страница не найдена": { ET: "Lehte ei leitud", EN: "Page not found" },
  "Отзывов пока нет — станьте первым.": { ET: "Arvustusi veel pole — ole esimene.", EN: "No reviews yet — be the first." },
  "Спасибо! Отзыв отправлен — он появится на странице после проверки.": {
    ET: "Aitäh! Arvustus on saadetud — see ilmub lehele pärast ülevaatamist.",
    EN: "Thank you! Your review has been sent — it appears on the page once checked.",
  },
  "Статей пока нет — загляните позже.": {
    ET: "Artikleid veel pole — vaata varsti uuesti.",
    EN: "No articles yet — check back soon.",
  },
  // the shop's own paragraph at the foot of /info/returns/ (returnsAskHTML)
  "Как попросить возврат": { ET: "Kuidas tagastust taotleda", EN: "How to ask for a return" },
  "Если заказ уже доставлен, откройте «Кабинет → Мои заказы» и отметьте «Хочу вернуть заказ» — на это есть 30 дней с момента получения.": {
    ET: "Kui tellimus on juba kohale toimetatud, avage «Konto → Minu tellimused» ja märkige «Soovin tellimuse tagastada» — selleks on aega 30 päeva kättesaamisest.",
    EN: "If the order has already been delivered, open “Account → My orders” and tick “I want to return this order” — you have 30 days from receiving it.",
  },
  "Мы увидим отметку и напишем вам на почту: расскажем, как отправить посылку обратно, и вернём деньги после проверки.": {
    ET: "Näeme märget ja kirjutame teile e-postiga: räägime, kuidas pakk tagasi saata, ja tagastame raha pärast kontrolli.",
    EN: "We will see the tick and write to you by e-mail: we will tell you how to send the parcel back, and refund the money once we have checked it.",
  },
  // the first row of the «Доставка и оплата» price table (deliveryPageHTML)
  "Эстония": { ET: "Eesti", EN: "Estonia" },
  "Бесплатно от": { ET: "Tasuta alates", EN: "Free from" },
  // the field notes patchEmail()/patchShip() draw on blur (storefront-sweep-2)
  "В адресе не хватает знака @.": { ET: "Aadressist puudub @-märk.", EN: "The address is missing the @ sign." },
  "Проверьте номер — похоже, в нём не хватает цифр.": {
    ET: "Kontrolli numbrit — tundub, et mõni number on puudu.",
    EN: "Check the number — it looks like a digit is missing.",
  },
  "Впишите имя и фамилию — их напечатают на посылке.": {
    ET: "Kirjuta ees- ja perekonnanimi — need trükitakse pakile.",
    EN: "Enter your first and last name — they are printed on the parcel.",
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
