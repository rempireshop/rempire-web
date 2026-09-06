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
    /* p/c/b are the catalogue; info and set were added when the policy pages,
       the sets and the gift card stopped being shell-only. `set` is singular
       and `sets` is the landing — that is what pathFor() in app.js pushes, so
       that is what has to resolve. `blog` here is the per-post pages, one
       level under the listing (/shop2/blog/<slug>/) — the listing itself is
       the single page below, same shape as `sets`/`gift`. */
    for (const kind of ["p", "c", "b", "info", "set", "blog"]) {
      group(`/shop2${prefix}/${kind}`, path.join(dir, kind));
    }
    /* Single pages, so no alternation to build — but still listed off disk,
       so a run of `npm run prerender` that has not happened yet leaves them
       falling through to the shell rather than 404ing. */
    for (const one of ["sets", "gift", "blog"]) {
      if (existsSync(path.join(PUBLIC, dir, one, "index.html"))) {
        out.push({ source: `/shop2${prefix}/${one}`, destination: `/shop2${prefix}/${one}/index.html` });
      }
    }
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
 *   · frames    — YouTube (nocookie), Vimeo and Instagram players on product
 *                 pages. Instagram is here for the reel/post embed the goods
 *                 editor now accepts (docs/media.md, «Видео»): the frame src
 *                 is https://www.instagram.com/reel/<id>/embed/, built by
 *                 parseVideo() from an id and never from the pasted string.
 *                 Listed on the shared policy for the same reason the other
 *                 two are — the product page exists both under /shop2/* and
 *                 in the legacy /shop/p/ pages — and it grants nothing beyond
 *                 "a frame may point at instagram.com".
 *   · connect   — only our own API. The Montonio hosts are listed because the
 *                 checkout hands the shopper over to them; the handover is a
 *                 navigation and a form post, not a fetch.
 *
 * Header rules are applied in order and the LAST match wins for a given key
 * (Next writes them with res.setHeader), so the general rule comes first and
 * the two narrower ones override it.
 */
const MONTONIO = "https://stargate.montonio.com https://sandbox-stargate.montonio.com";

/* Cloudflare Web Analytics beacon — analytics agent, docs/analytics.md. The
 * owner adds the site in Cloudflare and pastes the token that comes back over
 * the CF_BEACON_TOKEN placeholder in public/shop2/index.html; the script tag
 * is already there either way, so this CSP allowance is needed as soon as a
 * token is filled in, not something to remember to add later. The script
 * itself loads from the "static." subdomain, but the beacon's own reporting
 * call lands on the bare domain — both are allowed so a mismatch here cannot
 * silently turn "token filled in" into "blocked by our own CSP". /shop2/*
 * only: this must never widen the strict default policy everywhere else. */
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

/** Locked down everywhere by default — see SHOP2_PERMISSIONS_POLICY below for the one exception. */
const DEFAULT_PERMISSIONS_POLICY =
  "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), " +
  "geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()";

/**
 * inventory: the admin's barcode scanner needs the camera — BarcodeDetector
 * or the zxing fallback both read frames off a same-origin <video> fed by
 * getUserMedia (public/shop2/app.js, scanMount()/startNativeEngine()). Same
 * default-deny policy as everywhere else, with `camera=(self)` as the one
 * opening: no third party, no cross-origin frame, gets it either. Every
 * other permission — microphone, geolocation, usb, payment, … — stays
 * denied under /shop2/* exactly like it is everywhere else.
 */
