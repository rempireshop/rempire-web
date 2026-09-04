/**
 * Shared plumbing for the two customer-storefront sweep specs
 * (`sweep-storefront.spec.ts` — the crawl, `sweep-checkout.spec.ts` — the
 * randomised cart/checkout). Not a `*.spec.ts`, so Playwright's testMatch
 * never collects it as a test file.
 *
 * Named `sweep-shop-helpers` rather than `sweep-helpers` because another
 * sweep in this repo (the admin fuzz one) already owns that shorter name —
 * these two files are independent and must not share a module.
 *
 * Two things live here that the older, hand-written specs do not need:
 *
 * 1. **A page watchdog** (`watchPage`). Every screen the sweep visits is
 *    checked for the same failure shapes — uncaught errors, console errors,
 *    leaked `undefined`/`NaN`/`[object Object]`/`null`/`{{`, horizontal
 *    scroll on a phone, Cyrillic left in the ET/EN chrome, `<img>` with no
 *    `alt`, duplicate element ids. A sweep that visits ~250 screens is only
 *    useful if the failure message says *which* screen, in *which* language,
 *    from *which* seed — so every assertion goes through `label()`, which
 *    prefixes exactly that.
 *
 * 2. **A seeded PRNG** (`makeRng`). The product picks and the whole
 *    checkout-scenario matrix are random but reproducible: `SWEEP_SEED` is
 *    fixed in this file, printed into every failure message, and the only
 *    thing that has to change to explore a different slice.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Fixed on purpose — see the file comment. A failure message always names
 *  the seed it ran under, so a report can be replayed exactly. */
export const SWEEP_SEED = 20260904;

