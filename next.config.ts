import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Prerendered shop pages (tools/prerender-shop2.mjs, `npm run prerender`).
 *
 * Vercel's static layer resolves <dir>/index.html for a trailing-slash URL on
 * its own, and it does that before any rewrite here runs. `next dev` and
 * `next start` do NOT — they match public/ paths exactly — so without these
 * rules a local /shop2/et/p/x/ falls through to the shell and the prerendered
 * page is only reachable at its .../index.html. These make local match
 * production.
 *
 * The ids are read off disk rather than left as a bare :id. A parameterised
 * rewrite would send every /shop2/p/<anything>/ at a file, and a product added
 * to the catalogue but not yet prerendered would 404 instead of rendering
 * client-side. Listed this way, anything not on disk simply falls through to
 * the shell rewrite below. Rebuild after `npm run prerender` — the config is
 * read once, at dev-server start and at build.
 */
function prerenderedRewrites() {
  const PUBLIC = path.join(process.cwd(), "public");
  const out: { source: string; destination: string }[] = [];

  /* Subdirectories of public/<rel> that actually hold an index.html. */
  const dirs = (rel: string) => {
    const full = path.join(PUBLIC, rel);
    if (!existsSync(full)) return [];
    return readdirSync(full, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(full, d.name, "index.html")))
      .map((d) => d.name)
      .filter((n) => /^[A-Za-z0-9._-]+$/.test(n));
  };

  /* Next refuses a rewrite whose built source is over 4096 characters, and 220
     product ids in one alternation is about 7.5 KB — so the list is split
     across as many rules as it takes. */
  const MAX = 3600;
  const group = (urlBase: string, rel: string) => {
    const ids = dirs(rel).map((i) => i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    let chunk: string[] = [];
    let len = 0;
    const flush = () => {
      if (chunk.length) {
        out.push({ source: `${urlBase}/:id(${chunk.join("|")})`, destination: `${urlBase}/:id/index.html` });
      }
      chunk = [];
      len = 0;
    };
    for (const id of ids) {
      if (len + id.length + 1 > MAX) flush();
      chunk.push(id);
      len += id.length + 1;
    }
    flush();
  };

  for (const prefix of ["", "/et", "/en"]) {
    const dir = path.join("shop2", prefix.slice(1));
    if (prefix && existsSync(path.join(PUBLIC, dir, "index.html"))) {
      out.push({ source: `/shop2${prefix}`, destination: `/shop2${prefix}/index.html` });
    }
    for (const kind of ["p", "c", "b"]) group(`/shop2${prefix}/${kind}`, path.join(dir, kind));
  }
  /* The old per-product pages under /shop/p/... — they carry the link previews
     the shop has been sharing and hand humans over with a script, so they have
     to keep answering locally too. */
  group("/shop/p", path.join("shop", "p"));
  // /shop2/ itself: public/shop2/index.html is not matched by the :path+ rule
  // below (it needs at least one segment), so a local /shop2/ used to 404
  out.push({ source: "/shop2", destination: "/shop2/index.html" });
  return out;
}

/* ---------- security headers -------------------------------------------
 *
 * A Content-Security-Policy is the difference between "one missed esc() is a
 * defaced string" and "one missed esc() is the customer list" — see
 * docs/audit/security-api.md H5. The policy below is written around what this
 * repository actually loads, verified against the built output:
 *
 *   · scripts   — every script in public/shop2/ is a file with a src. The two
 *                 <script type="application/ld+json"> blocks in the prerendered
 *                 pages are data, not code, and are not covered by script-src.
 *                 So /shop2/* gets a strict `script-src 'self'`.
 *                 Everything else needs 'unsafe-inline': Next's App Router
 *                 streams its flight payload through inline <script> tags on
 *                 /, /qa, /qa2, /demo, and the 95 legacy product pages under
 *                 public/shop/p/ hand humans over with an inline
 *                 location.replace(). Both are ours, neither renders untrusted
 *                 input; the admin panel — the one screen a stranger's text
 *                 reaches — is under /shop2/ and gets the strict policy.
 *   · styles    — app.js writes style="…" attributes on nearly every row, so
 *                 'unsafe-inline' is load-bearing here and cannot be dropped
 *                 without rewriting the renderer. Google Fonts is a stylesheet.
 *   · frames    — YouTube (nocookie) and Vimeo players on product pages.
 *   · connect   — only our own API. The Montonio hosts are listed because the
 *                 checkout hands the shopper over to them; the handover is a
 *                 navigation and a form post, not a fetch.
 *
 * Header rules are applied in order and the LAST match wins for a given key
 * (Next writes them with res.setHeader), so the general rule comes first and
 * the two narrower ones override it.
 */
