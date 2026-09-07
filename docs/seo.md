# SEO: URLs, prerendering, sitemap

The storefront is a vanilla-JS SPA (`public/shop2/`). A search engine indexes
what the HTML says before any script runs, so every page a shopper could land
on is written out as a static file, in all three languages, by
`tools/prerender-shop2.mjs`. app.js then takes over in the browser.

**813 pages** — 271 per language: 220 products, 8 categories plus `all`, 26
brands **and the brands landing**, the home page, the 5 policy pages, 8 sets
plus their landing, and the gift card. Every one of them carries a 1 200×630
link-preview card that exists on disk. Verify with `npm run prerender:check`.

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
| policy page | `/shop2/info/<slug>/` | `/shop2/et/info/<slug>/` | `/shop2/en/info/<slug>/` |
| sets landing | `/shop2/sets/` | `/shop2/et/sets/` | `/shop2/en/sets/` |
| one set | `/shop2/set/<id>/` | `/shop2/et/set/<id>/` | `/shop2/en/set/<id>/` |
| gift card | `/shop2/gift/` | `/shop2/et/gift/` | `/shop2/en/gift/` |
| brands landing | `/shop2/brands/` | `/shop2/et/brands/` | `/shop2/en/brands/` |

`<cat>` is a catalogue key (`hair`, `styling`, `beard`, `face`, `body`,
`perfume`, `merch`) plus `all`. `<brand>` is the brand name slugified.
`<id>` is the product id from `public/shop/catalogue2.js`. `<slug>` is a key of
`LEGAL` in `public/shop/legal.js` — `shipping`, `returns`, `terms`, `privacy`,
`contact`; the router in app.js gates on that same object, so a page that
existed only in a translation could not be reached cold and is not written.
For sets, `<id>` is a `BUNDLES` id from `public/shop/bundles.js`.

**Note the singular `/set/<id>/` beside the plural `/sets/`.** That is what
`pathFor()` in app.js pushes and what `routeFromPath()` matches, so it is what
the prerender writes — an indexed URL and a clicked URL have to be one address.

The remaining screens — `search`, `account`, `checkout`, `done`, `admin` —
are client-side only and take the same prefixes (`/shop2/et/search/`). They are
deliberately **not** prerendered and **not** in the sitemap: every one of them
needs state to mean anything (an empty checkout renders an empty checkout),
every one is robots-disallowed, and a static copy of them would be a page that
lies. `tools/prerender-shop2.mjs` throws if one of them ever reaches the
sitemap, and `check-prerender.mjs` fails if one is found there.

**`brands` was the sixth of them until 07.09.2026** and is a real page now
(`brandsPage()` in the prerender): it was the one screen a shopper could land
on cold, so `/shop2/et/brands/` and `/shop2/en/brands/` were served the Russian
shell — the home page's title, the home page's description and a canonical
pointing at `/shop2/`. It has its own head, its own crawlable list of the 26
brand pages and its own sitemap row now (priority 0.5: it is a hub, below the
pages it links to). `f8a3926` had already taught `setHead()` to correct the
head once the script runs; this is the half a crawler without JavaScript
reads.

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

`prebuild` is `pack-migrations` → `pack-content` → `prerender`, so
`npm run build` regenerates everything before `next build`.

### What it writes

| path | what |
|---|---|
| `public/shop2/index.html` | **patched in place** — the Russian home page (see below) |
| `public/shop2/{et,en}/index.html` | the other two home pages |
| `public/shop2/{,et/,en/}c/<cat>/index.html` | 8 categories × 3 |
| `public/shop2/{,et/,en/}b/<brand>/index.html` | 26 brands × 3 |
| `public/shop2/{,et/,en/}p/<id>/index.html` | 220 products × 3 |
| `public/shop2/{,et/,en/}info/<slug>/index.html` | 5 policy pages × 3 |
| `public/shop2/{,et/,en/}sets/index.html` | the sets landing × 3 |
| `public/shop2/{,et/,en/}set/<id>/index.html` | 8 sets × 3 |
| `public/shop2/{,et/,en/}gift/index.html` | the gift card × 3 |
| `public/shop2/{,et/,en/}brands/index.html` | the brands landing × 3 |
| `public/shop/og/<id>.jpg` | one 1 200×630 card per product — drawn once |
| `public/shop/og/set-<id>.jpg` | one card per set — drawn once |
| `public/brand/og-default.png` | the card for pages with no photograph |
| `public/sitemap.xml` | a `sitemapindex`: `sitemap-1.xml` (…`-N.xml` above 1 000 URLs) **plus `sitemap-custom.xml`**, which is not a file but a route — see "Custom products" below |
| `public/sitemap-1.xml` | the 813 URLs with `xhtml:link` alternates |
| `public/robots.txt` | **the policy that matches `PUBLIC_BASE_URL`** |
| `public/robots.production.txt` | the open policy, for reading and diffing |
| `public/robots.staging.txt` | the closed policy, ditto |