/** mulberry32 — 32 bits of state, no dependencies, identical everywhere. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

/** `n` distinct members of `list`, chosen by `rng` — the crawl's 25 products. */
export function sample<T>(rng: () => number, list: readonly T[], n: number): T[] {
  const pool = list.slice();
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

export function intBetween(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/* ------------------------------------------------------------------------ */
/* Page watchdog                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Console messages this sweep deliberately ignores. Kept as short as it can
 * be — each entry is a thing no fix inside public/shop2/** could remove:
 *
 *  - Google Fonts. index.html loads Oswald + Golos Text from
 *    fonts.googleapis.com. A test machine has no guarantee of reaching it and
 *    next.config.ts's CSP is written for the deployed origin, so the
 *    stylesheet/font requests fail or are blocked on localhost.
 *  - The Cloudflare Web Analytics beacon (index.html — its token is still the
 *    `CF_BEACON_TOKEN` placeholder, so it is registered to nobody).
 *  - `GET /api/admin/me/` → 401 for an anonymous visitor. That *is* the
 *    answer: app.js probes it on boot to decide whether the admin
 *    affordances belong on screen, and Chromium logs every non-2xx fetch as
 *    a console error.
 */
const CONSOLE_ALLOW: RegExp[] = [
  /fonts\.(googleapis|gstatic)\.com/i,
  /cloudflareinsights\.com|beacon\.min\.js/i,
  // 401 for an anonymous visitor on the two "who is this?" probes. app.js
  // fires both on boot / on entering the checkout to decide what to draw.
  /\/api\/(admin|account)\/me\//i,
  // The analytics beacon is rate-limited to 60/min per IP
  // (src/app/api/track/route.ts). This crawl walks ~90 screens in a handful
  // of seconds, which is far past anything a person does — the 429 is the
  // limiter working, not a defect. Scoped to that one route and that one
  // status so a 429 anywhere else still fails the sweep.
  /429 \(Too Many Requests\).*\/api\/track\//i,
  // Montonio is not configured in the e2e environment (PAYMENT_PROVIDER=mock,
  // no keys — docs/testing.md), and GET /api/payments/methods/ answers
  // "not_configured" with a 503 by design; app.js falls back to its built-in
  // bank list. See the sweep's report: a 200 + {ok:false} would keep this out
  // of a real shopper's console, but that is a server-side call, not a
  // storefront one.
  /503 \(Service Unavailable\).*\/api\/payments\/methods\//i,
  // A promo code whose *shape* is unusable ("!!!", which normalises to an
  // empty code) is answered 400, while an unknown or expired code is
  // answered 200 + {ok:false} on purpose so the checkout can show a specific
  // message. Both are "the shopper mistyped a code"; only one of them puts a
  // red line in their console. Server-side inconsistency, listed in the
  // sweep's report — app.js already treats the two identically.
  /400 \(Bad Request\).*\/api\/promos\/check\//i,
];

export type Watch = {
  pageErrors: string[];
  consoleErrors: string[];
  /** Everything seen so far is forgiven — used between screens. */
  reset(): void;
};

export function watchPage(page: Page): Watch {
  const w: Watch = {
    pageErrors: [],
    consoleErrors: [],
    reset() {
      w.pageErrors.length = 0;
      w.consoleErrors.length = 0;
    },
  };
  page.on("pageerror", (err) => {
    w.pageErrors.push(String((err && err.stack) || err));
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const where = msg.location() ? msg.location().url : "";
    const line = `${msg.text()} @ ${where}`;
    if (CONSOLE_ALLOW.some((rx) => rx.test(line))) return;
    w.consoleErrors.push(line);
  });
  return w;
}

/* ------------------------------------------------------------------------ */
/* Screen context + assertions                                               */
/* ------------------------------------------------------------------------ */

export type Ctx = {
  /** Human name of the screen — "product:free-hold", "search:<script>", … */
  screen: string;
  lang: string;
  /** Extra detail worth having in the failure message (a scenario, an input). */
  note?: string;
};

/** Every assertion in the sweep goes through this, so a failure out of 250
 *  screens always says which screen, which language and which seed. */
export function label(ctx: Ctx): string {
  return `[${ctx.lang} · ${ctx.screen}${ctx.note ? " · " + ctx.note : ""} · seed ${SWEEP_SEED}]`;
}

/** Placeholder/leak shapes that must never reach a shopper's eyes.
 *
 *  `null` is matched as a standalone lowercase token only: Estonian writes
 *  "null" for the number zero and the sweep crawls Estonian pages. What this
 *  is after is a bare `null` rendered by a template, which always appears as
 *  its own word. */
const BAD_TEXT: Array<{ rx: RegExp; name: string }> = [
  { rx: /\bundefined\b/, name: "undefined" },
  { rx: /\bNaN\b/, name: "NaN" },
  { rx: /\[object [A-Z]\w*\]/, name: "[object Object]" },
  { rx: /(^|[\s>(:,])null([\s<),.;!?]|$)/, name: "null" },
  { rx: /\{\{/, name: "{{" },
];

/** The UI chrome, for the "no Cyrillic on an ET/EN screen" check. Product
 *  names, descriptions, reviews and blog bodies are content, not chrome, and
 *  are exempt — they come from the catalogue/database in Russian and app.js's
 *  dictionary has no business translating them. */
const CHROME_SELECTORS = [
  ".hdr",            // header: logo row, search, language menu, category nav
  ".botnav",         // bottom nav
  ".ftr",            // footer
  ".drawer",         // cart + filter drawers
  ".cohdr",          // checkout's own header
  ".costep",         // every checkout step: title, collapsed value, body, hints
  ".cosum",          // the order summary: promo box, delivery row, totals
  ".field__label",   // every form label, checkout included
  ".btn",            // every primary/ghost button
  ".opt",            // delivery + payment option labels
  ".drawer__tot",
  ".stickybar",      // the phone's fixed pay bar
];

/** Content nodes inside the chrome selectors above — a cart line's product
 *  name stays Russian in every language, by design. */
const CHROME_EXEMPT = [
  ".cline__nm",
  ".cline__parts",
  ".cosum__nm",
  ".upsell__nm",
  ".card__name",
  ".card__brand",
  ".hdr__word",      // the wordmark
  ".pdp__title",
];

const CYRILLIC = /[Ѐ-ӿ]/;

export type AuditOptions = {
  /** Skip the horizontal-scroll check. Nothing needs it so far; it exists so
   *  a deliberate full-bleed surface would not have to weaken the check for
   *  every other screen. */
  allowHorizontalScroll?: boolean;
  /** Screens that legitimately show one of the BAD_TEXT tokens because the
   *  shopper typed it (searching for "{{" is a real thing this sweep does). */
  allowText?: string[];
};

/**
 * The checks every screen in the sweep is held to. Throws through `expect`
 * with a message naming the screen, language and seed.
 */
export async function auditScreen(page: Page, w: Watch, ctx: Ctx, opts: AuditOptions = {}): Promise<void> {
  const at = label(ctx);

  // 1) No uncaught exception, 2) no unexpected console.error.
  expect(w.pageErrors, `${at} uncaught page error(s):\n${w.pageErrors.join("\n")}`).toEqual([]);
  expect(w.consoleErrors, `${at} console.error(s):\n${w.consoleErrors.join("\n")}`).toEqual([]);

  const report = await page.evaluate(
    (args) => {
      const [badSrc, chromeSel, exemptSel, cyrSrc] = args as [
        Array<{ src: string; name: string }>,
        string[],
        string[],
        string,
      ];
      const bad = badSrc.map((b) => ({ rx: new RegExp(b.src), name: b.name }));
      const cyr = new RegExp(cyrSrc);

      /** A short, human-readable path to an element. */
      const where = (el: Element): string => {
        const parts: string[] = [];
        let n: Element | null = el;
        for (let i = 0; n && i < 4; i++) {
          const cls =
            typeof n.className === "string" && n.className.trim()
              ? "." + n.className.trim().split(/\s+/)[0]
              : "";
          parts.unshift(n.tagName.toLowerCase() + cls);
          n = n.parentElement;
        }
        return parts.join(" > ");
      };

      /** Is this element actually painted? */
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const st = getComputedStyle(el);
        return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
      };

      /* --- leaked placeholders, in visible text nodes only --- */
      const leaks: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue || "").trim();
        if (!text) continue;
        const host = node.parentElement;
        if (!host || host.closest("script,style,noscript,template")) continue;
        for (const b of bad) {
          if (!b.rx.test(text)) continue;
          if (!visible(host)) continue;
          leaks.push(`${b.name} in <${where(host)}>: ${JSON.stringify(text.slice(0, 160))}`);
        }
      }

      /* --- Cyrillic left in the ET/EN chrome --- */
      const cyrillic: string[] = [];
      const seen = new Set<Element>();
      for (const sel of chromeSel) {
        document.querySelectorAll(sel).forEach((root) => {
          const w2 = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let tn: Node | null;
          while ((tn = w2.nextNode())) {
            const text = (tn.nodeValue || "").trim();
            if (!text || !cyr.test(text)) continue;
            const host = tn.parentElement;
            if (!host || seen.has(host)) continue;
            if (exemptSel.some((ex) => host.closest(ex))) continue;
            if (!visible(host)) continue;
            seen.add(host);
            cyrillic.push(`<${where(host)}>: ${JSON.stringify(text.slice(0, 120))}`);
          }
        });
      }

      /* --- <img> without alt --- */
      const noAlt: string[] = [];
      document.querySelectorAll("img").forEach((img) => {
        if (!img.hasAttribute("alt")) noAlt.push(`${where(img)} src=${img.getAttribute("src")}`);
      });

      /* --- duplicate ids --- */
      const ids = new Map<string, number>();
      document.querySelectorAll("[id]").forEach((el) => {
        if (el.id) ids.set(el.id, (ids.get(el.id) || 0) + 1);
      });
      const dupes = [...ids.entries()].filter(([, n]) => n > 1).map(([id, n]) => `#${id} ×${n}`);

      /* --- horizontal overflow --- */
      const doc = document.scrollingElement || document.documentElement;
      const scrollWidth = doc.scrollWidth;
      const innerWidth = window.innerWidth;
      /* Naming the widest offender turns "the page scrolls sideways" into
         something fixable without reproducing it by hand first. */
      let widest = "";
      if (scrollWidth > innerWidth) {
        let best = innerWidth;
        document.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          const right = r.right + window.scrollX;
          if (right > best + 0.5 && getComputedStyle(el).position !== "fixed") {
            best = right;
            widest = `${where(el)} right=${Math.round(right)}`;
          }
        });
      }

      return { leaks, cyrillic, noAlt, dupes, scrollWidth, innerWidth, widest };
    },
    [BAD_TEXT.map((b) => ({ src: b.rx.source, name: b.name })), CHROME_SELECTORS, CHROME_EXEMPT, CYRILLIC.source],
  );

  // 3) No leaked placeholder text.
  const allow = opts.allowText || [];
  const leaks = report.leaks.filter((line) => !allow.some((name) => line.startsWith(name + " in ")));
  expect(leaks, `${at} placeholder text on screen:\n${leaks.join("\n")}`).toEqual([]);

  // 4) No Cyrillic in the ET/EN chrome.
  if (ctx.lang !== "RU") {
    expect(report.cyrillic, `${at} untranslated Cyrillic in the UI chrome:\n${report.cyrillic.join("\n")}`).toEqual([]);
  }

  // 5) Every <img> carries an alt.
  expect(report.noAlt, `${at} <img> without an alt attribute:\n${report.noAlt.join("\n")}`).toEqual([]);

  // 6) No two elements share an id.
  expect(report.dupes, `${at} duplicate element ids: ${report.dupes.join(", ")}`).toEqual([]);

  // 7) No horizontal scroll at phone width.
  const viewport = page.viewportSize();
  if (!opts.allowHorizontalScroll && viewport && viewport.width <= 480) {
    expect(
      report.scrollWidth,
      `${at} page scrolls sideways: scrollWidth ${report.scrollWidth} > innerWidth ${report.innerWidth}` +
        (report.widest ? `\nwidest element: ${report.widest}` : ""),
    ).toBeLessThanOrEqual(report.innerWidth);
  }
}

