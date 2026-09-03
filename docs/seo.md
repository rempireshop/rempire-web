# SEO: URLs, prerendering, sitemap

The storefront is a vanilla-JS SPA (`public/shop2/`). A search engine indexes
what the HTML says before any script runs, so every page a shopper could land
on is written out as a static file, in all three languages, by
`tools/prerender-shop2.mjs`. app.js then takes over in the browser.

Nothing has been submitted to Google yet. The Search Console **domain property
for rempireshop.com is verified** (03.09.2026); the site switch happens later.
Everything below is generated against the staging base until then.

---

## URL scheme

Russian is the default and the `x-default`. It has **no prefix** — that is what
every old link, every legacy redirect and `docs/redirect-map.csv` already point
at, and changing it would have thrown away the whole existing link graph.

| | Russian | Estonian | English |
|---|---|---|---|
| home | `/shop2/` | `/shop2/et/` | `/shop2/en/` |
| category | `/shop2/c/<cat>/` | `/shop2/et/c/<cat>/` | `/shop2/en/c/<cat>/` |
| brand | `/shop2/b/<brand>/` | `/shop2/et/b/<brand>/` | `/shop2/en/b/<brand>/` |
| product | `/shop2/p/<id>/` | `/shop2/et/p/<id>/` | `/shop2/en/p/<id>/` |

`<cat>` is a catalogue key (`hair`, `styling`, `beard`, `face`, `body`,
`perfume`, `merch`) plus `all`. `<brand>` is the brand name slugified.
`<id>` is the product id from `public/shop/catalogue2.js`.

The other screens — `search`, `brands`, `account`, `checkout`, `done`, `admin`,
`info/<slug>`, `sets`, `set/<id>`, `gift` — are client-side only and take the
same prefixes (`/shop2/et/search/`). They are not prerendered and not in the
sitemap.

`/shop2/ru/...` is accepted by the router so a hand-typed URL still works, but
`next.config.ts` 301s it to the unprefixed path so it can never become a second
address for the same page.

### How the prefix behaves in app.js

All of this lives in the router / language region of `public/shop2/app.js`:

- **A prefix in the URL wins** over the saved preference and over
  `guessLang()`. It is what a search engine indexed and what a shopper pasted.
- **Internal navigation keeps the prefix.** `pathFor()` prepends
  `SEG_OF_LANG[pathLang]`, so a visitor who arrived on `/shop2/et/` stays inside
  the Estonian shop and the link they copy opens that way. Sharing a product
  (`productUrl`) does the same.
- **The switcher rewrites the prefix** with `history.replaceState` — not push,
  because Back should leave the shop rather than walk back through language
  changes.
- **Unprefixed links behave exactly as before**: saved choice, else browser
  language, else Russian, with the `/api/geo/` refinement on a first visit.
- **`routeFromPath()` reads the prefix on every navigation**, so Back into an
  entry written as `/shop2/et/…` returns to Estonian.
- `setAltTags()` rewrites canonical, the four `hreflang` links, `og:url` and
  `og:locale` on every render, so a crawler that runs JS reads the same head a
  static fetch does.

One deliberate asymmetry: **the canonical and the hreflang set come from the
path, never from the displayed language.** An unprefixed `/shop2/` stays
Russian for the crawler even when the visitor's browser has us rendering
English — otherwise a German browser would tell Google that `/shop2/` is the
English page. `<html lang>` follows the *displayed* language, because that one
is read by screen readers and by the browser's translate prompt.

The cost of that asymmetry: a crawler that runs JS with an `en-US` browser
fetches `/shop2/`, gets Russian HTML (correct), and then watches the script
re-render it in English while the canonical stays Russian. The served HTML and
the hreflang cluster are both right, and each language has its own URL to rank,
so this is a soft signal rather than a fault — but the clean fix, if it ever
matters, is an edge redirect on `Accept-Language` at the switch: send a browser
that asks for `et` from `/shop2/` to `/shop2/et/` with a 302 and `Vary:
Accept-Language`, and let the prefixed URLs be the only ones that render a
non-Russian page. That belongs to the switch, not to the client.

---

## Regenerating

