import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Prerendered shop pages (tools/prerender-shop2.mjs, `npm run prerender`).
 *
 * Since 08.10.2026 the shop answers at Shopify's own addresses
 * (src/lib/shop-paths.mjs) — `/products/<id>`, `/ru/collections/<handle>`,
 * `/policies/refund-policy` — while the files the prerender writes stay where
 * the build has always put them, under public/shop2/ in the shop's internal
 * route shape (`shop2/ru/p/<id>/index.html`, `shop2/c/hair/index.html`). So
 * every page needs a rewrite from its address to its file, on Vercel as much
 * as locally: neither layer could guess that /et/collections/juuksehooldus
 * lives in shop2/et/c/hair/.
 *
 * The prerender writes the list of what it wrote, address → file, to
 * src/data/prerendered-routes.json (gitignored — every build regenerates it,
 * before `next build` reads this file). Reading the list rather than the
 * directories keeps the address scheme in one module: this file never learns
 * that hair is «uhod-za-volosami» in Russian.
 *
 * Only what is on disk is routed. A product added to the catalogue but not
 * yet prerendered falls through to the request-time route
 * (src/app/{,ru/,et/}products/[id]) instead of 404ing on a missing file, and
 * a fresh clone that has never run the prerender still serves the shell
 * everywhere (src/app/[...path]). The config is read once, at dev-server start
 * and at build — restart `next dev` after `npm run prerender`.
 */
function prerenderedRewrites() {
  const out: { source: string; destination: string }[] = [];
  let pages: Array<[string, string]> = [];
  try {
    const file = path.join(process.cwd(), "src", "data", "prerendered-routes.json");
    if (existsSync(file)) pages = (JSON.parse(readFileSync(file, "utf8")) as { pages?: Array<[string, string]> }).pages ?? [];
  } catch {
    pages = [];
  }
  /* A page whose file has gone since the list was written must not be routed
     to a 404 — the request-time routes answer it instead. */
  const PUBLIC = path.join(process.cwd(), "public");
  pages = pages.filter(([, dest]) => existsSync(path.join(PUBLIC, dest)));

  /* `/products/<id>` → `/shop2/p/<id>/index.html` for 220 ids is one rule with
     an alternation, not 220 rules; the same for brands, sets, blog posts and
     the two prefixed homes. Next refuses a rewrite whose built source is over
     4 096 characters, so a long alternation is split across as many rules as
     it takes. Everything else (a section, whose handle differs from its
     folder; a policy page; the gift card) is a literal rule of its own. */
  const MAX = 3600;
  const groups = new Map<string, { from: string; to: string; ids: string[] }>();
  for (const [source, destination] of pages) {
    const cut = source.lastIndexOf("/");
    const id = source.slice(cut + 1);
    const tail = "/" + id + "/index.html";
    if (id && /^[A-Za-z0-9._-]+$/.test(id) && destination.endsWith(tail)) {
      const from = source.slice(0, cut);
      const to = destination.slice(0, -tail.length);
      const key = from + "|" + to;
      if (!groups.has(key)) groups.set(key, { from, to, ids: [] });
      groups.get(key)!.ids.push(id);
    } else {
      out.push({ source, destination });
    }
  }
  for (const { from, to, ids } of groups.values()) {
    if (ids.length === 1) {
      out.push({ source: from + "/" + ids[0], destination: to + "/" + ids[0] + "/index.html" });
      continue;
    }
    let chunk: string[] = [];
    let len = 0;
    const flush = () => {
      if (chunk.length) out.push({ source: `${from}/:id(${chunk.join("|")})`, destination: `${to}/:id/index.html` });
      chunk = [];
      len = 0;
    };
    for (const raw of ids) {
      const id = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (len + id.length + 1 > MAX) flush();
      chunk.push(id);
      len += id.length + 1;
    }
    flush();
  }
  /* The English home page is the shell itself, which is committed — so «/» is
     routed even before the first prerender. */
  if (!out.some((r) => r.source === "/")) out.push({ source: "/", destination: "/shop2/index.html" });

  /* The hand-written pages under public/ that are not part of the shop:
     /guide (what the rebuild does), /cards (the product-card options), /test
     (the acceptance checklist Renat and Dim fill in) and /golive (what is
     left before launch, and the lock on the domain switch). Neither Vercel
     nor `next start` serves a directory's index.html for a slashless address,
     and no page address has a slash any more. */
  for (const page of ["guide", "cards", "test", "golive"]) {
    if (existsSync(path.join(PUBLIC, page, "index.html"))) {
      out.push({ source: `/${page}`, destination: `/${page}/index.html` });
    }
  }
  return out;
}