const SHOP2_PERMISSIONS_POLICY = DEFAULT_PERMISSIONS_POLICY.replace("camera=()", "camera=(self)");

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
   * The printable gift card (src/lib/giftcard-pdf.ts) reads three TTFs and the
   * brand's tower path off disk at run time. Everything under public/ is
   * uploaded to Vercel's static layer, which a serverless function cannot read
   * — the tracer has to be told, because the paths are built at run time and
   * nothing in the source names the files literally.
   *
   * Listed per route family rather than globally: the two routes that make a
   * PDF (the download and the payment callbacks, whose mail hook attaches one)
   * plus the admin order screen's data. ~215 KB of fonts, once each.
   */
  outputFileTracingIncludes: {
    "/api/giftcards/**": ["./public/fonts/*.ttf", "./public/brand/rempire-tower.svg"],
    "/api/payments/**": ["./public/fonts/*.ttf", "./public/brand/rempire-tower.svg"],
    "/api/admin/orders/**": ["./public/fonts/*.ttf", "./public/brand/rempire-tower.svg"],
    /* A custom product's page is the shell patched at request time
       (src/lib/product-page.ts, the /shop2/{,et/,en/}p/[id] routes) — the
       function has to be able to read the file the static layer serves. The
       blog pages a build did not write (src/lib/blog-page.ts) patch the same
       shell. */
    "/shop2/**": ["./public/shop2/index.html"],
    /* The link-preview card drawn at request time (src/lib/og-card.ts):
       the glyphs come out of the committed fonts and the mark out of the
       brand SVG, none of which the source names literally. */
    "/shop2/og/**": ["./public/fonts/*.ttf", "./public/brand/rempire-tower.svg"],
  },
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
  /* SEO, 03.09: products, categories, brands, the three home pages, the five
     policy pages, the sets and the gift card are no longer shell-only — each
     is written out per language under public/shop2/ by `npm run prerender`,
     and the language lives in the path (/shop2/ is Russian and the x-default,
     /shop2/et/… and /shop2/en/… the others). See prerenderedRewrites() above
     and docs/seo.md. */
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
      /* The design archive — the eight directions, the motion study, the
         Opus page — is written in JSX that Babel compiles in the browser and
         runs through new Function, so it is the one place that needs
         'unsafe-eval'. It renders only its own files (React and Babel are
         vendored under /vendor/react/ — the CDN they used to load from is
         not on the policy), takes no input, and is noindex; the shop, the
         admin and the API keep the strict policy above. */
      {
        source: "/prototypes/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp("'self' 'unsafe-inline' 'unsafe-eval'") },
          ...baseSecurityHeaders(),
        ],
      },
      /* Keep search engines out of everything that is not the shop's own
         domain. This used to be a global `X-Robots-Tag: noindex, nofollow,
         noarchive` on `/(.*)` in vercel.json, from the days when the whole
         thing was a prototype nobody should find. Left there it would have
         quietly outranked every canonical, hreflang and sitemap on the
         production domain the day the DNS moved (audit row 9, docs/seo.md).

         `missing` inverts the host test into an ALLOWLIST: the header is sent
         unless the host is rempireshop.com or www.rempireshop.com. The old
         `has` version was a denylist — it named *.vercel.app and the staging
         host, so anything it did not name (a new preview alias, a custom
         staging domain, an IP, a copy someone points at the app) was indexable
         by default. This way a host nobody thought about is closed, which is
         the same rule the `<meta name="robots">` layer and robots.txt already
         follow (docs/seo.md, "The three noindex layers").

         Next compiles the value as `^…$` itself; the anchors are written here
         too so the intent survives a copy-paste. A request with no Host header
         matches nothing and therefore gets the header — the safe direction. */
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
      /* The shop and the admin panel: no inline script anywhere, so no
         'unsafe-inline'. This is the rule that turns the class of innerHTML
         mistakes the audit found into a broken layout instead of a takeover. */
      {
        source: "/shop2",
        headers: [
          { key: "Content-Security-Policy", value: csp(`'self' ${CF_BEACON_SCRIPT}`, "'none'", CF_BEACON_CONNECT) },
          ...baseSecurityHeaders("DENY", SHOP2_PERMISSIONS_POLICY),
        ],
      },
      {
        source: "/shop2/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp(`'self' ${CF_BEACON_SCRIPT}`, "'none'", CF_BEACON_CONNECT) },
          ...baseSecurityHeaders("DENY", SHOP2_PERMISSIONS_POLICY),
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
  /* Three phases, not one list. A plain array is `afterFiles`, which Next
     checks BEFORE its dynamic routes — and the shell rewrite in it would have
     swallowed src/app/shop2/{,et/,en/}p/[id]/route.ts, the request-time page
     of a product the owner created in the panel (src/lib/product-page.ts).
     So: the prerendered files first (afterFiles — a file on disk beats
     everything), the dynamic /p/[id] routes next (Next's own order), and the
     shell for whatever is left (fallback). */
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/shop/c/:cat", destination: "/shop/index.html" },
        { source: "/shop/b/:brand", destination: "/shop/index.html" },
        { source: "/shop/:screen(search|brands|account|checkout|done|admin)", destination: "/shop/index.html" },
        /* Products, categories, brands and the three home pages are written out
           per language for search engines — those win. */
        ...prerenderedRewrites(),
      ],
      /* Everything else under /shop2/ — search, the cart, the account, the
         checkout, the receipt, the admin — is still one shell that reads the
         path back into its state on boot. Those need state to mean anything,
         they are robots-disallowed, and none of them is prerendered or in the
         sitemap. index.html is both that shell and the Russian home page; see
         the comment at the top of the file. A /p/<id>/ that is neither on
         disk nor a custom product never gets here: the [id] route answers it
         with this same shell. */
      fallback: [{ source: "/shop2/:path+", destination: "/shop2/index.html" }],
    };
  },
};

export default nextConfig;