```bash
# staging (what is committed now)
PUBLIC_BASE_URL=https://rempireshop.diipsolutions.eu npm run prerender

# at the switch
PUBLIC_BASE_URL=https://rempireshop.com npm run prerender

# then always
node tools/check-prerender.mjs
```

`PUBLIC_BASE_URL` defaults to `https://rempireshop.com`. The base decides two
things beyond the absolute URLs: a base on `rempireshop.com` writes
`robots: index, follow, max-image-preview:large` into every page, anything else
writes `noindex, nofollow`. Staging cannot leak into an index even if the
`X-Robots-Tag` header in `vercel.json` is ever dropped.

**Re-run it after anything that changes the catalogue, the translations or the
shell**: `tools/build-catalogue-full.mjs`, `tools/assemble-translations.mjs`,
or an edit to `public/shop2/index.html` (a new script, a bumped `?v=`). The run
is idempotent and takes under a second — it rewrites only the files whose
content actually changed and deletes pages for products that no longer exist.
`tools/check-prerender.mjs` fails loudly if the pages have drifted from
`index.html`.

Consider wiring it as a `prebuild` script when the build pipeline settles; it
was left manual during the parallel build wave.

### What it writes

| path | what |
|---|---|
| `public/shop2/index.html` | **patched in place** — the Russian home page (see below) |
| `public/shop2/{et,en}/index.html` | the other two home pages |
| `public/shop2/{,et/,en/}c/<cat>/index.html` | 8 categories × 3 |
| `public/shop2/{,et/,en/}b/<brand>/index.html` | 26 brands × 3 |
| `public/shop2/{,et/,en/}p/<id>/index.html` | 220 products × 3 |
| `public/sitemap.xml` | 765 URLs with `xhtml:link` alternates |
| `public/robots.production.txt` | the open policy, for the switch |

765 files. Above 1 000 sitemap URLs the tool switches by itself to a
`sitemapindex` at `public/sitemap.xml` plus `public/sitemap-N.xml` chunks.

Each page carries: `<html lang>`, a title of at most 60 characters, a
description of at most 160, `canonical`, `hreflang` ru/et/en/x-default,
OpenGraph and Twitter cards with the product image, and JSON-LD — `Product`
with `offers` (price, `EUR`, availability) and `BreadcrumbList` on product
pages, `BreadcrumbList` + `ItemList` on listings, `Organization` + `WebSite` on
the home pages. Inside `#app` it carries the real screen: breadcrumbs, brand,
`<h1>`, price, stock, sizes with per-size prices, the description, an `<img>`
with a real `alt`, and `<a>` links onward — which is the only path a crawler
has from a category to the 220 product pages.

### index.html is the shell *and* the Russian home page

Vercel serves `public/shop2/index.html` for `/shop2/`, and there is no way to
put a different file there. So that one file is **patched between markers**
rather than rewritten:

- `<!-- seo:start --> … <!-- seo:end -->` in `<head>` — the tool owns this.
- `<div id="app"><!-- prerender:start --> … <!-- prerender:end --></div>`.

Everything outside the markers is hand-maintained and survives every run: the
asset tags, the `?v=` token, the script list. The tool reads those from there
and copies them into the other 764 pages, so all of them always load the same
assets. If the markers go missing the tool refuses to run rather than guess.

The consequence: every non-prerendered `/shop2/` path (search, checkout, the
policy pages) is served that same file, so its raw HTML carries the home page's
head. app.js corrects the title, canonical and hreflang on boot. Those screens
are either robots-disallowed or not worth indexing; `info/<slug>` is the one
that would benefit from real prerendering later.

### Translation fidelity

The prerendered titles come from the dictionaries in app.js — the tool lifts
`UI`, `UI_RX`, `NAME_TAILS`, `NAME_FRAGS`, `TAIL_EXACT`, `trName` and `trText`
out of the source and evaluates them, rather than keeping a second copy that
would drift. Titles are built with the same `fitTitle()` ladder app.js uses, so
the tab does not change under the shopper when the script takes over. If the
slices ever stop matching (someone reshapes those declarations), the tool prints
a warning and falls back to Russian text in all three languages — check the
output of `npm run prerender` for a line starting with `!`.

### Hydration

