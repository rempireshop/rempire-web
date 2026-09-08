/**
 * Shared plumbing for the admin fuzz sweep (`e2e/sweep-admin*.spec.ts`).
 *
 * Not a `.spec.ts` on purpose — Playwright's testDir picks up every spec file
 * in e2e/, and this one holds no tests, only the watchdog every sweep step
 * runs through.
 *
 * The sweep's contract, applied on EVERY step (see `assertClean`):
 *   - no `pageerror` (an uncaught throw in app.js)
 *   - no `console.error` outside the tiny allowlist below
 *   - no 5xx from any request the page made
 *   - no visible "undefined" / "NaN" / "[object Object]" / "null" / "{{"
 *   - no duplicate element ids
 *
 * Everything is seeded (`prng`), so a failure reproduces byte for byte.
 */
import { expect, type Browser, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env.mjs";
import { shopUrl } from "./fixtures";

/* ---------- seeded randomness ------------------------------------------- */

/** mulberry32 — 32 bits of state, no dependencies, identical run to run. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` distinct members of `list`, chosen by `rand` — order is stable per seed. */
export function pick<T>(list: T[], n: number, rand: () => number): T[] {
  const pool = list.slice();
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/* ---------- the watchdog -------------------------------------------------- */

/**
 * Console errors this suite tolerates. Deliberately tiny — anything not
 * listed here fails the step that produced it.
 */
const CONSOLE_ALLOW: RegExp[] = [
  // Google Fonts is a cross-origin stylesheet on a localhost page; Chromium
  // logs the preload/CORS complaint on every single load and it is not ours.
  /fonts\.(googleapis|gstatic)\.com/i,
  // Cloudflare's analytics beacon is unreachable from a test machine.
  /cloudflareinsights/i,
  // GET /api/payments/methods answers 503 {error:"not_configured"} whenever
  // there are no Montonio keys — which is this whole suite, by design
  // (playwright.config.ts). Every checkout page therefore logs one 5xx that
  // says nothing about the admin panel. Flagged in the sweep report as a
  // server-side nit rather than silently tolerated everywhere.
  /\/api\/payments\/methods\//,
  /* GET /api/shipping/carriers/ is the same posture one step along: it
     fetches the carriers' own logos for the delivery step and answers 503
     {error:"not_configured"} without Montonio keys, which is this whole
     suite. The step then draws the coloured dots it always drew. */
  /\/api\/shipping\/carriers\//,
];

/**
 * Chromium reports a failed *request* as a console message of type "error"
 * too ("Failed to load resource: … 401 (Unauthorized)"). A 401 on an admin
 * route while signed out — or a 429 from the login limiter after six wrong
 * passwords — is the behaviour this sweep is asserting, not a defect, so
 * those are allowed by status+URL and every other status still fails. 5xx is
 * caught separately, by `serverErrors` below.
 */
function isExpectedResourceError(text: string, url: string): boolean {
  if (!/Failed to load resource/i.test(text)) return false;
  if (!/\b(401|403|404|429)\b/.test(text)) return false;
  return /\/api\/(admin|account|assistant|promos)\//.test(url) || /\/favicon|\.png|\.webp|\.jpg|\.svg/.test(url);
}

export interface Watch {
  pageErrors: string[];
  consoleErrors: string[];
  serverErrors: string[];
  /**
   * Requests this test provokes a 4xx from on purpose (posting a promo code
   * the server must refuse, say). Chromium logs every failed request as a
   * console error of its own; the assertion that matters — that the panel
   * showed the owner a readable reason — is made separately at the call
   * site. Push a URL pattern here, with a comment saying which step needs it.
   */
  allow: RegExp[];
  /** Everything seen so far is forgiven — used after a step that provokes an error on purpose. */
  reset(): void;
}

/** Starts watching a page. Call once per page, right after it is created. */
export function watch(page: Page): Watch {
  const w: Watch = {
    pageErrors: [],
    consoleErrors: [],
    serverErrors: [],
    allow: [],
    reset() { w.pageErrors.length = 0; w.consoleErrors.length = 0; w.serverErrors.length = 0; },
  };
  page.on("pageerror", (err) => w.pageErrors.push(String(err && err.stack ? err.stack : err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const url = msg.location().url || "";
    if (CONSOLE_ALLOW.some((re) => re.test(text) || re.test(url))) return;
    if (isExpectedResourceError(text, url)) return;
    w.consoleErrors.push(`${text}  @ ${url}`);
  });
  page.on("response", (res) => {
    if (res.status() < 500) return;
    const line = `${res.status()} ${res.request().method()} ${res.url()}`;
    if (CONSOLE_ALLOW.some((re) => re.test(res.url()))) return;   // see that list's comments
    w.serverErrors.push(line);
  });
  return w;
}

/** Tokens that must never reach the screen — a raw JS value shown to the owner. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bundefined\b/, "undefined"],
  [/\bNaN\b/, "NaN"],
  [/\[object Object\]/, "[object Object]"],
  [/\bnull\b/, "null"],
  [/\{\{/, "{{"],
];

/** One round trip: the rendered text plus any repeated element id. */
async function probe(page: Page): Promise<{ text: string; dupIds: string[] }> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    document.querySelectorAll("[id]").forEach((el) => {
      const id = el.getAttribute("id") || "";
      if (!id) return;
      if (seen.has(id)) dup.add(id);
      seen.add(id);
    });
    return { text: document.body ? document.body.innerText : "", dupIds: [...dup] };
  });
}