813 pages — 271 per language: 220 products, 8 categories + `all`, 26 brands,
the brands landing, 1 home, 5 policy pages, 8 sets + the landing, 1 gift card.
`public/sitemap.xml`
is **always a `sitemapindex`**: the pages go into `public/sitemap-1.xml`
(`-N.xml` chunks of 1 000 above that), and the index also names
`sitemap-custom.xml` — the products the owner created in the panel, which do
not exist at build time and are listed by a route at request time (see
"Custom products" below). The checker follows the index and skips that one
entry, since it is not on disk.

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

| page | JSON-LD |
|---|---|
| home | `Organization` (also typed `Store`, with `alternateName`, `legalName`, `email`, `telephone`, `vatID`, `taxID`, `areaServed`, `sameAs` and an `@id`) + `WebSite` (`alternateName`, `publisher` → that `@id`) |
| category, brand | `BreadcrumbList` + `ItemList` |
| product | `Product` with `offers` (price, `EUR`, availability) + `BreadcrumbList` |
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

The chain, first hit wins: the page's own card → for a listing, the first
product's card → `/brand/og-default.png` (the tower alone, for the policy
pages and the gift card) → `/og-shop.png`. The last is the safety net for a
run where sharp could not load: it is committed, it is 1 200×630, and it keeps
the invariant true rather than falling back to a `.webp` no scraper reads.

### index.html is the shell *and* the Russian home page

Vercel serves `public/shop2/index.html` for `/shop2/`, and there is no way to
put a different file there. So that one file is **patched between markers**
rather than rewritten:

- `<!-- seo:start --> … <!-- seo:end -->` in `<head>` — the tool owns this.
- `<div id="app"><!-- prerender:start --> … <!-- prerender:end --></div>`.

Everything outside the markers is hand-maintained and survives every run: the
asset tags, the `?v=` token, the script list. The tool reads those from there
and copies them into the other 809 pages, so all of them always load the same
assets. If the markers go missing the tool refuses to run rather than guess.

The consequence: every non-prerendered `/shop2/` path (search, the cart, the
checkout) is served that same file, so its raw HTML carries the home page's
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
  single prerendered pages (`sets`, `gift`, `blog`) and the shapes whose id
  lives in a database rather than in a build-time file: `p/<id>`, `set/<id>`,
  `blog/<slug>`. Those three each have a route of their own that answers 404
  for an id nobody has — guessing here from a build-time file would 404 a post
  the owner published an hour ago.
* **404** — a category, a brand or a policy slug that does not exist (all three
  are closed sets known at build time and are checked against the catalogue and
  against the pages the prerender wrote), anything of another shape
  (`/shop2/cart/`, `/shop2/wat/`), and anything deeper than two segments.

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

## The old Shopify addresses

Every URL Google holds of rempireshop.com today is a Shopify one, and the
Search Console export of 07.09.2026 has **473 of them with impressions in a
single week** (`docs/audit/2026-09-07-seo.md`). They are answered by
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
only for the paths in its `matcher` — none of which the new shop uses.

`docs/redirect-map.csv` is kept as the **test fixture**, not as run-time data:
1 447 of its 1 639 rows point at the home page, including every
`/ru/products/…` and `/et/products/…` row. `tests/legacy-redirects.test.ts`
walks all of them and asserts this code does better;
`e2e/seo.spec.ts` walks the twelve best-earning addresses through a real server.

**One caveat:** `trailingSlash: true` means Next 308s `/products/x` to
`/products/x/` before any middleware runs, so an old link is a 308 → 301 chain.
Every `/shop/…` redirect in `next.config.ts` has always behaved this way.

## Known gaps

- **Two fields are missing from every `Offer` on purpose**, and both would put
  an extra line under a search result. `hasMerchantReturnPolicy` («Free 30-day
  returns») cannot be published while the refund text promises a 30-day window
  and then excludes "personal care goods (such as beauty products)", which is
  most of the catalogue — structured data must not contradict the policy page
  it points at. `shippingDetails` («Free delivery») needs one number per
  carrier per country and a wrong one is a Merchant Center suspension. Both are
  questions 5 and 6 of `docs/audit/2026-09-07-seo.md`. `priceValidUntil` is left
  off too: it is a promise with a date on it, and a past one reads as an expired
  offer.
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
instead: `src/app/shop2/{,et/,en/}p/[id]/route.ts` →
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

The prerender writes `/shop2/{,et/,en/}blog/<slug>/` for the posts that are
published when `npm run build` runs (it reads them straight out of Postgres,
`tools/lib/blog-export.mjs`). A post Renat publishes after that deploy had
no page at all: the `/shop2/:path+` fallback handed a crawler — and a link
scraper — the Russian home page, and the article existed only once app.js
had fetched it (checked on staging: an unknown slug answered 200 with the
home page's head). Now `src/app/shop2/{,et/,en/}blog/[slug]/route.ts` →
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
