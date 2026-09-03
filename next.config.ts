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