/**
 * The assertion every sweep step ends with. `label` names the step, so a
 * failure says which click produced it without reading the trace.
 *
 * `allow` exists for the handful of steps that type one of the forbidden
 * tokens in themselves (the assistant echoes the owner's own question back,
 * so asking it "{{7*7}}" legitimately puts "{{" on screen). Every such use
 * carries its own comment at the call site.
 */
export async function assertClean(
  page: Page,
  w: Watch,
  label: string,
  allow: string[] = [],
): Promise<void> {
  expect(w.pageErrors, `${label}: uncaught page error`).toEqual([]);
  const console = w.consoleErrors.filter((line) => !w.allow.some((re) => re.test(line)));
  expect(console, `${label}: console.error`).toEqual([]);
  expect(w.serverErrors, `${label}: 5xx response`).toEqual([]);

  const { text, dupIds } = await probe(page);
  expect(dupIds, `${label}: duplicate element id`).toEqual([]);
  for (const [re, name] of FORBIDDEN) {
    if (allow.indexOf(name) >= 0) continue;
    const hit = re.exec(text);
    if (!hit) continue;
    const around = text.slice(Math.max(0, hit.index - 70), hit.index + 70).replace(/\s+/g, " ");
    throw new Error(`${label}: the screen shows "${name}" — …${around}…`);
  }
}

/* ---------- admin plumbing ------------------------------------------------ */

/**
 * Waits for the panel to finish `probeAdmin()` and show its login card.
 *
 * Generous on purpose: `next dev` compiles `/api/admin/me/` on its first hit
 * of the run, and until that answers the panel sits on «Проверяем…» — which
 * is correct behaviour, just slower than the 8 s default expect timeout.
 */
export async function waitForLoginCard(page: Page): Promise<void> {
  await expect(page.locator("[data-admpw]")).toBeVisible({ timeout: 60_000 });
}

/**
 * Types the password into the login card and submits it, once.
 *
 * The card is plain innerHTML with no value attribute on the input, so ANY
 * render() between the keystrokes and the click rebuilds it empty and the
 * click submits nothing — the panel answers «Введите пароль» and never even
 * calls the route. The boot probes (/api/admin/me, /api/overrides,
 * /api/assistant, /api/geo) each end in a render, so on a cold server this is
 * a real race rather than a flake. Re-checking the field before the click and
 * retrying costs nothing; a wrong-state submit never reaches the rate limiter
 * either, because admLogin() returns early on an empty password.
 */