const MONTONIO = "https://stargate.montonio.com https://sandbox-stargate.montonio.com";

function csp(scriptSrc: string, frameAncestors = "'none'"): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "media-src 'self' data: https:",
    "connect-src 'self' " + MONTONIO,
    "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com",
    "form-action 'self' " + MONTONIO,
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

/** The headers every response carries, whatever the CSP on top of it. */
function baseSecurityHeaders(frameOptions = "DENY") {
  return [
    { key: "X-Frame-Options", value: frameOptions },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), " +
        "geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()",
    },
    /* One year, subdomains included. `preload` is deliberately absent: it is
       submitted once and is painful to undo, and the domain move is not done —
       see docs/accounts.md. Add it after the move, not before. */
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  ];
}

/**
 * Serverful Next.js on Vercel: /api/submit persists questionnaire answers
 * (Vercel Blob) and forwards them to Telegram/email when tokens are set.
 * Static export was dropped for exactly this reason on 2026-08-21.
 */
const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  /**
   * The shop is one static page that now names its screen in the URL, so the
   * back button works and a category can be linked to. Those paths have no
   * files behind them — every one of them serves the same shell, which reads
   * the path back into its state on boot. Products are the exception: they
   * are written out per product for their link previews, so /shop/p/... is
   * already real and must not be swallowed here.
   */
  /* Design accepted 03.09: the round-two variant IS the shop. Every page
     route of the original prototype lands on its /shop2/ twin; the assets it
     shares (catalogue, images, content) stay where they are, and the
     prerendered /shop/p/... pages keep their link previews and hand humans
     over with a script. */
  /* SEO, 03.09: products, categories, brands and the three home pages are no
     longer shell-only — each is written out per language under public/shop2/
     by `npm run prerender`, and the language lives in the path (/shop2/ is
     Russian and the x-default, /shop2/et/… and /shop2/en/… the others). See
     prerenderedRewrites() above and docs/seo.md. */
  async headers() {
    return [
      /* Everything, including the Next-rendered pages and the legacy
         /shop/p/... redirect stubs, which carry an inline script. */
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp("'self' 'unsafe-inline'") },
          ...baseSecurityHeaders(),
        ],
      },
      /* The shop and the admin panel: no inline script anywhere, so no
         'unsafe-inline'. This is the rule that turns the class of innerHTML
         mistakes the audit found into a broken layout instead of a takeover. */
      {
        source: "/shop2",
        headers: [
          { key: "Content-Security-Policy", value: csp("'self'") },
          ...baseSecurityHeaders(),
        ],
      },
      {
        source: "/shop2/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp("'self'") },
          ...baseSecurityHeaders(),
        ],
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
    ];
  },
  async redirects() {
    return [
      { source: "/shop", destination: "/shop2/", permanent: false },
      { source: "/shop/c/:cat", destination: "/shop2/c/:cat/", permanent: false },
      { source: "/shop/b/:brand", destination: "/shop2/b/:brand/", permanent: false },
      { source: "/shop/:screen(search|brands|account|checkout|done|admin)", destination: "/shop2/:screen/", permanent: false },
      /* The policy pages moved with the rest; without this /shop/info/... was
         the one legacy path that 404ed instead of landing on its twin. */
      { source: "/shop/info/:slug", destination: "/shop2/info/:slug/", permanent: false },
      /* Russian is the default and has no prefix. /shop2/ru/... is accepted by
         the router so a hand-typed URL still works, but it must not become a
         second address for the same page. */
      { source: "/shop2/ru", destination: "/shop2/", permanent: true },
      { source: "/shop2/ru/:path*", destination: "/shop2/:path*/", permanent: true },
    ];
  },
  async rewrites() {
    return [
      { source: "/shop/c/:cat", destination: "/shop/index.html" },
      { source: "/shop/b/:brand", destination: "/shop/index.html" },
      { source: "/shop/:screen(search|brands|account|checkout|done|admin)", destination: "/shop/index.html" },
      /* Products, categories, brands and the three home pages are written out
         per language for search engines — those win. */
      ...prerenderedRewrites(),
      /* Everything else under /shop2/ — search, the cart, the account, the
         policy pages — is still one shell that reads the path back into its
         state on boot. index.html is both that shell and the Russian home
         page; see the comment at the top of the file. */
      { source: "/shop2/:path+", destination: "/shop2/index.html" },
    ];
  },
};

export default nextConfig;