/* ------------------------------------------------------------------------ */
/* Money formatting                                                          */
/* ------------------------------------------------------------------------ */

/** Everything the shop prints through `eur()` (app.js). Scoped deliberately:
 *  plain prose elsewhere legitimately says things like «26–56 € по прайсу
 *  DPD», and a blanket scan for "€" would fight that copy instead of the
 *  formatter. */
const MONEY_SELECTORS = [
  "[data-price]",
  ".card__price",
  ".cline__pr",
  ".cosum__pr",
  ".cosum__tot",
  ".cosum__row .num",
  ".opt__price",
  ".drawer__tot .num",
  ".stickybar__tot .num",
  ".upsell__row .num",
  ".co__pay",
];

/**
 * Every rendered price matches `eur()`'s contract exactly: "12,50 €" / "16 €"
 * in RU and ET, "€12.50" / "€16" in EN — never a dot separator in RU/ET, never
 * a lone decimal ("12,5 €"), never a trailing ",00", never "NaN €".
 */
export async function auditMoney(page: Page, ctx: Ctx): Promise<void> {
  const bad = await page.evaluate(
    (args) => {
      const [selectors, lang] = args as [string[], string];
      const out: string[] = [];
      const seen = new Set<Element>();
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);
          const text = (el.textContent || "").replace(/ /g, " ");
          if (!text.includes("€")) return;
          if (lang === "EN") {
            // "€12.50" / "€16" — the amount follows the sign.
            const re = /€\s*(\S+)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text))) {
              const token = m[1].replace(/^[−-]/, "").replace(/[.,;:!?)]+$/, "");
              if (!/^\d{1,7}(\.\d{2})?$/.test(token) || /\.00$/.test(token)) {
                out.push(`${sel} → ${JSON.stringify(text.trim().slice(0, 80))} (token ${JSON.stringify(m[1])})`);
              }
            }
          } else {
            // "12,50 €" / "16 €" — the amount precedes the sign.
            const re = /(\S+)\s*€/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text))) {
              const token = m[1].replace(/^[−-]/, "");
              if (!/^\d{1,7}(,\d{2})?$/.test(token) || /,00$/.test(token)) {
                out.push(`${sel} → ${JSON.stringify(text.trim().slice(0, 80))} (token ${JSON.stringify(m[1])})`);
              }
            }
          }
        });
      }
      return out;
    },
    [MONEY_SELECTORS, ctx.lang],
  );
  expect(bad, `${label(ctx)} price not formatted like eur() does:\n${bad.join("\n")}`).toEqual([]);
}