async function trySignIn(page: Page): Promise<boolean> {
  await page.locator("[data-admpw]").fill(E2E_ADMIN_PASSWORD);
  if ((await page.locator("[data-admpw]").inputValue()) !== E2E_ADMIN_PASSWORD) return false;
  await page.locator("[data-admlogin]").click();
  try {
    await expect(page.locator("[data-admpw]")).toHaveCount(0, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Opens /shop2/admin/ and signs in as the fixed test admin (fixtures.ts). */
export async function openAdmin(page: Page): Promise<void> {
  await page.goto(shopUrl("", "/admin/"));
  await waitForLoginCard(page);
  let signedIn = false;
  for (let attempt = 0; attempt < 3 && !signedIn; attempt++) signedIn = await trySignIn(page);
  expect(signedIn, "openAdmin: the login card would not accept the test password").toBe(true);
  await expect(page.locator('[data-admtab="orders"][aria-current]:visible').first()).toBeVisible();
}

/**
 * Which of the five places (ADM_SECTIONS / ADM_MORE in app.js) an old tab key
 * now lives in. The redesign folded thirteen flat tabs into five, but kept
 * every old key as the address of its section — «Склад» is a tab strip inside
 * «Товары», «Отзывы» inside «Клиенты», «Письма» inside «Маркетинг» — so
 * reaching one is two clicks now, not one. See docs/design/admin-handoff-README.md.
 */
const SECTION_OF: Record<string, string> = {
  over: "over", orders: "orders", goods: "goods", stock: "goods", pos: "pos",
  people: "people", reviews: "people", promos: "promos", gift: "promos", mail: "promos",
  blog: "blog", stats: "stats", apps: "apps", setup: "setup",
};

/**
 * Opens the section an old tab key belongs to, then the sub-tab itself if the
 * key is one of the merged ones.
 *
 * `[data-admtab=…]` alone is ambiguous — the «Обзор» shortcut rows and the
 * assistant's «Открыть …» buttons carry it too; only a nav item or a tab has
 * `aria-current`. `:visible` picks between the desktop sidebar and the phone
 * bottom bar, which are both in the DOM (see fixtures.ts loginAsAdmin).
 */
export async function tab(page: Page, key: string): Promise<void> {
  const section = SECTION_OF[key] || key;
  await page.locator(`[data-admtab="${section}"][aria-current]:visible`).first().click();
  if (section !== key) {
    await page.locator(`[data-admtab="${key}"][aria-current]:visible`).first().click();
  }
  await expect(page.locator(`[data-admtab="${key}"][aria-current="true"]:visible`).first()).toBeVisible();
}

/**
 * Settings ("Настройки"). Since the phase-3 redesign this is an index of six
 * sub-pages rather than one long scroll of cards (README fix #6), so reaching
 * a card is two clicks: the section, then the page it lives on.
 *
 *   home     — the banner editor, the announcement bar, the sets/chat switches
 *   company  — the shop's own details, opening hours, socials, the reports card
 *   delivery — the tariff grid, the Montonio fill button, payment methods
 *   prices   — the salon discount and the loyalty points form
 *   langs    — RU/ET/EN
 *   journal  — the change log with its «Вернуть» buttons
 */
export async function openSettings(page: Page, sub: string = "home"): Promise<void> {
  await tab(page, "setup");
  // already inside a sub-page (a previous call in the same test) → back out first
  const back = page.locator("[data-admsetback]");
  if (await back.count()) await back.first().click();
  await page.locator(`[data-admsetpage="${sub}"]`).click();
  await expect(page.locator("[data-admsetback]")).toBeVisible();
}

/**
 * The toast text, read before it self-dismisses (2.6 s, app.js `toast()`).
 * Returns "" when no toast appeared — callers assert on the text they expect
 * rather than on mere visibility, so a silent no-op cannot pass.
 */
export async function toastText(page: Page): Promise<string> {
  const t = page.getByRole("status");
  try {
    await expect(t.first()).toBeVisible({ timeout: 3000 });
  } catch {
    return "";
  }
  return ((await t.first().textContent()) || "").trim();
}

/**
 * Waits out the toast so the next step's `toastText` cannot read a stale one.
 *
 * The first half matters as much as the second: most toasts are fired by a
 * request's callback, so "no toast right now" straight after a click usually
 * means "not yet", and returning then would leave it to pop up during the
 * NEXT step and be read as that step's answer.
 */
export async function clearToast(page: Page): Promise<void> {
  try {
    await expect(page.getByRole("status").first()).toBeVisible({ timeout: 2000 });
  } catch {
    return;   // some actions genuinely toast nothing
  }
  // Dismiss rather than wait out app.js's 2.6 s timer: this helper runs after
  // nearly every admin action in the sweep, and the waiting alone would be
  // most of the suite's runtime.
  const close = page.locator("[data-closetoast]");
  if (await close.count()) await close.first().click();
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 6000 });
}

/**
 * A storefront page in its own context — `/api/overrides/` answers with
 * `s-maxage=30`, so a page sharing the admin page's HTTP cache can keep
 * showing the pre-change value (see admin.spec.ts's own comment).
 */
export async function freshShop(browser: Browser): Promise<{ page: Page; w: Watch; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const w = watch(page);
  return { page, w, close: () => ctx.close() };
}

/** Cyrillic in the string — the owner reads Russian, an English message is a bug. */
export function isRussian(s: string): boolean {
  return /[А-Яа-яЁё]/.test(s);
}

/* ---------- the fuzz corpus ---------------------------------------------- */

export const LONG = "Ю".repeat(1000);
export const HTML_BOMB = '<script>alert(1)</script><img src=x onerror=alert(1)>';
export const EMOJI = "🎉💇‍♀️🧴 тест";
export const BAD_URLS = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "not a url"];
export const GOOD_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** Price/number inputs the owner could plausibly type, and what must happen. */
export const BAD_NUMBERS = ["abc", "-5", "0", "1e9", ""];