/* ---------- security headers -------------------------------------------
 *
 * A Content-Security-Policy is the difference between "one missed esc() is a
 * defaced string" and "one missed esc() is the customer list" — see
 * docs/audit/security-api.md H5. The policy below is written around what this
 * repository actually loads, verified against the built output:
 *
 *   · scripts   — every script the shop loads is a file with a src. The
 *                 <script type="application/ld+json"> blocks in the
 *                 prerendered pages are data, not code, and are not covered by
 *                 script-src. So every page gets a strict `script-src 'self'`
 *                 — since 08.10.2026 the shop's pages are the whole site
 *                 (/, /products/…, /ru/…, /admin), so the strict policy is the
 *                 DEFAULT and the loose one is the named exception: the API
 *                 (a few routes answer HTML of their own — the unsubscribe
 *                 page, the letter previews) and the four hand-written pages
 *                 (/test, /guide, /cards, /golive), which carry an inline
 *                 script each, keep 'unsafe-inline'. Both are ours, neither
 *                 renders untrusted input; the admin panel — the one screen a
 *                 stranger's text reaches — is on the strict policy.
 *   · styles    — app.js writes style="…" attributes on nearly every row, so
 *                 'unsafe-inline' is load-bearing here and cannot be dropped
 *                 without rewriting the renderer. Google Fonts is a stylesheet.
 *   · frames    — YouTube (nocookie), Vimeo and Instagram players on product
 *                 pages. Instagram is here for the reel/post embed the goods
 *                 editor now accepts (docs/media.md, «Видео»): the frame src
 *                 is https://www.instagram.com/reel/<id>/embed/, built by
 *                 parseVideo() from an id and never from the pasted string.
 *   · connect   — only our own API. The Montonio hosts are listed because the
 *                 checkout hands the shopper over to them; the handover is a
 *                 navigation and a form post, not a fetch.
 *
 * Header rules are applied in order and the LAST match wins for a given key
 * (Next writes them with res.setHeader), so the general rule comes first and
 * the narrower ones override it.
 */
const MONTONIO = "https://stargate.montonio.com https://sandbox-stargate.montonio.com";

/* Cloudflare Web Analytics beacon — analytics agent, docs/analytics.md. The
 * owner adds the site in Cloudflare and pastes the token that comes back over
 * the CF_BEACON_TOKEN placeholder in public/shop2/index.html; the script tag
 * is already there either way, so this CSP allowance is needed as soon as a
 * token is filled in, not something to remember to add later. The script
 * itself loads from the "static." subdomain, but the beacon's own reporting
 * call lands on the bare domain — both are allowed so a mismatch here cannot
 * silently turn "token filled in" into "blocked by our own CSP". The shop's
 * pages only: this never widens the policy of the API. */
const CF_BEACON_SCRIPT = "https://static.cloudflareinsights.com";
const CF_BEACON_CONNECT = "https://static.cloudflareinsights.com https://cloudflareinsights.com";

function csp(scriptSrc: string, frameAncestors = "'none'", connectExtra = ""): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "media-src 'self' data: https:",
    "connect-src 'self' " + [MONTONIO, connectExtra].filter(Boolean).join(" "),
    "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com " +
      "https://www.instagram.com https://instagram.com",
    "form-action 'self' " + MONTONIO,
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

/** Locked down everywhere by default — see SHOP_PERMISSIONS_POLICY below for the two exceptions. */
const DEFAULT_PERMISSIONS_POLICY =
  "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), " +
  "geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()";

/**
 * inventory: the admin's barcode scanner needs the camera — BarcodeDetector
 * or the zxing fallback both read frames off a same-origin <video> fed by
 * getUserMedia (public/shop2/app.js, scanMount()/startNativeEngine()). Same
 * default-deny policy as everywhere else, with `camera=(self)` as the one
 * opening: no third party, no cross-origin frame, gets it either.
 *
 * The microphone, the same way (12.09.2026): the admin assistant's voice
 * input (app.js admVoiceStart, the browser's own SpeechRecognition) needs
 * it, and `microphone=()` blocked the API outright — every tap of the mic
 * ended in `not-allowed` before the browser could even ask the owner (Dim's
 * S21 FE: «Нет доступа к микрофону», no prompt, ever). `(self)` lets the page
 * ask; the owner still answers the prompt himself. Every other permission —
 * geolocation, usb, payment, … — stays denied on the shop's pages exactly
 * like it is everywhere else, and both openings are ours alone.
 */
const SHOP_PERMISSIONS_POLICY = DEFAULT_PERMISSIONS_POLICY
  .replace("camera=()", "camera=(self)")
  .replace("microphone=()", "microphone=(self)");

