# SEO: URLs, prerendering, sitemap

The storefront is a vanilla-JS SPA (`public/shop2/`). A search engine indexes
what the HTML says before any script runs, so every page a shopper could land
on is written out as a static file, in all three languages, by
`tools/prerender-shop2.mjs`. app.js then takes over in the browser.

**831 pages** — 277 per language: 220 products, 8 categories plus `all`, 6
subcollections (since 09.10.2026, «Subcollections» below), 26 brands **and the
brands landing**, the home page, the 5 policy pages, 8 sets plus their
landing, and the gift card (fewer when the database has no set or post on
sale). Every one of them carries a 1 200×630 link-preview card that
exists on disk. Verify with `npm run prerender:check`.

The shop went live on rempireshop.com on 08.10.2026 at 22:55, at `/shop2/…`
addresses, and moved to **Shopify's own addresses** the same night — see
«URL move 2026-10 (Shopify scheme)» below for every decision and its
evidence.

---

## URL scheme

Shopify's addresses, exactly (Dim, 08.10.2026: «There was no shop2 on the site
— the URLs need to be as they were previously»). **English has no prefix** and
is the `x-default`, as it was on Shopify; Russian is `/ru`, Estonian `/et`. No
page address ends in a slash. The whole table lives in one module,
`src/lib/shop-paths.mjs` (`publicPath()` / `parseShopPath()`), mirrored in ES5
in `public/shop2/app.js` (`shopPathFor()` / `shopRouteOf()`);
`tests/shop-paths.test.ts` runs both over the same addresses.

| | English | Russian | Estonian |
|---|---|---|---|
| home | `/` | `/ru` | `/et` |
| product | `/products/<id>` | `/ru/products/<id>` | `/et/products/<id>` |
| section | `/collections/hair-care` | `/ru/collections/uhod-za-volosami` | `/et/collections/juuksehooldus` |
| «Все товары» | `/collections/all-products` | `/ru/collections/vse-tovary` | `/et/collections/koik-tooted` |
| subcollection (6, «Subcollections» below) | `/collections/beard-oil` | `/ru/collections/maslo-dlya-borody` | `/et/collections/habemeolid` |
| brand | `/collections/<brand>` | `/ru/collections/<brand>` | `/et/collections/<brand>` |
| brands landing | `/collections/brands` | `/ru/collections/brands` | `/et/collections/brands` |
| policy pages | `/policies/shipping-policy`, `/policies/refund-policy`, `/policies/privacy-policy`, `/policies/terms-of-service` | `/ru/policies/…` | `/et/policies/…` |
| contact | `/pages/contact` | `/ru/pages/contact` | `/et/pages/contact` |
| blog | `/blogs/news`, `/blogs/news/<slug>` | `/ru/blogs/news…` | `/et/blogs/news…` |
| sets | `/collections/sets`, `/collections/sets/<id>` | `/ru/collections/sets…` | `/et/collections/sets…` |
| gift card | `/products/gift-card` | `/ru/products/gift-card` | `/et/products/gift-card` |
| search · account · basket · checkout · receipt | `/search?q=…` · `/account` · `/cart` · `/checkout` · `/checkout/done?n=…` | `/ru/…` | `/et/…` |
| the panel · the scanner | `/admin` · `/admin/scan` (one address in every language) | | |

The sections' handles per language:

| section | English | Russian | Estonian |
|---|---|---|---|
| hair | `hair-care` | `uhod-za-volosami` | `juuksehooldus` |
| styling | `hair-styling` | `stayling-dlya-volos` | `viimistlus` |
| beard | `beard-care` | `uhod-za-borodoy` | `habemehooldus` |
| face | `face-care` | `uhod-za-litsom` | `naohooldus` |
| body | `body-care` | `uhod-za-telom` | `kehahooldus` |
| perfume | `perfume` | `parfyumeriya` | `parfuumid` |
| merch | `merch` | `merch` | `merch` |
| all | `all-products` | `vse-tovary` | `koik-tooted` |