/* ------------------------------------------------------------------------ */
/* Dev-server warm-up                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Compiles every route the storefront touches, once, before anything is
 * audited.
 *
 * `next dev` compiles a route on its first hit, and *while it does*, other
 * requests can be answered 404 (the manifest is being rebuilt) or 500. That
 * is not the shop misbehaving, but it is indistinguishable from it in a
 * console log — and a `page.reload()` mid-checkout fires ten of these at once,
 * which is exactly the window. Hitting each one here, serially and outside
 * every assertion, means the tests only ever meet compiled routes.
 *
 * `/api/definitely-not-a-route/` is in the list on purpose: it is what forces
 * Next's own `/_not-found` entry to compile, and that one takes ~1.5s.
 *
 * Every call is best-effort — the status does not matter, only that the route
 * has been built. Nothing here asserts anything.
 */
export async function warmRoutes(request: APIRequestContext): Promise<void> {
  const routes = [
    "/api/definitely-not-a-route/",
    "/api/overrides/",
    "/api/geo/",
    "/api/blog/",
    "/api/reviews/?product=system-4-bio-botanical-shampoo",
    "/api/shipping/points/?country=EE&carrier=omniva",
    "/api/account/me/",
    "/api/payments/methods/",
    "/api/admin/me/",
  ];
  for (const route of routes) {
    await request.get(route, { timeout: 60_000 }).catch(() => {});
  }
  await request.post("/api/track/", { data: { t: "warmup" }, timeout: 60_000 }).catch(() => {});
}