app.js appends its slots next to `#prerender` instead of replacing `#app`, and
removes the prerendered block only once the first `render()` has filled them.
Boot is one synchronous task, so the browser never paints between the two and
the swap is invisible. If app.js fails to load, the static page stays up.

---

## Routing

`next.config.ts`:

- Vercel's static layer resolves `<dir>/index.html` for a trailing-slash URL by
  itself, in the filesystem phase — **before** any rewrite here. `next dev` and
  `next start` do not: they match `public/` paths exactly, so locally
  `/shop2/et/p/x/` used to fall through to the shell and `/shop2/` 404ed
  outright. `prerenderedRewrites()` closes that gap so local matches production.
- Those rewrites list the ids **read off disk**, not a bare `:id`. A
  parameterised rewrite would point every `/shop2/p/<anything>/` at a file, and
  a product added to the catalogue but not yet prerendered would 404 instead of
  rendering client-side. Listed this way, anything not on disk falls through to
  the `/shop2/:path+` shell rewrite. Next caps a rewrite source at 4 096
  characters, so the 220 ids are split across several rules.
- **The config is read once**, at dev-server start and at build. Restart `next
  dev` after `npm run prerender` or the new pages will not be routed locally.
- Legacy `/shop/...` paths still land on `/shop2/...`: `/shop`, `/shop/c/:cat`,
  `/shop/b/:brand`, `/shop/:screen`, and `/shop/info/:slug` (that last one used
  to 404). `/shop/p/<id>/` keeps its own prerendered pages — they carry the link
  previews the shop has been sharing and hand humans over with a script. At the
  switch, consider replacing them with 301s to `/shop2/p/<id>/`, which now has
  its own OpenGraph tags; that is a decision, not a leftover.

---

## At the switch

1. Regenerate with the live base and verify:
   ```bash
   PUBLIC_BASE_URL=https://rempireshop.com npm run prerender
   node tools/check-prerender.mjs
   ```
   Confirm the run printed `robots "index, follow, max-image-preview:large"`.
2. Replace `public/robots.txt` with `public/robots.production.txt` (the current
   file is the staging policy: everything closed to general crawlers, link-preview
   bots named individually).
3. Drop the blanket `X-Robots-Tag: noindex, nofollow, noarchive` header from
   `vercel.json`. It overrides everything above and nothing will be indexed
   while it is there.
4. Deploy, then check `https://rempireshop.com/robots.txt` and
   `https://rempireshop.com/sitemap.xml` return the live-domain versions.
5. **Google Search Console** — the domain property `rempireshop.com` is already
   verified, so nothing needs re-verifying:
   - Sitemaps → submit `sitemap.xml` (one entry; it is a plain urlset today and
     becomes a sitemapindex automatically above 1 000 URLs).
   - URL Inspection → Request indexing for `/shop2/`, `/shop2/et/`,
     `/shop2/en/` and a couple of top products, to prime the crawl.
   - International Targeting → watch for hreflang errors for a week or two;
     "no return tags" means one of the three pages is missing an alternate.
   - Coverage → expect the old Shopify `/products/...` URLs to move to
     "Page with redirect" as the redirects are picked up.
6. Redirects from the old Shopify URLs: **`docs/redirect-map.csv`** — 1 638
   rows, `old_url, new_path, kind, note`. It maps the live
   `https://rempireshop.com/...` URLs onto `/shop/...` paths, which the
   `/shop/...` → `/shop2/...` redirects above then carry the rest of the way.
   Implementing it (a redirects table or middleware) is separate work; the map
   is the source of truth for it.

## Known gaps

- `info/<slug>` (the policy pages) and `brands` are not prerendered; they render
  client-side with a corrected head. Worth adding if those pages should rank.
- `og:image` is the 1 200×630 card at `/shop/og/<id>.jpg` for the 95 products
  the old shop had, and the square product cutout for the other 125 — the card
  type follows the image (`summary_large_image` vs `summary`) rather than
  promising a wide crop that is not there. Generating the missing 125 cards is a
  follow-up for `tools/build-product-pages.mjs`.
- Product descriptions are AI translations pending a native proofread (see the
  header of `public/shop/content.ru.js`). They are what the meta descriptions
  are cut from.