/** The headers every response carries, whatever the CSP on top of it. */
function baseSecurityHeaders(frameOptions = "DENY", permissionsPolicy = DEFAULT_PERMISSIONS_POLICY) {
  return [
    { key: "X-Frame-Options", value: frameOptions },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: permissionsPolicy },
    /* One year, subdomains included. `preload` is deliberately absent: it is
       submitted once and is painful to undo, and the domain move is not done —
       see docs/accounts.md. Add it after the move, not before. */
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  ];
}

/** The shop's own policy: no inline script anywhere. */
const SHOP_HEADERS = [
  { key: "Content-Security-Policy", value: csp(`'self' ${CF_BEACON_SCRIPT}`, "'none'", CF_BEACON_CONNECT) },
  ...baseSecurityHeaders("DENY", SHOP_PERMISSIONS_POLICY),
];
/** The API's and the hand-written pages': an inline script is allowed, nothing is opened. */
const LOOSE_HEADERS = [
  { key: "Content-Security-Policy", value: csp("'self' 'unsafe-inline'") },
  ...baseSecurityHeaders(),
];

/**
 * Serverful Next.js on Vercel. Static export was dropped on 2026-08-21 (for
 * the questionnaire's /api/submit, since retired) and is no longer possible
 * anyway: ~70 API routes, the request-time product and blog pages, the OG
 * card renderer and two cron jobs all need a running function.
 */