/* ------------------------------------------------------------------------ */
/* Navigation                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Client-side navigation through the app's own router, without a page reload.
 *
 * `routeFromPath()` (app.js) is driven by `popstate`, and `render()`'s first
 * call in a burst is synchronous — so pushing the URL and dispatching the
 * event puts the new screen in the DOM before this returns. The two
 * `requestAnimationFrame`s after it let the coalesced trailing render (and
 * anything patched with it) land too.
 *
 * Why not `page.goto` for all ~250 screens: each cold load re-parses an
 * 845 KB app.js plus the 220-product catalogue, which puts the crawl well
 * over its runtime budget. The crawl still does a real `goto` for one screen
 * of every kind per language (`coldVisit`), so the boot path stays covered;
 * this is what walks the long tail.
 */
export async function clientNav(page: Page, url: string): Promise<void> {
  await page.evaluate(async (u) => {
    history.pushState({}, "", u);
    dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
  }, url);
}

/** A real navigation — the deep-link/boot path. */
export async function coldVisit(page: Page, url: string, screen: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator(`body[data-screen="${screen}"]`)).toBeAttached();
}

/** `waitForScreen`, but with the sweep's context in the failure message. */
export async function expectScreen(page: Page, screen: string, ctx: Ctx): Promise<void> {
  await expect(
    page.locator(`body[data-screen="${screen}"]`),
    `${label(ctx)} expected screen "${screen}"`,
  ).toBeAttached();
}

/* ------------------------------------------------------------------------ */
/* Catalogue data, read out of the running page                              */
/* ------------------------------------------------------------------------ */

export type CatProduct = { id: string; brand: string; cat: string; stock: string; sizes: number };

/** `CATALOGUE`, `CAT_NAMES` and `BUNDLES` are `const` declarations in
 *  /shop/catalogue2.js and /shop/bundles.js — script-level lexical bindings,
 *  so they are *not* properties of `window`, but a bare reference from an
 *  evaluated function resolves them exactly like any other script would. */
export async function readCatalogue(page: Page): Promise<{
  products: CatProduct[];
  cats: string[];
  brandSlugs: string[];
  bundles: string[];
}> {
  return page.evaluate(() => {
    const slugify = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const src = CATALOGUE as Array<Record<string, unknown>>;
    const cat = src.map((p) => ({
      id: p.id as string,
      brand: p.brand as string,
      cat: p.cat as string,
      stock: (p.stock as string) || "in",
      sizes: ((p.sizes as unknown[]) || []).length,
    }));
    return {
      products: cat,
      cats: Object.keys(CAT_NAMES),
      brandSlugs: [...new Set(cat.map((p) => slugify(p.brand)))].sort(),
      bundles:
        typeof BUNDLES === "undefined"
          ? []
          : (BUNDLES as Array<Record<string, unknown>>).map((b) => b.id as string),
    };
  });
}

declare const CATALOGUE: unknown;
declare const CAT_NAMES: Record<string, string>;
declare const BUNDLES: unknown;