`<brand>` is the brand name slugified (the same in every language, as
Shopify's brand collections were), except CBD Daily, whose Shopify collection
was `cbd-daily-haircare` and keeps that address. `<id>` is the product id from
`public/shop/catalogue2.js` (Shopify's handle, for the 220 products that came
over), or a custom product's `c-…`.

**Inside the shop nothing speaks these addresses.** app.js, the prerender, the
request-time pages, the sitemaps, the feeds and the letters all build an
internal ROUTE — the short shape of the old `/shop2/` scheme: `/p/<id>/`,
`/c/hair/`, `/b/<brand>/`, `/info/returns/`, `/sets/`, `/set/<id>/`, `/gift/`,
`/brands/`, `/blog/<slug>/`, `/search/`, `/account/`, `/checkout/`, `/done/`,
`/cart/`, `/admin/`, `/scan/`, `/` — and hand it to `publicPath(lang, route)`
(`langPath(seg, route)` in `src/lib/seo-head.mjs`, which takes the language's
prefix: `""` English, `ru`, `et`). So the address scheme is one table in one
file, and the prerendered files keep their internal folders
(`public/shop2/{,ru/,et/}{p,c,b,info,…}/…/index.html` — English at the top).

The remaining screens — `search`, `account`, `cart`, `checkout`, `done`,
`admin`, `scan` — are client-side only and take the same prefixes
(`/et/search`). They are deliberately **not** prerendered and **not** in the
sitemap: every one of them needs state to mean anything, every one is
robots-disallowed, and a static copy of them would be a page that lies.
`tools/prerender-shop2.mjs` throws if one of them ever reaches the sitemap,
and `check-prerender.mjs` fails if one is found there. `/cart` is Shopify's
basket page: it opens the home page with the basket drawer pulled out (the
basket is a drawer here), and `/cart/<item>:<qty>` is Merchant Center's
checkout link (`src/lib/cart-permalink.ts`).

### The language of a page is its address

SEO audit, 08.10.2026: until the move an unprefixed page RE-RENDERED in the
browser's language (`guessLang()` in app.js) — an English browser on the
Russian address got an English title, `<h1>` and `lang="en"` under a Russian
canonical, and Googlebot renders with an en-US locale. Now:

- **A storefront page renders in its address's language and nothing else** —
  title, description, `<h1>`, JSON-LD, `<html lang>`, hreflang. Unprefixed is
  English. app.js reads the language off the path at boot and on every Back
  (`routeFromPath()`), and the switcher rewrites the prefix with
  `history.replaceState`.
- **A visitor who wants another language is SENT there, before the page is
  served** — `src/middleware.ts`, for an unprefixed storefront address on a
  GET: the switcher's saved choice (the `rempire_lang` cookie, `ru`/`et`/`en`)
  wins, else the first of ru/et/en in `Accept-Language` (by `q`, then order);
  Russian or Estonian → **302** to the `/ru…` / `/et…` twin (query kept),
  `Vary: Accept-Language, Cookie`, `Cache-Control: private, no-store`. The
  served unprefixed page carries the same `Vary`. **A client that sends
  neither header nor cookie — Googlebot — gets the English page, 200.** A
  prefixed address is never redirected for language, and neither is the
  panel.
- The cookie is written by the switcher (and once from an older saved
  localStorage choice, for browsers from before the cookie existed). It is a
  preference, not an identifier.
- The client-side «refinement by country» (`/api/geo/`, an English browser in
  Estonia re-rendered in Estonian) is **gone** — it re-rendered an address in
  another language.
- The panel (`/admin`, `/admin/scan`) has no language in its address; it opens
  in the owner's saved choice, else the browser's language, else Russian.

The canonical never carries a query string (`?size=`, `?variant=`, `utm_*`,
`country=` all name the same page) — the prerendered head is built from the
route, and `setAltTags()` in app.js from the path alone.

---

## URL move 2026-10 (Shopify scheme)

**What changed, 08–09.10.2026** (branch `feat/shopify-urls`): every page moved
from `/shop2/…` (Russian unprefixed, `/shop2/et/…`, `/shop2/en/…`, trailing
slash) to Shopify's own addresses (the table above). Assets did NOT move:
`/shop2/app.min.js`, `/shop2/styles.css`, `/shop2/icons/…`, the manifests and
`/shop2/admin-sw.js`, `/shop2/og/…` cards, `/shop/img/…`, `/shop/*.js`,
`/shop/og/…`.

### Decisions, with their evidence

| decision | evidence / reason |
|---|---|
| English unprefixed, `/ru`, `/et` | Dim's choice («English without a prefix, as Shopify had»). Shopify's sitemap (`tools/harvest/old-urls.txt`) publishes exactly that. |
| Section handles (the table above) | Shopify's header menu was Hair Care · Hair Styling · Beard Care · Face Care · Body Care · Merch (`docs/shopify/LIVE-PAGES-AUDIT.md`), plus Perfume; the per-language handles are Shopify's own translations, read off its sitemap, where the 47 collections are listed in the same order in every language (verified row by row). The SEO audit of 08.10 proposed the same table independently. |
| face = `face-care`, not `skin-care` | Search Console (3 months to 08.10.2026): face-care family 4 impressions vs skin-care 1; and «Face Care» was the menu link. |
| merch = `merch`, not `rempire-merch` | «Merch» was the menu link and `merch` is one handle in all three languages; `rempire-merch` had 41 impressions vs 31 (no clicks either) — too close to outweigh the menu. `rempire-merch`, `rempire-merch-1` 301 to `merch`. |
| beard = `beard-care`, though `habemeolid` (beard oil) earned 66 impressions | A sub-collection is not the section. Since 09.10.2026 `beard-oil`/`habemeolid`/`maslo-dlya-borody` is a page of its own again, with five more subcollections («Subcollections» below); until then it 301'd to the beard section. |
| «Все товары» = `all-products`/`vse-tovary`/`koik-tooted` | 39 impressions for this family vs 29 for `shop-all-1`/`all-products-est`/`all-prioducts-rus` and 17 for Shopify's built-in `/collections/all`; it is also in Shopify's sitemap, and `/collections/all` is not. The other two families 301 to it. |
| CBD Daily = `/collections/cbd-daily-haircare` | Shopify's collection handle (55 impressions); `/collections/cbd-daily` 301s to it. Every other brand is `/collections/<slug>`, as Shopify's brand collections were. |
| Brands landing `/collections/brands` | Shopify had `/collections/brands` in all three languages; `top-brands`/`top-brandid`/`top-brendy` 301 to it. |
| Policies at `/policies/<shopify slug>`, contact at `/pages/contact` | Shopify's addresses. `/pages/right-to-return` → refund policy, `/pages/data-sharing-opt-out` → privacy, `/policies/legal-notice` and `subscription-policy` → terms, `contact-information` → contact; an unknown `/pages/…` → contact. |
| Blog at `/blogs/news` | Shopify's blog handle; `/blogs/blog` and the one Shopify article (`the-ultimate-guide-on-how-to-moisturize-…`) → the listing. |
| Sets at `/collections/sets[/<id>]` | No Shopify equivalent; a set is a collection of products, and `sets` is no Shopify handle. |
| Gift card at `/products/gift-card` | Shopify's gift card was a product; no catalogue id is `gift-card`. |
| Receipt at `/checkout/done` | The closest Shopify shape (its thank-you page lived under the checkout). Built in the order's language (`receiptUrl()` takes `order.lang`); an unknown order gets the unprefixed address and the edge sends the browser on. |
| Panel `/admin`, scanner `/admin/scan` | `/admin` was already the owner's door. The scanner moved under it: one prefix for everything of the owner's, one robots rule (`Disallow: /admin`), the panel's push worker scope (`/admin`) covers it harmlessly (no fetch handler), and a push tap only ever targets the exact `/admin` window (admin-sw.js). Kept as its own installable app (`scanner.webmanifest`, scope `/admin/scan`). |
| Hidden product: 404, not its brand | «Показывать в магазине» is a toggle the owner flips back; a 301 to the brand would be cached by every browser that saw it and outlive the product's return. An UNKNOWN Shopify handle still goes alias → brand → «Все товары» (301). |
| Unknown collection handle: «Все товары» (301), after asking the database | A handle may be a brand only the owner's own products carry (`custom_products`), so `src/app/[...path]` asks first (src/lib/notfound-page.ts). |
| Shopify's `?variant=…&utm_…` on a page that exists: served, no redirect | The canonical folds it; a redirect would spend a hop for nothing. |
| A trailing slash: one 301 to the slashless address | `trailingSlash: false` + `skipTrailingSlashRedirect: true` in next.config.ts; the middleware folds the slash into whatever other move the address needs, so it is never a chain. Every `/api/*` route answers BOTH spellings with no redirect (Montonio POSTs to `/api/payments/notify/`; the parcel webhook is registered at `/api/shipping/notify/`). |
| Language negotiation at the edge, not in the page | SEO audit, 08.10.2026 (see «The language of a page is its address»). |
| Shopify's Atom feeds (`/collections/<h>.atom`, `/blogs/news.atom`) | 60 of them in Search Console's crawled-not-indexed list (09.10.2026) → one 301 to the page they were a feed of. |
| Left as a 404 on purpose | `/cdn/…` (Shopify's CDN paths and videos), `/v/media/…`, `/v1/produce`, `/wpm`, `/b`, `/llms.txt`, `/llms-full.txt` (llms.txt is added separately). |

### What moves where (one 301 each, `src/lib/legacy-redirects.ts`)

| old | new |
|---|---|
| `/shop2/…` (Russian), `/shop2/ru/…` | `/ru/…` — e.g. `/shop2/p/x/` → `/ru/products/x`, `/shop2/c/all/` → `/ru/collections/vse-tovary`, `/shop2/info/returns/` → `/ru/policies/refund-policy` |
| `/shop2/et/…` | `/et/…` |
| `/shop2/en/…` | the unprefixed English address |
| `/shop2/admin/`, `/shop2/scan/` (any language) | `/admin`, `/admin/scan` |
| `/shop2/done/?n=…`, `/shop2/checkout/?resume=…` | `/ru/checkout/done?n=…`, `/ru/checkout?resume=…` — **query kept** (receipts, resume links, `?order=`, `?q=`, `?size=` are ours) |
| `/shop`, `/shop/c/…`, `/shop/b/…`, `/shop/<screen>`, `/shop/info/…`, `/shop/p/<id>/` | the same Russian targets, directly (the prototype's `/shop/p/` stubs too) |
| `/en/…`, `/en-lv/…`, `/en-lt/…`, `/en-fi/…` | the unprefixed English address (Shopify's regional query dropped, `?q=` kept) |
| `/ET/…`, `/RU/…` | lower case |
| a section under another name or language (`/collections/hair-mask`, `/et/collections/hair-care`) | the section, in the address's language |
| a subcollection under another language's handle (`/collections/habemeolid`, `/ru/collections/beard-oil`) | the subcollection, in the address's language |
| `/products/<unknown>` | alias → brand → «Все товары»; `/products/delivery` → shipping policy |
| `/collections/<x>/products/<y>`, `/collections/<x>/<tag>` | the product; the collection |
| `/collections/vendors?q=<Brand>` | that brand's page, else the brands landing |
| `/account/<anything>`, `/checkouts/…`, `/checkout/<anything>`, `/<digits>/orders/…`, `/<digits>/checkouts/…/recover` | `/account` |
| `/discount/<code>?redirect=<path>` | the path (resolved in the same hop), else home |
| `/gift_cards/…` · `/password` · `/apps/…`, `/a/…`, `/tools/…` · `/cart/<not a permalink>` | the gift card · home · home · `/cart` |
| `/sitemap_*.xml` · `/agents.md` | `/sitemap.xml` · `/` |

### Things the owner has to do

- **Renat's phone**: the «Админка» and «Сканер» icons were installed from
  `/shop2/admin/` and `/shop2/scan/`. They still open (one 301), but outside
  the installed app's scope, i.e. in a browser tab. Remove both, open
  `rempireshop.com/admin` (and `/admin/scan`), add them to the Home Screen
  again, switch notifications on again. The panel retires the old
  `/shop2/admin/` push registration itself on its first start (unsubscribes it
  and removes its address from the server), so notices do not arrive twice.
  `/test` check «panel-app-readd».
- Search Console: submit `sitemap.xml` again (it lists only the new addresses).

### How it is served

- `src/middleware.ts` (matcher: every path except `/api`, `/_next` and files
  with an extension, plus Shopify's `/sitemap_*.xml`, `/agents.md` and
  `*.atom`): the 301s above, the language 302, the hidden-product 404.
- `next.config.ts` `afterFiles` rewrites: address → prerendered file, from the
  list the prerender writes (`src/data/prerendered-routes.json`, gitignored).
- `src/app/{,ru/,et/}products/[id]`, `src/app/{,ru/,et/}blogs/news[/[slug]]`:
  the request-time pages (custom products, posts published after the build).
- `src/app/[...path]`: the shell for the client-side screens, the shop's 404
  for anything else, and «Все товары» for an unknown collection.
- The CSP: `script-src 'self'` (+ the Cloudflare beacon) is now the DEFAULT
  for every path, since the shop's pages are the whole site; `/api/*`, the
  prototype's `/shop/*` files and the hand-written `/test`, `/guide`, `/cards`,
  `/golive` keep `'unsafe-inline'`. camera/microphone `(self)` on every page
  (as on `/shop2/*` before), everything denied on the API.
- robots: `Disallow: /admin`, `/checkout`, `/cart`, `/account`, `/search`
  and their `/ru`, `/et` twins, `/api/` — with `Allow:` for the read-only
  endpoints a renderer needs (`/api/overrides/`, `/api/bundles/`, `/api/blog/`,
  `/api/reviews/`, `/api/shipping/carriers/`), so Googlebot's renderer sees the
  live stock, prices and owner SEO texts.

---

## Subcollections (since 09.10.2026)

SEO audit 08.10.2026 §6.2, §7.1 and T6, approved by Dim: the chips under a
section's heading («Масла», «Шампуни» …) were browser-side filters with no
address, so Google had nothing to index for «habemeõli», «palsamid» or
«juuksevaha» — and the Shopify collections that ranked for them 301'd to the
whole section. Six of the **existing** chips are now a page each, **at the
handle Shopify had for that content**, so the history Google keeps carries
over. Dim's condition: pages for the chips that are there, and nothing on the
chip row changes — no new chip, no new label, no product taken off a chip.

| chip | route | EN | RU | ET | products |
|---|---|---|---|---|---|
| Масла (beard) | `/c/beard/oi/` | `beard-oil` | `maslo-dlya-borody` | `habemeolid` | 12 |
| Бальзамы (beard; beard and aftershave balms) | `/c/beard/ba/` | `beard-balm` | `balzam-dlya-borody` | `habemepalsamid` | 8 |
| После бритья | `/c/beard/af/` | `aftershave` | `losony-posle-britya` | `raseerimisjargne-hooldus` | 6 |
| Шампуни | `/c/hair/sh/` | `shampoo` | `shampuni-dlya-volos` | `shampoonid` | 40 |
| Кондиционеры | `/c/hair/co/` | `conditioner` | `konditsionery-dlya-volos` | `palsamid` | 26 |
| Пасты и воски | `/c/styling/pw/` | `hair-wax` | `vosk-dlya-volos` | `juuksevaha` | 7 |

- **Who is under which chip** is one function, `subcatsAuto()` in
  `public/shop2/app.js`, beside the chips. Each chip's own rule (`re`, the
  product's Russian name) is exactly what it always was, so a chip keeps every
  product it showed; a product NO chip took is placed by `more` (its name and
  id, Shopify's English handle) or `SUB_PICKS` (six names that say nothing,
  «RE.STORE», «Super.Goo») — 21 of them, each under a chip whose label is
  plainly what it is. The owner's «Подраздел» from the panel wins over all of
  it, as before (`product_overrides.subcat`, `custom_products.subcat`). The
  prerender lifts that function and its tables out of app.js the way it lifts
  the dictionary — FATAL if the slices do not come out — so a static page
  lists exactly what its chip filters. `tests/subcollections.test.ts` holds
  the labels to the old ones and every one of the 183 products of the four
  sections to its chips.
- **Publishing** is `SUB_HANDLES` in `src/lib/shop-paths.mjs` (and its ES5
  twin `SHOP_SUB_HANDLES` in app.js): a chip needs `SUBCOLLECTION_MIN` = 6
  catalogue products and its words in all three languages (`seoSub()` in
  `src/lib/seo-copy.mjs`, beside the sections' and brands' words, copied into
  app.js by `node tools/sync-seo-copy.mjs`: title ≤ 60, description ≤ 155,
  the line under the heading, the list's name; `seoHead("sub", …)` is the
  head). The prerender refuses to run when a published one falls below
  that. Scalp care, Korean cosmetics, shaving and moustache wax are no chip,
  so they have no page; their Shopify handles go to the section.
- **The page** is what the shop shows on tapping the chip, in the section's
  listing template exactly: the section's `<h1>` (it never changed on a tap),
  the crumb Home › Section › chip (and the same `BreadcrumbList`), the
  subcollection's own line under the heading, the grid, `ItemList` named by
  the page — self-canonical, the hreflang cluster of its three handles, in
  `sitemap-1.xml` at priority 0.7. Its own words are in the `<title>`, the
  meta description and that line.
- **The chips**: a published one, and «Все», is an `<a href>` to its address,
  drawn exactly like the button chips (`a.scchip` in styles.css; measured in
  Chromium and WebKit); a plain tap filters in place as before and pushes the
  address, Back returns to the section; a tap with a modifier opens a tab. A
  chip with no page stays a button and a filter on the section's address.
- **Redirects**: the subcollection's own handle in any language is the page
  (another language's spelling → one 301 to this language's;
  `/collections/<handle>/<tag>` → the page). Every other Shopify sub-handle
  (`shaving`, `beard-and-mustache-wax`, `scalp-treatment`,
  `korean-cosmetics`, `hair-mask` …) still goes to its section. Unpublish a
  subcollection and its handles fall back to its section by themselves
  (`COLLECTION_CAT` keeps them).
- **Request time**: `src/lib/notfound-page.ts` answers a published
  subcollection's route with the shell (app.js draws it) when no prerendered
  file is there; an unpublished `/c/<cat>/<sub>/` is a 404.

To publish another existing chip: give it its handles in both `SUB_HANDLES`
tables, its words in `sub` of `src/lib/seo-copy.mjs` (then
`node tools/sync-seo-copy.mjs`), and a row in `ADDRESSES` of
`tests/subcollections.test.ts`.

---

## Regenerating

```bash
# staging (what is committed now)
PUBLIC_BASE_URL=https://rempireshop.diipsolutions.eu npm run prerender

# at the switch
PUBLIC_BASE_URL=https://rempireshop.com npm run prerender

# then always
npm run prerender:check
```

The check reads the 813 files off disk — no DOM library, no network — and
asserts the things that are easy to get wrong and impossible to see: a missing
hreflang, a canonical pointing at the wrong language, JSON-LD that does not
parse or has no `@context`, a `Product` without `offers`, a title Google would
cut in half, an `og:image` that is not on disk or is not really 1 200×630, a
page whose asset tags drifted from `index.html`, a stale page for a product
that no longer exists, a `robots.txt` that disagrees with the robots meta the
pages carry, and any screen behind a basket that has found its way into the
sitemap.

`PUBLIC_BASE_URL` is **set on the Vercel project** to the staging host
(`docs/accounts.md`). For the absolute URLs it defaults to
`https://rempireshop.com` when unset; for indexing it does not default at all.
Beyond the URLs the base decides two things, and it decides them together —
that is the point:

| `PUBLIC_BASE_URL` | robots meta in every page | `public/robots.txt` |
|---|---|---|
| set, on `*.rempireshop.com` | `index, follow, max-image-preview:large` | the open policy |
| set, anything else | `noindex, nofollow` | the closed policy |
| **unset** | `noindex, nofollow` | the closed policy |

Opening the site takes an explicit variable, not merely the absence of one. A
bare `npm run prerender` used to write "index, follow" into every page and swap
`robots.txt` for the open policy without saying so — which happened during the
build wave, in a working tree somebody could have committed. It now fails safe
and prints a warning, and the state it leaves (live URLs with noindex) is
reported by `prerender:check` as a note rather than passed over in silence.

What `prerender:check` *fails* on is `robots.txt` disagreeing with the robots
meta in the pages. Those two come out of the same decision in the same run of
the tool, so a disagreement can only mean one of them is left over from an
earlier run with a different `PUBLIC_BASE_URL` — which is exactly the way a
staging deployment ends up serving an open `robots.txt`. The sitemap host is a
separate axis and is checked separately: `robots.txt`'s `Sitemap:` line has to
name the same host the sitemap's own `<loc>`s do.

One fact, one switch. The old arrangement had the meta follow `PUBLIC_BASE_URL`
while `robots.txt` was hand-maintained and `X-Robots-Tag` lived in
`vercel.json`, and they had already drifted: the committed `sitemap.xml` was
built for `rempireshop.com` while `robots.txt` pointed at the staging sitemap.
`check-prerender.mjs` now fails if `public/robots.txt` is not the policy that
matches the host in `sitemap.xml`.

`npm run build` runs the tool through `prebuild`. Note that npm does **not**
load `.env.local` for a lifecycle script, so a local `npm run build` with no
`PUBLIC_BASE_URL` in the environment builds for the live domain and writes the
open `robots.txt` into the working tree. The tool prints a warning line when
the variable is unset; pass it explicitly:

```bash
PUBLIC_BASE_URL=https://rempireshop.diipsolutions.eu npm run build
```

### The three noindex layers, and where they disagree

Three things independently decide whether a page may be indexed, and all three
have to agree or the strictest wins silently:

| layer | where | keyed on |
|---|---|---|
| `X-Robots-Tag` header | `next.config.ts` `headers()` | the **request** host |
| `<meta name="robots">` | every prerendered page | `PUBLIC_BASE_URL` at build |
| `robots.txt` | `public/robots.txt`, generated | `PUBLIC_BASE_URL` at build |

The global `X-Robots-Tag: noindex` on `/(.*)` that used to live in
`vercel.json` is gone (audit row 9) — it is now a
`missing: [{ type: "host", value: "^(www\.)?rempireshop\.com$" }]` rule in
`next.config.ts`: every request whose host is **not** the shop's own domain is
served `X-Robots-Tag: noindex, nofollow`.

**All three are now shaped the same way — an allowlist.** The header names the
one host that may be indexed instead of naming the hosts that may not; the meta
tag and `robots.txt` close any base that is not `*.rempireshop.com`. A **new**
host — a second staging domain, `rempireshop.ee`, a custom preview alias, a bare
IP, a copy someone points at the app — is therefore closed by all three without
anyone remembering to add it anywhere. Only `rempireshop.com` and
`www.rempireshop.com` are open, and only with `PUBLIC_BASE_URL` set to match.

It was a *denylist* until 03.09 (a `has` rule naming `*.vercel.app` and
`rempireshop.diipsolutions.eu`), which meant a host it did not name was
indexable by default; the other two layers still held it shut, so nothing
leaked. If the shop ever gains a second indexable hostname, widen the `missing`
value — a host outside it is closed, which is the failure everybody notices
rather than the one nobody does.

**Re-run it after anything that changes the catalogue, the translations, the
policy texts, the sets, the shop's own details or the shell**:
`tools/build-catalogue-full.mjs`, `tools/assemble-translations.mjs`,
`tools/build-bundles.mjs`, an edit to `DEFAULT_CONTENT` in `src/lib/content.ts`
(run `npm run pack:content` first, or just `npm run build`), or an edit to
`public/shop2/index.html` (a new script, a bumped `?v=`). The run is idempotent
and takes a couple of seconds — it rewrites only the files whose content
actually changed, redraws only OG cards that are not already on disk, and
deletes pages for products, sets and policy slugs that no longer exist.
`tools/check-prerender.mjs` fails loudly if the pages have drifted from
`index.html`.

The company details, the socials and the contact-page intro come from
`src/data/content.default.json` — **generated**, never hand-edited:
`tools/pack-content.mjs` writes it from `DEFAULT_CONTENT` in
`src/lib/content.ts`. A missing file is not fatal; the prerender says so and
falls back to built-in constants.

`prebuild` is `pack-migrations` → `pack-content` → `pack-legal` →
`copy-vendor` → `minify-shop2` → `prerender`, so `npm run build` regenerates
everything before `next build`. `minify-shop2` comes before the prerender
because the prerender copies the shell's script tags into all 813 pages, and
one of those tags names the file it writes.

### What it writes

| path | what |
|---|---|
| `public/shop2/index.html` | **patched in place** — the English home page, `/` (see below) |
| `public/shop2/{ru,et}/index.html` | the other two home pages, `/ru` and `/et` |
| `public/shop2/{,ru/,et/}c/<cat>/index.html` | 8 categories × 3 |
| `public/shop2/{,ru/,et/}c/<cat>/<sub>/index.html` | 6 subcollections × 3 (`c/beard/oi/` …) |
| `public/shop2/{,ru/,et/}b/<brand>/index.html` | 26 brands × 3 |
| `public/shop2/{,ru/,et/}p/<id>/index.html` | 220 products × 3 |
| `public/shop2/{,ru/,et/}info/<slug>/index.html` | 5 policy pages × 3 |
| `public/shop2/{,ru/,et/}sets/index.html` | the sets landing × 3 |
| `public/shop2/{,ru/,et/}set/<id>/index.html` | 8 sets × 3 |
| `public/shop2/{,ru/,et/}gift/index.html` | the gift card × 3 |
| `public/shop2/{,ru/,et/}brands/index.html` | the brands landing × 3 |
| `public/shop/og/<id>.jpg` | one 1 200×630 card per product — drawn once |
| `public/shop/og/set-<id>.jpg` | one card per set — drawn once |
| `public/brand/og-default.png` | the card for pages with no photograph |
| `public/sitemap.xml` | a `sitemapindex`: `sitemap-1.xml` (…`-N.xml` above 1 000 URLs) **plus `sitemap-products.xml` and `sitemap-custom.xml`**, which are not files but routes — see "The sitemaps the app serves" and "Custom products" below |
| `public/sitemap-1.xml` | the 153 URLs the database cannot hide, with `xhtml:link` alternates |
| `public/robots.txt` | **the policy that matches `PUBLIC_BASE_URL`** |
| `public/robots.production.txt` | the open policy, for reading and diffing — `*`, plus one group naming the AI search, assistant and training crawlers (OAI-SearchBot, ChatGPT-User, GPTBot, PerplexityBot, Perplexity-User, ClaudeBot, Claude-SearchBot, Claude-User, Google-Extended, Applebot-Extended) with the **same** rules repeated, because a bot obeys only the group that names it (Dim, 09.10.2026: open, training included). Both policies are `tools/lib/robots-policy.mjs`; `tests/robots-policy.test.ts` reads them the way a crawler does |
| `public/robots.staging.txt` | the closed policy, ditto — names no AI bot, so they all fall under `Disallow: /` |
| `public/llms.txt` | the shop described for AI assistants (llmstxt.org, gitignored): what REMPIRE is, the URL scheme, every section and brand with its three addresses, the shipping page's own price table and pickup/returns sentences in English, contact, policies, guides — `tools/lib/llms-txt.mjs`, from this run's data, so it cannot go stale; not named in robots.txt (no convention for that) |
| `src/data/prerendered-routes.json` | address → file for every page written (gitignored), which `next.config.ts` turns into its rewrites |

831 pages — 277 per language: 220 products, 8 categories + `all`, 6
subcollections, 26 brands, the brands landing, 1 home, 5 policy pages, 8 sets +
the landing, 1 gift card.
`public/sitemap.xml`
is **always a `sitemapindex`**: the pages that no database row can take away
go into `public/sitemap-1.xml` (`-N.xml` chunks of 1 000 above that), and the
index also names two routes — `sitemap-products.xml` and
`sitemap-custom.xml`. The checker follows the index and skips those two
entries, since they are not on disk.

### The sitemaps the app serves

A static sitemap is a promise made at build time, and two kinds of page break
that promise between builds. Both are answered by a route instead:

| route | what it lists | why it cannot be a file |
|---|---|---|
| `src/app/sitemap-products.xml/route.ts` | the catalogue's 220 product pages × 3, **minus the ones the owner has switched off with «Показывать в магазине»** | `product_overrides.hidden` (migration 147) changes while the deployment stands still, and a file written at build cannot un-name a page |
| `src/app/sitemap-custom.xml/route.ts` | the owner's own products (`c-…`) and the blog posts published after the build | those rows do not exist when the build runs |

The **pages** are still prerendered — one static file per product per
language, which is what makes the shop fast and indexable. Only the rows that
offer them to a crawler moved. `lastmod` for a product is the owner's own edit
(`product_overrides.updated_at`) when he has made one, and **absent**
otherwise; priority is 0.7, or 0.4 for a product that is out of stock.

`lastmod` means a real edit or nothing (09.10.2026). Until then the route
filled the gap with today — 477 of 660 product rows said «changed today»
every day — and the static sitemap stamped the build's day on every row at
every deploy. Google trusts the field only while it keeps proving true, so a
date that is always today teaches it to ignore the rows where it is. Now:
a catalogue product carries its override's day, a custom product its own
`updated_at`, an article its last edit (else its publication), the blog
listing the newest article; the home pages, sections, brands, policy pages,
sets and the gift card carry none, and neither do the rows of the
`sitemapindex`. `sitemapUrlEntry()` omits the element for an empty value;
`tools/check-prerender.mjs` fails a static row that dates anything but the
blog. A product with
nothing on the shelf stays listed and stays indexable: its page still answers
the question the searcher asked, still carries «Сообщить о наличии», and
dropping it would throw away a ranking that has to be earned again when the
stock comes back (the Gatsby Grunge Mat is exactly this case — 100 impressions
in one week, out of stock). What it does not keep is the same claim on the
crawler's time as a product somebody can buy today, and its `Product` block
says `OutOfStock`, so Google leaves it out of the merchant surfaces by itself.

No database, or a query that fails: the route lists every product, which is
the same list the static sitemap offered for months. The page itself is what
decides who may read it.

The HTML pages are gitignored (`.gitignore`) because `prebuild` regenerates
them. The OG cards are **not**: they are drawn once from images that are in the
repo, and committing them keeps 228 sharp calls out of every future build.
Delete one and the next run draws it again.

Each page carries: `<html lang>`, a title of at most 60 characters, a
description of at most 160, `canonical`, `hreflang` ru/et/en/x-default,
OpenGraph and Twitter cards, and JSON-LD:

**A product's two lines** (`productSpec()` / `descFrom()` in
`src/lib/seo-head.mjs`, mirrored in `setHead()` in `public/shop2/app.js`, and
reworked 07.09.2026 — `docs/audit/2026-09-07-seo.md`). The title takes the
longest rung that fits in sixty characters: `brand name — купить в Rempire ·
price`, else `brand name · price`, else `brand name — REMPIRE`, else the name
alone. The description, when nobody has written a Google pair for the product,
is the product's own copy with a shouted opening heading dropped, then
`price · stock · delivery` — and the tail is budgeted **first**, so the price is
never the half that gets cut off. A pair the owner or the assistant wrote is
used exactly as written, with nothing appended.

Since 09.10.2026 (SEO pack 3) the order is: the owner's own pair → a
**hand-written line** from `src/lib/seo-copy.mjs` `productMeta` (19 products
people search for: all twelve System 4, Free.Hold, Night.Rider, Rough.Rider,
the grey Gatsby Grunge Mat, Proraso Azur Lime balm, both Creed Aventus — what
it is, who it is for, one fact from its own text, ≤ 155 characters, no tail)
→ the description cut from the product's text. That cut is **whole
sentences** now (`seoLead()` in the seo-copy block, which app.js carries):
as many as fit before the delivery tail; a `BENEFITS:` / `ПРЕИМУЩЕСТВА:` /
`KASUTAMINE:` label in capitals ends the copy; a first sentence longer than the
room gives its longest clean clause (a colon, a semicolon, a bracket, a comma
before «который / mis / which» or a gerund, else a dash — never a bare list
comma); only when there is none of 30 characters, the old cut at a word with
«…». Until then all 660 generic descriptions ended mid-sentence in «…»; now
about one in five does. Both renderers read the same plain text
(`seoSnippetText()`, which `textForSnippet()` is) — app.js used to read it
through `stripTags()`, which ran a heading line into the copy.
`tests/seo-copy.test.ts` runs app.js's own `descFromText()` against
`productSpec()` for every catalogue product in every language.

| page | JSON-LD |
|---|---|
| home | `Organization` (also typed `Store`, with `alternateName`, `legalName`, `email`, `telephone`, `vatID`, `taxID`, `geo`, `hasMap`, `areaServed`, `sameAs`, `hasMerchantReturnPolicy`, `hasShippingService` and an `@id` — see «Structured data and IndexNow») + `WebSite` (`alternateName`, `publisher` → that `@id`) |
| category, brand | `BreadcrumbList` + `ItemList` |
| product | `Product` with `offers` — one `Offer` per size, each with `shippingDetails` and `hasMerchantReturnPolicy` (see «Structured data and IndexNow») + `BreadcrumbList` |
| set | `Product` with `offers` and `isRelatedTo` (the items) + `Organization` + `BreadcrumbList` |
| sets landing | `Organization` + `BreadcrumbList` + `ItemList` |
| policy page, gift card | `Organization` + `BreadcrumbList` |

Inside `#app` it carries the real screen: breadcrumbs, brand, `<h1>`, price,
stock, sizes with per-size prices, the description, an `<img>` with a real
`alt`, and `<a>` links onward — which is the only path a crawler has from a
category to the 220 product pages. A policy page carries the whole legal text
(the `<h1>`s inside it are demoted to `<h2>` so the page has one heading), a
set page lists its items as links to their product pages, and every page ends
with the three-language nav.

### Link previews

**Every `og:image` this tool writes is a 1 200×630 file that exists in
`public/`** — that is the invariant, and `check-prerender.mjs` measures each
distinct card with sharp to prove it. Which is why every page can declare
`og:image:width`/`height` and `twitter:card: summary_large_image` without
promising a crop that is not there.

Before this, 125 of the 220 products pointed `og:image` at their square
`.webp` cutout. Facebook, WhatsApp and LinkedIn do not read WebP at all, so
those 125 products shared as a bare URL with no card — the audit's item 15.
The old shop had ImageMagick-built cards for the 95 products it used to sell;
the tool now draws the rest itself with sharp, on the same recipe (the cutout
on the `#edeae1` ground with the tower mark at +56/+48, no text — the title
and the price travel as OG text fields and each platform sets those in its own
type). A set gets its three items in a row on the same ground.

The chain, first hit wins: the page's own card (a product, a set, an article)
→ the shop's card in the page's language, `/og-shop-{en,et,ru}.png`
(`ogShopCard()`) → `/brand/og-default.png` (the tower alone) → `/og-shop.png`.
Since 09.10.2026 the language card is what the home page, the sections, the
brands, the brands landing, the policy pages, the gift card and the 404 show —
until then the home page showed the staging poster «НОВЫЙ МАГАЗИН … черновик
для Рената», a section or brand whichever product sorted first, and the policy
pages the tower with no name (SEO audit §1A b, T15). The three cards are drawn
by `node tools/og-shop.mjs` (Playwright, the shop's own fonts; Dim's design
and line «JUUKSED. HABE. STIIL.») and committed; `/og-shop.png` is a copy of
the English one, kept for every scraper that cached the old name. The
`Organization` block's `logo` and `image` (and an article's publisher logo)
are the tower as a raster PNG — `/shop2/icons/icon-512.png`, `ORG_LOGO` /
`ORG_IMAGE` — not the SVG Google may not take as a logo and not a link-preview
card. The «REMPIRE TOWER» lockup and badge in `public/brand/` carry the
studio's slogan rather than the shop's name and are not used for it.

### index.html is the shell *and* the English home page

`public/shop2/index.html` is the file `/` is routed to (next.config.ts) and
the file every client-side screen is served (`src/app/[...path]`). So that
one file is **patched between markers** rather than rewritten — its
`<html lang>` included, since 08.10.2026, when the unprefixed home page
became the English one:

- `<!-- seo:start --> … <!-- seo:end -->` in `<head>` — the tool owns this.
- `<div id="app"><!-- prerender:start --> … <!-- prerender:end --></div>`.

Everything outside the markers is hand-maintained and survives every run: the
asset tags, the `?v=` token, the script list. The tool reads those from there
and copies them into the other 809 pages, so all of them always load the same
assets. If the markers go missing the tool refuses to run rather than guess.

The consequence: every non-prerendered screen (search, the basket, the
checkout, the panel) is served that same file, so its raw HTML carries the home page's
head. app.js corrects the title, canonical and hreflang on boot. Those screens
are robots-disallowed and out of the sitemap, so nobody arrives on one from a
search. `info/<slug>`, `sets`, `set/<id>`, `gift` and `brands` used to be in
that list — they are prerendered now.

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

The JSON-LD survives the same handover, and **which attribute a block carries
decides whether it survives at all** — Googlebot reads the rendered DOM, not
the file:

- `id="ldjson"` — only on a `/p/<id>/` page. `setHead()` rewrites that element
  in place with its own `Product`, so handing it one means one Product, not
  two.
- `data-seo="ldjson-page"` — everything else, including the **set** pages'
  `Product`. `setHead()` *removes* `#ldjson` on every screen that is not a
  catalogue product, so a set's Product block carrying that id would be deleted
  on boot and never read. Blocks marked `ldjson-page` are dropped only once the
  shopper navigates away from the path the page was loaded on
  (`location.pathname !== loadedPath`), so they survive the first render.

`check-prerender.mjs` asserts that split both ways.

---

## «Страница не найдена» — the 404

> Since 08.10.2026 the catch-all is `src/app/[...path]/route.ts` at the root
> of the site and the shapes are Shopify's (`isKnownShopPath()` reads the
> internal route `parseShopPath()` gives back); an address of no shop shape at
> all is the 404, and an unknown `/collections/<handle>` — a Shopify shape —
> lands on «Все товары» after the database has said it is no brand of the
> owner's own. The history below is told in the `/shop2/` addresses of the
> time.

Until 07.09.2026 **every** unrecognised `/shop2/…` address answered **200 with
the home page**: `next.config.ts`'s `/shop2/:path+` fallback rewrite handed the
shell to anything it did not otherwise route, and app.js's `routeFromPath()`
ended its cascade on `S.screen = "home"`. That is a soft 404 — a page that says
"found" while showing something else. Google indexes it, then drops it, and
takes the neighbourhood's crawl budget with it; a shopper on a stale link was
simply left wondering which page they were looking at. Dim's answer was «Make a
page not found».

Both halves say the same thing now:

| | what answers | what it carries |
|---|---|---|
| the request | `src/app/shop2/[...path]/route.ts` → `src/lib/notfound-page.ts` | **404**, the shell patched into the 404 screen, `noindex, nofollow`, a canonical that is *this* address, the crumb, and links home and to `/c/all/` — in the language of the path |
| the script | `routeFromPath()` → `S.screen = "notfound"` → `screenNotFound()` | the same words on the same address (`pathFor()` never rewrites it), `document.title`, and the robots meta flipped to `noindex` for that screen only |

**What is a 404 and what is not** is one list, `isKnownShopPath()`, written
against app.js's own router so the two cannot drift:

* **200, the plain shell** — the screens that live only in the browser
  (`search`, `brands`, `account`, `checkout`, `done`, `admin`, `scan`), the
  single prerendered pages (`sets`, `gift`, `blog`) and the two shapes whose id
  lives in a database and that have a request-time route of their own to answer
  404 for an id nobody has: `p/<id>` and `blog/<slug>`. Guessing those from a
  build-time file would 404 a post the owner published an hour ago.
* **404** — a category or a policy slug that does not exist (both are closed
  sets known at build time: the catalogue's own section keys, and
  `src/data/legal-slugs.json`, which `tools/pack-legal.mjs` writes in
  `prebuild` from `Object.keys(LEGAL)` in `public/shop/legal.js`), anything of
  another shape (`/shop2/cart/`, `/shop2/wat/`), and anything deeper than two
  segments.
* **404 after one question to the database** — the two half-open lists, asked
  only once the closed ones above have said no: a **brand** the catalogue has
  never heard of may still be one the owner typed on a product of their own
  (`custom_products`), and a **set** may have been created in the panel after
  the build (`bundles`). Both are owner-editable, so no build-time list can
  answer for them; a row that is missing or switched off is a 404, and a
  database that is down answers 200 with the shell — the older, softer wrong
  answer, and a far better one than telling a crawler that a real page is gone
  because Postgres blinked.

  `set/<id>` was in the 200 list until 08.09.2026, on the grounds that it "has
  its own request-time route that answers 404 for an id nobody has". It never
  had one, so every id anybody typed answered 200 with the shell — a soft 404
  in unlimited numbers, found against staging by `e2e/smoke.spec.ts`, which now
  asserts it. What deliberately did **not** change is `app.js`'s router: it
  still accepts `set/<id>` whatever the id, because the list of sets arrives
  from `/api/bundles/` after boot, routing on data that has not landed used to
  turn an old link into the home page, and `screenBundle()` says «Набор не
  найден» rather than bouncing. The server has the row in front of it and no
  such excuse, so it answers 404 — the same words to the reader, and the truth
  to a crawler.

Two consequences worth knowing:

* **A product id nobody has is a 404 too** (`src/lib/product-page.ts`). A real
  catalogue id still gets the shell at 200 — that is the fresh-clone case,
  where `npm run prerender` has not run and the static file does not exist
  yet — but an id that is in neither the catalogue nor `custom_products`
  answers 404 with the noindex shell, exactly as a hidden `c-…` already did.
* **A malformed escape (`/shop2/b/%E0/`) answers 400**, from Next, before any
  of this runs: it refuses to decode an un-decodable segment into a route
  parameter. `/shop2/p/%E0/` has done that ever since the request-time product
  page existed; now that every `/shop2/` path is a route, they all do. The
  router's own `safeDecode()` still holds for a mangled address the SPA reaches
  by navigation, and a mangled *query* (`/search/?q=%E0`, the share link a
  messenger really does break) boots the shop exactly as before.

`/shop2/` itself is never matched by the catch-all — a catch-all needs at least
one segment — and the more specific routes beside it (`p/[id]`, `blog`,
`blog/[slug]`, `og/[file]`) win over it, so nothing that already worked moved.

## Routing

> Since 08.10.2026 (see «URL move 2026-10»): `trailingSlash: false` with
> `skipTrailingSlashRedirect: true`; the rewrites map each Shopify address to
> its prerendered file from `src/data/prerendered-routes.json`, which the
> prerender writes; there is no `fallback` rewrite any more — the root
> catch-all route serves the shell; and the `/shop/…` prototype addresses
> (the `/shop/p/<id>/` stubs included) are one 301 each in the middleware.
> The list below is the history of the `/shop2/` scheme.

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
- The kinds it groups are `p`, `c`, `b`, `info` and `set`; `sets` and `gift`
  are single pages and get one rule each, also only when the file is on disk.
  So a fresh clone that has not run `npm run prerender` yet still serves the
  shell everywhere rather than 404ing.
- **The config is read once**, at dev-server start and at build. Restart `next
  dev` after `npm run prerender` or the new pages will not be routed locally.
- **Three rewrite phases, not one list.** The prerendered files are
  `afterFiles` rewrites, the `/shop2/:path+` shell rewrite is a `fallback`
  one, and between them Next's own dynamic routes get their turn — which is
  where `src/app/shop2/{,et/,en/}p/[id]/route.ts` sits: a `/p/<id>/` that is
  not on disk reaches it, and it answers a custom product from its row (see
  "Custom products" below) and anything else with the shell. A plain array
  would have been all-`afterFiles`, and the shell rewrite in it would have
  swallowed those routes before they were ever consulted.
- Legacy `/shop/...` paths still land on `/shop2/...`: `/shop`, `/shop/c/:cat`,
  `/shop/b/:brand`, `/shop/:screen`, and `/shop/info/:slug` (that last one used
  to 404). `/shop/p/<id>/` keeps its own prerendered pages — they carry the link
  previews the shop has been sharing and hand humans over with a script. At the
  switch, consider replacing them with 301s to `/shop2/p/<id>/`, which now has
  its own OpenGraph tags; that is a decision, not a leftover.

### The one thing that runs before the file: hidden products

`src/middleware.ts` runs on every page address (since 08.10.2026; until then
`/shop2/{,et/,en/}p/<id>/` and the Shopify shapes) and checks
`/{,ru/,et/}products/<id>`. Middleware is the **only** layer that runs before the static layer
answers, and that is exactly what a hidden product needs: switching
«Показывать в магазине» off already removed the product from the listing, the
search, the sets, the cart and the `p/[id]` route, but the prerendered file
went on being served — so Google and anyone holding the link still had a page
until the next deploy. Dim, 08.09.2026: «if the item is hidden, it should be
hidden without any deploys or rebuilds».

So the middleware asks `GET /api/overrides/hidden/` — a list of ids, never
cached, one indexed query (the partial index in migration 147 exists for it) —
and, for a hidden id, answers **404 with the shell carrying `noindex,
nofollow`**: byte for byte what `src/lib/product-page.ts` answers for a hidden
custom product, so the two kinds of product behave identically once they are
off sale. app.js boots from that shell and settles on «Страница не найдена».

Everything else is untouched: a product that is not hidden gets
`NextResponse.next()` and its static file, exactly as before. The lookup is
deliberately **not** memoised — a cache here is a window in which a hidden
product is still served, which is the whole thing being fixed — and it fails
open: a database that cannot answer within 2.5 s means the page is served, the
behaviour this layer inherited.

### The other half: nothing may still link to it

Withholding the page closes the address. It does not stop the rest of the shop
pointing at it, and until 18.09.2026 nothing did. Every page
`tools/prerender-shop2.mjs` writes with a list of products on it — 3 home
pages, 27 category pages, 78 brand pages, the shelf under each of 660 product
pages, the «Что внутри» list of every набор and the brand counts on
`/brands/` — was built from `public/shop/catalogue2.js` and from nothing else.
So a grid tile went on carrying `<a href="/shop2/p/<id>/">` into an address the
middleware answers 404 for, and the grid offered a product the sitemap route
beside it had already withdrawn. The static layer serves those files before any
route runs, so for a crawler and for a reader without scripts that dead link
*was* the page; the shop's own grids are redrawn from the live feed the moment
`app.js` arrives, which is why nobody with a browser ever saw it.

A product page correcting its own head is not a defence here. `setHead()` does
rewrite the head of the page it runs on — that is why the static product pages
are still written for all 220 products, hidden or not, and why the sitemap and
not the build decides which of them are offered. It covers that one page. A
grid on *another* page linking into it has no second pass at all, and neither
has «Товары из статьи» under an article.

So the build reads the table too — `tools/lib/overrides-export.mjs`, the way it
already reads the set prices from `bundles` — and every list on every page is
built from `ON_SALE`: the catalogue minus what `forSale()` in
`src/lib/seo-head.mjs` rejects. That is the same call
`src/app/sitemap-products.xml/route.ts`, `src/lib/product-page.ts` and
`src/lib/blog-page.ts` make, so what a page links to and what the sitemap
offers cannot drift apart. With no `DATABASE_URL` the table is `{}` and the
build writes exactly the pages it wrote before. `tests/grid-hidden-r26.test.ts`
runs the build's own list expressions over a hidden product.

---

## At the switch

1. Change `PUBLIC_BASE_URL` on the Vercel project to
   `https://rempireshop.com`. That is the whole switch — the robots meta, the
   absolute URLs and `public/robots.txt` all follow it, and `prebuild`
   regenerates the 813 pages on the next deploy.
2. Verify locally first:
   ```bash
   PUBLIC_BASE_URL=https://rempireshop.com npm run prerender
   npm run prerender:check
   ```
   Confirm the run printed `robots "index, follow, max-image-preview:large"`
   and `robots.txt = production`, and that the checker printed `0 failure(s)`.
   Then regenerate for staging again if the deploy is not happening yet — a
   working tree carrying the open `robots.txt` is one merge away from being
   live.
3. Check the `missing: [{ type: "host" }]` noindex rule in `next.config.ts`
   `headers()` still names the production host — `^(www\.)?rempireshop\.com$`
   is the *only* host that is not sent `noindex`. Nothing needs changing when
   the DNS moves, but this is the header that would silently outrank every
   canonical, hreflang and sitemap below it, so look rather than assume.
4. Deploy, then check `https://rempireshop.com/robots.txt` and
   `https://rempireshop.com/sitemap.xml` return the live-domain versions, and
   that `curl -sI https://rempireshop.com/shop2/ | grep -i x-robots` returns
   nothing.
5. **Google Search Console** — the domain property `rempireshop.com` is already
   verified, so nothing needs re-verifying:
   - Sitemaps → submit `sitemap.xml`. One entry: it is a sitemapindex that
     names `sitemap-1.xml` (the 813 static URLs) and `sitemap-custom.xml`
     (the owner's own products, served by the app).
   - URL Inspection → Request indexing for `/shop2/`, `/shop2/et/`,
     `/shop2/en/`, `/shop2/sets/`, a couple of top products and
     `/shop2/info/shipping/` — the policy pages are what a shopper checks
     before paying and they have never been indexed before.
   - International Targeting → watch for hreflang errors for a week or two;
     "no return tags" means one of the three pages is missing an alternate.
   - Coverage → expect the old Shopify `/products/...` URLs to move to
     "Page with redirect" as the redirects are picked up.
   - Re-share a couple of product links in a Facebook/WhatsApp chat and in the
     Sharing Debugger to confirm the new cards render; the 125 products that
     used to share as a bare URL now have one.
6. Redirects from the old Shopify URLs: **done, 07.09.2026** — see below and
   `docs/audit/2026-09-07-seo.md`. Nothing to do at the switch beyond the
   `curl` sweep in that document's last section.
7. **Check one product's offer against the shelf, on the live site.** The
   availability a crawler reads is written by `setHead()` after the script
   runs, so `curl` cannot see it and neither can a static check — this is the
   one thing in here that has to be looked at in a browser:
   - Pick a product the panel shows as sold out, open its page, and in the
     console run `JSON.parse(document.getElementById("ldjson").textContent)
     .offers.availability`. It must end in `OutOfStock`, and the page must be
     showing «нет в наличии» with «Сообщить о наличии» rather than a buy
     button. Then do the same for one that is on the shelf and expect
     `InStock`.
   - Paste that product's URL into Google's Rich Results Test, which renders
     the page the way Googlebot does. Expect one `Product` with an offer and
     one `BreadcrumbList`, and **no second `Product`** — two would mean the
     prerendered block and the rewritten one are both present, which is what
     `id="ldjson"` exists to prevent.
   - Search Console → Shopping / Merchant listings, a week later: an
     "availability mismatch" warning there means the shelf and the head have
     drifted apart again. Nothing else reports it.

   Note that the Google Shopping **feed** is a separate, hand-run artifact and
   is not covered by any of this — see the first of the gaps below before
   submitting it.

## The old Shopify addresses

> **Since 08.10.2026 Shopify's addresses ARE the shop's** — a product, a
> section under its own handle, a brand, a policy page answer 200 directly.
> What still moves, and where, is the table in «URL move 2026-10» above; the
> table below is how the /shop2/ scheme answered them from 07.09 to 08.10.2026.

Every URL Google holds of rempireshop.com today is a Shopify one, and the
Search Console export of 07.09.2026 has **473 of them with impressions in a
single week** (`docs/audit/2026-09-07-seo.md`). They were answered by
**`src/middleware.ts` → `src/lib/legacy-redirects.ts`**, with a 301 each:

| old shape | where it lands |
|---|---|
| `/products/<handle>` | `/shop2/p/<id>/` when the handle is a catalogue id; else an alias, else `/b/<brand>/` when the handle starts with a brand slug, else `/c/all/` |
| `/collections/<handle>` | `/b/<brand>/` when the collection is a brand, else one of the seven sections, else `/c/all/`. 105 handles are mapped by hand |
| `/collections/<x>/products/<handle>` | the same as `/products/<handle>` |
| `/pages/<slug>`, `/policies/<slug>` | `/info/<slug>/`; an unknown one → `/info/contact/` |
| `/blogs/…` | `/blog/` |
| `/search?q=…` | `/search/?q=…` — the only query parameter that survives |
| `/cart`, `/checkout` | `/c/all/` (the basket is a drawer, the checkout is robots-disallowed) |
| `/account`, `/apps/…` | `/account/`, the home page |
| `/ru`, `/et`, `/en-lv`, `/en-lt`, `/en-fi` in front of any of the above | the same target with the language kept: `/ru` → unprefixed, `/et` → `/shop2/et/…`, the three English storefronts → `/shop2/en/…` |

**The query string is dropped.** 121 of the 473 ranking URLs carry Shopify's
product-feed query (`?variant=…&country=AE&currency=EUR&utm_source=google&
utm_medium=product_sync&…`) and 61 paths are indexed under more than one address
because of it; one target for all of them is the point.

Middleware rather than `next.config.ts`, because it is a lookup rather than a
pattern, because 1 639 config rules would be matched in order on every request
to the site, and because dropping the query needs a decision per shape. It runs
only for the paths in its `matcher` — none of which the new shop uses — and
`next build` reports it at **43.1 kB**, catalogue included (Vercel's edge
budget is 1 MB).

`docs/redirect-map.csv` is kept as the **test fixture**, not as run-time data:
1 447 of its 1 639 rows point at the home page, including every
`/ru/products/…` and `/et/products/…` row. `tests/legacy-redirects.test.ts`
walks all of them and asserts this code does better;
`e2e/seo.spec.ts` walks the twelve best-earning addresses through a real server.

**The old caveat is gone:** with `trailingSlash: true` Next 308'd
`/products/x` to `/products/x/` before any middleware ran, so an old link was
a 308 → 301 chain. Since 08.10.2026 there is no trailing slash and no Next
normalisation (`skipTrailingSlashRedirect`); every move is ONE 301, and
`tests/legacy-redirects.test.ts` walks all 1 639 rows of
`tools/harvest/old-urls.txt` to prove it.

## What the `Offer` may claim — availability

An offer that says `InStock` about something the page will not sell is the one
piece of structured data that is worse than none: Google drops the item from
the merchant surfaces, and a shopper who clicks an "in stock" result onto a
page with no buy button bounces. So the availability in the `Product` block is
held to one rule — **it says `OutOfStock` exactly when the shopper cannot buy
the product in any size** — and that rule is decided in three places that have
to keep agreeing.

| layer | file | what it decides |
|---|---|---|
| the shelf | `src/lib/inventory.ts` `stockStates()` | `byProduct` (the product's word) and `byVariant` (each size's), from one query |
| the feed | `src/lib/orders.ts` `getOverrides()` | merges those with the owner's manual «Наличие» and publishes `stock` + `stockByVariant` on `/api/overrides/` |
| the head | `public/shop2/app.js` `soldOut()` → `setHead()` | the `availability` in `#ldjson`, and the stock words in the meta description |

**The shelf already does most of the work, and this is the part that is easy to
get wrong twice.** `stockStates()` sets a product's word to `out` only when
every *counted* size is out **and** those sizes cover the whole ladder
(`inventory.ts`, the `allOut` loop) — with `!ladder ||` in front of the
coverage test, so a product whose ladder nobody can vouch for still reads
`out`. That means a one-size product counted to zero normally arrives at the
browser with `stock: "out"` already, and `p.stock === "out"` was a *nearly*
correct rule for the offer all along. Two things make it only nearly:

- a product carrying **more than one shelf row for the same bottle** — the
  «One bottle, two rows» state `db/migrations/194_one_size_stock_rows.sql`
  exists to clean up — has one row out and one not, so `byProduct` says `in`
  while `stockByVariant` says the size is gone. The page prints «нет в
  наличии» (`soloGone` in `screenProduct()`); the head used to print
  `InStock`;
- the head and the page were reading **different facts about the same
  bottle**, so nothing stopped them drifting apart again.

`soldOut()` is the page's own rule, moved where the head can use it: the
owner's «Наличие», or every rung of the ladder counted to zero. It is
deliberately the same three-way `screenProduct()` makes before it swaps the
buy row for «Сообщить о наличии».

**Absent is not empty.** A size nobody has counted is missing from
`stockByVariant`, and `soldOut()` returns false for it — the 17.09.2026
decision, and the failure mode that would cost the most if it were reversed:
reading absence as «out» would publish `OutOfStock` for most of the catalogue,
and nobody would notice until the impressions went.
`tests/size-stock-storefront.test.ts` pins both directions.

**The static file is a build-time snapshot; the rendered DOM is the truth.**
`tools/prerender-shop2.mjs` has no shelf to read — it writes the catalogue's
own `stock` into the page it saves. `setHead()` rewrites `#ldjson` in place on
every product render from the live feed, and Googlebot indexes the rendered
DOM, so the corrected offer is the one that is read. The request-time pages
(`src/lib/product-page.ts`, for the owner's `c-…` products) have the feed in
front of them and apply the same ladder rule directly.

What must not break: **`#ldjson` keeps its id.** `setHead()` rewrites that one
element and *removes* it on every screen that is not a catalogue product, so a
block that carries `id="ldjson"` anywhere else is deleted on boot, and a
product block that does not carry it is never corrected. `check-prerender.mjs`
asserts the split both ways.

One place deliberately still reads the product word alone:

- `src/app/sitemap-products.xml/route.ts` sets `priority` 0.4 for an out
  product and 0.7 otherwise from `Override.stock`. `priority` is advisory and
  Google ignores it, and reading the ladder here would mean a second data
  dependency on the sitemap's hottest path for a hint nobody consumes.

The Google Merchant Center feeds (`/feed/google-{en,et,ru}.xml`,
`src/lib/merchant-feed.ts`) do NOT read the product word alone: every size is
its own item, and a size counted to zero is `out_of_stock` while its siblings
are in stock — availability is the field Merchant Center suspends accounts
over. The old hand-run `tools/build-merchant-feed.mjs` and its static
`public/feed/google-shopping.xml` (staging links, file stock only) were
removed on 23.09.2026; `docs/merchant-feed.md` has the owner's steps.

## Structured data and IndexNow

Added 09.10.2026 (SEO audit of 08.10.2026, T8/T9). **The rule: the page says
what the Merchant Center feed says.** Nothing below is a number typed for the
structured data — every one comes from `src/lib/merchant-feed.ts`, the
functions the feed's items are built from, and `src/lib/seo-head.mjs` only
reshapes them into schema.org. `tests/structured-data.test.ts` parses the
JSON-LD back and holds it to Google's required fields and to the feed.

**Product** (`productSpec()` → `productOffersLD()` in `seo-head.mjs`):

- **One `Offer` per size** — the feed's items (`feedOffers()`): the same price,
  availability (a size counted to zero is `OutOfStock` on its own offer), the
  feed's item id as `sku`, and the feed's `?size=<slug>` link as `url`. A
  product sold in one size keeps the single `Offer` at the page's own address.
  The `Product`'s own `url` is the canonical (no query).
- **`shippingDetails`** per offer: `shippingFor(price, rules)` — the call every
  `g:shipping` entry is built from, over the checkout's own rules, so a free
  threshold applies exactly as it does to a basket holding that item. Per
  country the cheapest delivery the feed lists; countries with the same price
  and days share one entry. `handlingTime` 0–1 business days (`HANDLING_DAYS`),
  `transitTime` per zone (`TRANSIT_DAYS`: EE 1–3, LV/LT/FI 2–5, rest of the EU
  3–8). Only the countries the checkout delivers to (`sellCountries()`).
- **`hasMerchantReturnPolicy`** per offer (`returnPolicyLD()`): what
  `public/shop/legal.{ru,et,en}.js` «returns» states, and nothing else — a
  30-day finite window from receipt, by mail, back to Estonia (Mardi 1), the
  customer's label («The shop does not issue a return label»), the item in the
  condition it was received in, the money back to the original payment method;
  `applicableCountry` = the delivery countries; `merchantReturnLink` = the
  refund policy in the page's language. **No `returnFees`**: the text does not
  say who pays for the parcel back (owner TODO). The text excludes *opened*
  cosmetics only, which has no field and needs none.
- **`gtin8/12/13/14`** only for a barcode Renat bound to the size in «Склад»
  (`stock_levels.ean`) that passes `validGtin()` — on the offer of its size, or
  on the `Product` when it is sold in one size.

Who writes it: the prerender for the catalogue (it runs the TypeScript feed
module through Node's own type stripping — `tools/lib/ts-resolve.mjs` resolves
the `@/…` imports — and, if that cannot load, writes the single offer it
always did and says so); `src/lib/product-page.ts` for the owner's `c-…`
products at request time; and `setHead()` in `app.js`, which rebuilds the
offers per size from the live feed and keeps from the block the page was
**served** with what it cannot work out itself (`ldKeepServed()`): the item id
and barcode by address, the delivery by price (a price changed since the build
gets none rather than the old one's), the returns policy. When the live feed
has not answered — a crawler that may not fetch `/api/` — the served offers
stand as they are.

**Organization** (`ORG_LD` in the prerender): `geo` 59.430905, 24.759414 (the
pin of Mardi 1), `hasMap` (a Maps search for «REMPIRE Mardi 1 Tallinn» — the
place id `?cid=17186155096233197657` opens an empty place with no name, so it
is not used), `sameAs` + `https://rempire.ee`, `areaServed` = every delivery
country (`sellCountries()` over the stored rules), the address as the site
prints it (`Mardi 1`, `10145`, `Tallinn`), the shop-wide
`hasMerchantReturnPolicy` and `hasShippingService` (`shippingServiceLD()` over
`shippingTerms()`: per country the cheapest delivery below the free threshold
and 0 from it). `openingHoursSpecification` only when «Настройки → Контент»
has hours in `HH:MM–HH:MM` form — empty today, so none (owner TODO).

**BreadcrumbList** on product (home › section › product), section, brand
(home › «Бренды» on `/collections/brands` › brand) and article (home › blog ›
article) pages, on the new addresses, the same items the static crumb prints.

### IndexNow

Bing, Yandex, Seznam, Naver and the others take one POST to
`https://api.indexnow.org/indexnow` naming the pages that changed. The key is
public by design: `164a851b1f1b4b40060d4102b1aff9e8`, served as the whole
content of `https://rempireshop.com/164a851b1f1b4b40060d4102b1aff9e8.txt`
(`public/164a851b1f1b4b40060d4102b1aff9e8.txt`; the constant is in
`src/lib/indexnow.mjs`).

- **Day to day**, the panel does it: saving a product's override (price,
  stock, texts, photos, «Показывать в магазине» — not the salon price),
  creating, editing or hiding an own product, publishing, unpublishing,
  editing a live article or deleting one, and saving, switching or deleting a
  set call `submitIndexNow()` (`src/lib/indexnow-ping.ts`) with that page in
  three languages (plus the blog listing / sets landing). Fire-and-forget
  through `after()`: it never delays or fails the save. Only the production
  shop sends anything (`NODE_ENV=production`, `PUBLIC_BASE_URL` on
  rempireshop.com, `VERCEL_ENV` production when set); the same address is not
  sent twice within ten minutes (the panel autosaves).
- **Once after a deploy that moved pages** (as on 08.10.2026):
  `node tools/indexnow-submit.mjs --dry-run` reads the production sitemap
  index, lists every page it would send and checks the key file is live;
  `node tools/indexnow-submit.mjs` sends them (batches of 10 000).
  `--sitemap <url>` reads another sitemap.

## Known gaps

- **Product cards the assistant writes into an article have no `href`.**
  `src/lib/ai-prompts.ts` tells the model to emit `<a data-product="ID"></a>`
  with no href and no text; `src/lib/blog-html.mjs` `openTag()` only keeps an
  href that was already there. Such a card is an empty anchor to a crawler and
  to a reader with no JavaScript — only `blogProductHTML()` in `app.js` fills
  it in. Cards inserted with the editor's «Товар» button carry a real href and
  `data-price="live"` and are fine. The blog is the shop's only organic
  surface that is not competing on brand name, and these are its internal
  links to the catalogue.
- **`og:type` is `article` on a post page, but no `article:*` meta is
  emitted** — no `article:published_time`, `article:modified_time`,
  `article:author`, `article:tag`. `headBlock()` in `src/lib/seo-head.mjs`
  writes a fixed tag set with no hook for per-type extras; the values are all
  in hand at the call site. The `BlogPosting` JSON-LD carries the same facts,
  which is what Google reads, so this is a link-preview nicety rather than a
  ranking one.
- **A Markdown post body can publish a second `<h1>`.** The legal pages demote
  their headings and the blog body does not: an HTML body is safe because
  `sanitizeHtml` maps `h1 → h2`, but `renderBlock()` in `src/lib/blog-html.mjs`
  emits `<h1>` for a `# Heading` line, and `renderPostBody()` takes the
  Markdown branch for any body that does not open with a block tag. No post in
  the repository today is shaped that way — it is an open path, not a current
  defect.
- **Three merch products share one meta description in each language.** The
  «Three Elements» t-shirts (fire / water / air) have identical body copy, and
  `descFrom()` cuts the description from that copy without the product's own
  name, so the three pages are indistinguishable to a search engine. Fixing it
  is a content decision — see the note at the end of this section.
- ~~**Two fields are missing from every `Offer` on purpose.**~~ **Closed
  09.10.2026** («Structured data and IndexNow» below). The refund text that
  excluded "personal care goods (such as beauty products)" was rewritten
  (`public/shop/legal.*.js`): it now excludes only *opened* cosmetics, so
  `hasMerchantReturnPolicy` no longer contradicts the page it links to; and
  `shippingDetails` is not a number typed here but the Merchant feed's own
  `shippingFor()`, per item, per country. `priceValidUntil` is still left off:
  it is a promise with a date on it, and a past one reads as an expired offer.
- **The shop is shown almost entirely outside the countries it delivers to.**
  2 667 of 3 002 impressions in the week of 29.08–05.09.2026 were in countries
  the checkout cannot ship to. Where it *can* sell, its CTR is 5.7 %. That is a
  Merchant Center targeting decision, not a code one — question 3 of the audit.
- ~~`brands` is still shell-only.~~ **Closed 07.09.** It has its own
  prerendered page in all three languages — see "URL scheme" above.
- ~~Three things in app.js do not agree with the prerendered pages.~~ **Closed
  03.09.** `setHead()` now runs an info page's `<title>` through
  `trText(pg.title, S.lang, false)` (the English tab read «Доставка и оплата»
  over an English `<h1>`); `legalFor()` has its `LEGAL_EN` branch, so English
  policy pages take `public/shop/legal.en.js` the way the prerender already
  did; and `info`, `sets`, `set` and `gift` each set a `description` — the same
  sentence the static page carries, from the same dictionary, so a crawler that
  runs JS sees the head it was served. A **set** uses its own description, as
  the prerendered `/set/<id>/` does.
- **Two identities and two registration numbers.** The policy texts still trade
  as `REMPIRE (THEFLOW OÜ)`, registrikood 16320586, while the footer says
  `Rempire Store OÜ`, 12216136 — audit row 13. The policy pages are now
  indexable, so the wrong company is now the *published* one. Fix the texts
  before the switch, not after.
- **The English policy texts are broken** — 77 clause numbers glued to the next
  word (`1.1Seller`), "at the Web Web store" (audit row 14,
  `docs/proofread-report.md`). They are now prerendered, so they are what
  Google will read.
- Product descriptions are AI translations pending a native proofread (see the
  header of `public/shop/content.ru.js`). They are what the meta descriptions
  are cut from.
- The catalogue's OG cards carry no text — no name, no price, no logotype
  beyond the tower. That is deliberate (every platform sets the title and
  price itself, from the OG text fields, in its own type), but a card with the
  product name burnt in reads better in a WhatsApp thread. The cards drawn at
  request time — a custom product's, a new post's (`src/lib/og-card.ts`) — do
  carry the name and the price; giving the 220 build-time cards the same
  treatment is a follow-up, not a defect.
- ~~Social links still disagree.~~ **Closed 03.09.** The `Organization`
  `sameAs` used to name `instagram.com/rempireshop/` and
  `facebook.com/rempireshop/` while the shop links `rempire.shop` and
  `Rempire.Official.Tallinn`. Both now come from one place: `prebuild` runs
  `tools/pack-content.mjs`, which writes `DEFAULT_CONTENT` from
  `src/lib/content.ts` into `src/data/content.default.json`, and the prerender
  reads its `company` block for the identity tokens and its `social` block for
  `sameAs` (Instagram, Facebook, TikTok, YouTube — four links now, in the order
  the shop shows them). Which accounts are the live ones is still a question
  for Renat: `docs/OPEN-QUESTIONS.md`.
- `/info/contact/` is prerendered from those same defaults, mirroring
  `screenContact()`, instead of from the 2019 Shopify page in `legal.js` (which
  carried a stylesheet link to Shopify's CDN and a contact form that goes
  nowhere). The other four info slugs are still the policy texts.

### Meta descriptions: what is generated and what is a decision

Worth stating plainly, because it gets asked every time: **no page is missing a
meta description.** All 813 carry one, none is empty, and none exceeds 160
characters once HTML entities are decoded — which is how `check-prerender.mjs`
measures them, and the only honest way to, since `&amp;` is one character to a
reader and five in the file. The same goes for titles at 60. A sweep of the
generated pages on 18.09.2026 found **three** duplicate descriptions in the
whole catalogue (the «Three Elements» t-shirts) and no duplicate at all across
the other 217 products.

So the thing that would look like the obvious win — "write 220 unique
descriptions" — is not a gap to be closed by generating text. Where a
description is weak it is because **the product's own copy is weak**, and
inventing 220 replacements in code would ship filler that reads like filler and
that nobody has approved. If the owner wants them rewritten, the rule to agree
on first is:

> Lead with what the product *is* and who it is for, in the shopper's own
> words, then the differentiator, then the price and stock tail the builder
> already appends. Never repeat the title. Never a sentence that would be true
> of any product in the same section.

That is a content brief, not a code change. The machinery to carry it already
exists and needs no work: the product editor's «Google» tab holds a
title/description pair **per language** (below), the assistant can propose one
with `set_seo`, and a pair somebody wrote is used exactly as written with
nothing appended. The three t-shirts are where to start, because they are the
only case where the shop actively tells Google that three pages are the same.

## Titles and descriptions: one copy, three renderers (09.10.2026)

The `<title>`, the meta description and the link-preview pair of the home
page, the eight sections («Все товары» included), every brand page and the blog
list, and the rule a product title is built by, live in
**`src/lib/seo-copy.mjs`** — the words of the SEO audit's §1A, approved by Dim
on 08.10.2026. The prerender and the request-time pages import it; app.js
cannot import anything, so it carries a copy of the block between the
`seo-copy:start` / `seo-copy:end` markers, written by
`node tools/sync-seo-copy.mjs`. The prerender refuses to write a page while the
two differ, and `tests/seo-copy.test.ts` runs both copies over every page of
every kind in all three languages and wants the same head — which is what
ended the static «Habemehooldus — osta Rempire'ist» / rendered «Habemehooldus —
REMPIRE» pair (audit W4/T2).

Rules the module holds: titles ≤ 60, descriptions ≤ 155; no «— купить в
Rempire / osta Rempire'ist / buy at Rempire» filler (a product title is brand +
the maker's name + the type, with the price when it fits); a trailing «| REMPIRE»
in the house form «— REMPIRE»; the one figure the copy quotes — the free-delivery
threshold in the Estonian home description — comes from `settings.shipping_rules`
(`seoCtx()` in app.js, `SEO_CTX` in the prerender) and drops out when delivery
is never free; Russian aliases only where Search Console shows them
(«шампунь №1», «Ксерджофф Наксос»). The home page's `<h1>` is still `T.base`:
a heading is not a search snippet.

## Title and description per language (admin override)

The product editor's «Google» tab holds a title/description pair for each
storefront language (RU, ET, EN) — `data-edseolang` switches the pair, and
«Заполнить автоматически» writes the language on screen (or all three).
Storage: `product_overrides.seo_title` / `seo_desc` stay the Russian pair
(older rows and the assistant's `set_seo` proposal keep working), and
`seo_langs` (migration 130) carries the ET/EN pairs; `src/lib/product-seo.ts`
merges them and both `/api/admin/overrides/` and the public `/api/overrides/`
expose the result as `seo: {RU, ET, EN}`. At runtime `setHead()` picks the
page language's pair, then the Russian one, then the catalogue's static pair.
The prerender still writes the catalogue's static pair — the admin override
applies in the rendered DOM, which is what Googlebot indexes.

## Custom products — the page at request time

A product the owner created in the panel («+ Товар», the assistant's
`create_product`; `custom_products`, ids `c-…`, `src/lib/custom-products.ts`)
does not exist when `npm run prerender` runs — the build has no database —
so it has no static file. Its page is written **when the request arrives**
instead: `src/app/{,ru/,et/}products/[id]/route.ts` (`/shop2/{,et/,en/}p/[id]` before 08.10.2026) →
`src/lib/product-page.ts`, which takes `public/shop2/index.html` and patches
it between the same two marker pairs the prerender patches, through the same
builders. Those builders — `headBlock()`, `productSpec()`, the copy table
`T`, the sitemap row, `fitTitle()`/`clip()`/`esc()` — moved out of the
prerender into **`src/lib/seo-head.mjs`** (plain ESM, so the bare-`node`
prerender and the Next routes import one file); the prerender's output is
byte-identical to before the move.

What the served page carries, per language: `<html lang>`, `<title>` from the
owner's Google pair for that language, else the Russian pair, else
`brand + name — купить в Rempire · price` fitted the way `fitTitle()` fits
it; the meta description from the pair, else the description text (own
language, then Russian), else the price/section/stock sentence; canonical +
the four `hreflang` links; OpenGraph/Twitter; `Product` JSON-LD with the
offer (`id="ldjson"`, so `setHead()` rewrites it in place) and a
`BreadcrumbList`; and inside `#prerender` the brand, `<h1>`, price, sizes,
stock chip and description, which app.js drops after its first paint. The
owner's stock/price override (`product_overrides`) is applied, so a product
switched to «нет в наличии» says `OutOfStock`. `robots` follows
`PUBLIC_BASE_URL` exactly like the static pages (`robotsFor()` — one rule).

**Link previews:** uploads are WebP, which Facebook, WhatsApp and LinkedIn do
not read, so the card is drawn at request time from the row —
`src/lib/og-card.ts` behind `/shop2/og/c-<id>.png`
(`src/app/shop2/og/[file]/route.ts`): a white 1 200×630 PNG, the first photo
decoded from WebP and fitted on the left, the brand, the name (up to three
lines) and the price on the right, the tower mark and the wordmark in the
corner. No photo yet → the mark stands in; a photo the bucket will not give
→ the card is still drawn. The text is not SVG `<text>`: sharp rasterises
through librsvg, which shapes text only with fonts fontconfig can see — none
on a Vercel function, and `@font-face` is not honoured — so the glyphs are
taken out of the committed OFL fonts (`public/fonts`, the same TTFs the gift
card PDF embeds) with fontkit and written as `<path>`s, which need no font
at raster time. `og:image` carries `?v=<updated_at>` and the route answers
with an ETag from the same stamp plus a day of shared cache, so an edit is a
new URL to every scraper and an unchanged card is served from the edge. A
hidden product answers 404. The JSON-LD still lists the real photos, which
Google does read. Pinned by `tests/og-card.test.ts`.

**Hidden (`active=false`) and unknown `c-…` ids answer 404** with the shell
carrying `noindex, nofollow` — the address is dropped from the index and the
SPA still boots and shows the home page. A catalogue id that reaches the
route (a clone that has not prerendered) gets the plain shell, 200, as
before.

**Sitemap:** `public/sitemap.xml` is always a `sitemapindex` naming
`sitemap-1.xml` (static) and `sitemap-custom.xml` — a route
(`src/app/sitemap-custom.xml/route.ts`) that lists every active custom
product in the three languages with its `xhtml:link` cluster, `lastmod` from
`updated_at`. `trailingSlash` leaves paths with an extension alone, so it
answers at `/sitemap-custom.xml` exactly; `check-prerender.mjs` expects the
entry in the index and skips it.

Pinned by `tests/custom-product-page.test.ts` (head per language, the
fallbacks, overrides, 404s, the sitemap) and end to end by
`e2e/admin-products.spec.ts` (created through the UI, the served head, the
title after app.js takes over, «Сообщить о наличии», the sitemap, 404 once
hidden).

## Blog posts published after the build — the page at request time

The prerender writes the page at `/{,ru/,et/}blogs/news/<slug>` (until 08.10.2026
`/shop2/{,et/,en/}blog/<slug>/`) for the posts that are
published when `npm run build` runs (it reads them straight out of Postgres,
`tools/lib/blog-export.mjs`). A post Renat publishes after that deploy had
no page at all: the `/shop2/:path+` fallback handed a crawler — and a link
scraper — the Russian home page, and the article existed only once app.js
had fetched it (checked on staging: an unknown slug answered 200 with the
home page's head). Now `src/app/{,ru/,et/}blogs/news/[slug]/route.ts` →
`src/lib/blog-page.ts` writes the same page the prerender would have, from
the row, when the request arrives: the per-language Google pair with the
Russian fallback, canonical, hreflang, OpenGraph (`og:type: article`, the
card `/shop2/og/blog-<slug>[.et|.en].png` drawn at request time from the
cover — one per language, since the title on it is the post's), `BlogPosting`
and `BreadcrumbList` JSON-LD, the article inside `#prerender` with «Товары из
статьи» as links and «Другие статьи», plus the `#blogpost` / `#blogdata`
snapshots `hydrateBlog()` paints from. A draft, an unpublished post and an
unknown slug answer 404 with the noindex shell. `/shop2/{,et/,en/}blog/`
(`…/blog/route.ts`) does the same for the listing when the build wrote none.

**Served only when there is no static file** — by construction, not by
choice: Vercel's static layer answers a prerendered `index.html` before any
rewrite or route runs, and `next.config.ts`'s `afterFiles` rewrites do the
same locally. So the prerendered copy of an older post keeps its build-time
head until the next deploy (app.js re-syncs the body from the API either
way). Making the request-time page win always would mean the prerender stops
writing `/blog/` pages — a one-line change there, once that trade-off is
wanted; the request-time page is byte-compatible.

**Sitemap:** the prerender records the slugs it wrote pages for in
`src/data/blog.prerendered.json` (bundled by the `next build` that follows;
committed as `{"slugs":[]}` and restored before a commit like the other
generated files), and `sitemap-custom.xml` names every published post NOT in
that list — plus the `/blog/` listing when the build wrote none — so a new
article is in a sitemap the minute it goes live and an old one is never named
twice.

Pinned by `tests/blog-page.test.ts` and, end to end, by the «a post
published after the build» test in `e2e/admin-blog.spec.ts` (published
through the admin API, the ET head as the server sent it, the tab after
app.js takes over, the card, the sitemap, 404 once unpublished).