const nextConfig: NextConfig = {
  /* No page address ends in a slash — Shopify's scheme, 08.10.2026. Next's
     own normalisation would answer `/products/x/` with a 308 and, worse,
     `/api/payments/notify` the same way, so it is switched off and
     src/middleware.ts does the job instead: a page address with a slash gets
     ONE 301 to the slashless page (folded into whatever other move it needs),
     and an API route answers both spellings with no redirect at all —
     Montonio POSTs to /api/payments/notify/ and the parcel webhook is
     registered at /api/shipping/notify/, and a redirect loses a POST. */
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  /**
   * The printable gift card (src/lib/giftcard-pdf.ts) and the link-preview
   * card (src/lib/og-card.ts) read three TTFs and the brand's tower path off
   * disk at run time. Everything under public/ is uploaded to Vercel's static
   * layer, which a serverless function cannot read — the tracer has to be
   * told, because those paths are built at run time and nothing in the source
   * names the files literally.
   *
   * This used to be a hand-kept list of the route families that make a
   * document. It was wrong, and the way it was wrong is the reason it is no
   * longer a list. `drawSlip()` — the A4 shipping label's band, carrying the
   * order number and the drop-off code in figures big enough to read at the
   * counter — was added on 13.09.2026 and `/api/admin/shipments/**` was not.
   * On the stand the band came out reserved and blank, because `readAsset()`
   * threw `asset_missing` and `drawSlipSafely()` swallowed it exactly as it is
   * meant to. Six days later the owner wrote: «no drop-off code for the locker
   * is shown. the address or any other information from order is not printed
   * on the PDF». Nothing could have caught it: on a developer's disk and in
   * the suite `process.cwd()` is the repository and public/fonts/ is simply
   * there.
   *
   * And the list could not have been kept right by being more careful, either.
   * 85 of this shop's 102 routes can reach one of those two modules through
   * their imports — `src/lib/customers.ts` alone pulls the gift-card PDF in
   * for the letters it sends — so the honest set was always «nearly all of
   * them». ~215 KB of fonts per function is the whole price, and a blank label
   * at the post office is not worth saving it. tests/asset-tracing.test.ts
   * walks the same graph and fails if a route that can read from public/ ever
   * falls outside these keys again.
   */
  outputFileTracingIncludes: {
    "/api/**": ["./public/fonts/*.ttf", "./public/brand/rempire-tower.svg"],
    /* Every page route — the request-time product and blog pages
       (src/lib/product-page.ts, src/lib/blog-page.ts), the catch-all that
       serves the shell and the 404 (src/app/[...path]), /shop2/og/** which
       draws the preview cards from the fonts, the sitemaps, the feeds and
       Merchant Center's «Checkout» link (they reach the letters and so the
       gift-card PDF) — patches or reads the same files. Since 08.10.2026 those
       routes sit at the root of the site, so the key is the root. */
    "/**": ["./public/shop2/index.html", "./public/fonts/*.ttf", "./public/brand/rempire-tower.svg"],
  },
  async headers() {
    return [
      /* Every page of the shop — wherever it lives now — and the admin. This is
         the rule that turns the class of innerHTML mistakes the audit found
         into a broken layout instead of a takeover. */
      { source: "/:path*", headers: SHOP_HEADERS },
      /* The API, the prototype's leftover files under /shop/ and the four
         hand-written pages: see the note above. */
      { source: "/api/:path*", headers: LOOSE_HEADERS },
      { source: "/shop/:path*", headers: LOOSE_HEADERS },
      { source: "/:page(test|guide|cards|golive)", headers: LOOSE_HEADERS },
      { source: "/:page(test|guide|cards|golive)/:path*", headers: LOOSE_HEADERS },
      /* Keep search engines out of everything that is not the shop's own
         domain. `missing` inverts the host test into an ALLOWLIST: the header
         is sent unless the host is rempireshop.com or www.rempireshop.com, so
         a host nobody thought about (a preview alias, the staging domain, an
         IP) is closed — the same rule the `<meta name="robots">` layer and
         robots.txt follow (docs/seo.md, "The three noindex layers"). A request
         with no Host header matches nothing and therefore gets the header —
         the safe direction. */
      {
        source: "/:path*",
        missing: [
          {
            type: "host",
            value: "^(www\\.)?rempireshop\\.com$",
          },
        ],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      /* The panel's service worker is served from /shop2/admin-sw.js (an
         asset — assets did not move) and controls /admin, which is outside
         its own folder: a worker may only take a scope above its path when
         the response says so. */
      {
        source: "/shop2/admin-sw.js",
        headers: [{ key: "Service-Worker-Allowed", value: "/admin" }],
      },
      /* The shop's scripts and stylesheets are linked with the shared ?v=
         token — twelve hex characters of a hash of those very files
         (tools/lib/asset-token.mjs) — so an address that carries it can never
         answer other bytes: a changed file is a changed token, which is a new
         address. A browser may keep such a response for a year without asking
         again. Until 09.10.2026 every one of them went out as `public,
         max-age=0, must-revalidate`, and a returning visitor paid one round
         trip per file to hear «not modified» before anything could paint
         (fourteen of them; 150 ms each on a phone, perf audit).
         Only .js and .css under /shop/ and /shop2/, and only with the token's
         exact shape: a picture on its own ?v=5, a file asked for without a
         token, and every page keep the host's revalidating default. */
      {
        source: "/:dir(shop|shop2)/:file([^/]+\\.(?:js|css))",
        has: [{ type: "query", key: "v", value: "^[0-9a-f]{12}$" }],
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      /* The one page the shop frames itself: «Письма» in the admin shows the
         real templates in an <iframe>. frame-ancestors 'none' would blank it. */
      {
        source: "/api/admin/mail/preview/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp("'self' 'unsafe-inline'", "'self'") },
          ...baseSecurityHeaders("SAMEORIGIN"),
        ],
      },
      /* «Маркетинг → Рассылка» frames the owner's own draft the same way
         («Письмо целиком», src/app/api/admin/newsletters/[id]/preview/).
         Only the framing is relaxed: a letter carries inline styles, which
         style-src already allows everywhere, and no script at all — so
         script-src stays at 'self', tighter than the API's own rule. */
      {
        source: "/api/admin/newsletters/:id/preview/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp("'self'", "'self'") },
          ...baseSecurityHeaders("SAMEORIGIN"),
        ],
      },
    ];
  },
  /* The shop's own moves — /shop2/…, /shop/…, Shopify's other spellings, a
     trailing slash — are src/middleware.ts's: they are lookups, and each is
     ONE 301. What is left here are the hand-written pages at the name a human
     types. Dim asked for the checklist twice as /tests before anyone noticed
     the page is at /test; a page whose whole job is to be opened on a phone
     from a chat message cannot 404 on the plural. Same for the other two, and
     for /karty — the page is Russian, so a Russian spelling is a fair guess. */
  async redirects() {
    return [
      { source: "/tests", destination: "/test", permanent: false },
      { source: "/checklist", destination: "/test", permanent: false },
      { source: "/card", destination: "/cards", permanent: false },
      { source: "/karty", destination: "/cards", permanent: false },
      { source: "/guides", destination: "/guide", permanent: false },
    ];
  },
  /* The prerendered files are `afterFiles` rewrites: a file on disk beats
     every route. Next's dynamic routes come after them — the request-time
     product and blog pages (src/app/{,ru/,et/}products/[id],
     src/app/{,ru/,et/}blogs/news/…) and, last, src/app/[...path], which
     serves the shell for the screens that live only in the browser (/search,
     /checkout, /admin …) and the shop's 404 for everything else. */
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: prerenderedRewrites(),
      fallback: [],
    };
  },
};

export default nextConfig;
