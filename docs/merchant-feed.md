# Google Merchant Center: the shop's own product feed

Merchant Center account **5819586565** («Rempire Tower Shop») brings about
**175 free clicks every 28 days** (19.09.2026). All of its products come from
six **Shopify App API** data sources. The day `rempireshop.com` points at the
new shop, those six stop updating, and the free listings fade out with them.

The new shop now has its own feed for that day. This page says what it is and
exactly what to click. Where the page says **(check the wording)**, the
Merchant Center button or menu may be named a little differently from what is
written here. Google renames things often. Look for the nearest match.

---

## What was built

Three feed addresses, one per language. The shop builds each one fresh
whenever Google asks for it:

| Feed | Address | Language |
|---|---|---|
| English | `https://rempireshop.com/feed/google-en.xml` | English |
| Estonian | `https://rempireshop.com/feed/google-et.xml` | Estonian |
| Russian | `https://rempireshop.com/feed/google-ru.xml` | Russian |

- **Every item comes from the live shop**, the same way the product page
  and the checkout get it:
  - the price of every size
  - stock, size by size
  - «Показывать в магазине»: a hidden product is left out
  - the owner's own photos and descriptions
  - the brand
  - the barcode, where Renat has scanned one in «Склад»
  - the delivery price to every country the checkout offers
- **Each size is its own item.** A shampoo sold in 75, 250 and 500 ml is
  three items, grouped together. Today that is **322 items from 220
  products**, plus any product the owner created in the panel that has a
  photo.
- **Prices include 24 % VAT**, the same as in the shop. There are no sale
  prices, because the shop has none.
- **The feed can be up to one hour behind the shop.** It is cached for an
  hour at most. Google fetches it once a day.
- **You can look at the feeds before the switch.** They open on staging,
  for example `https://rempireshop.diipsolutions.eu/feed/google-en.xml`. The
  product links inside already point at `rempireshop.com` on purpose, so
  before the switch those links still open Shopify.
- **The product IDs are new.** For example
  `system-4-bio-botanical-shampoo_250ml`. Shopify used its own IDs. To
  Google, every item in our feed is a new product. It reviews each one
  before showing it, which usually takes **1–3 days**. That is why the
  Shopify sources stay on until ours are approved.

**What the new feed cannot replace:** the Shopify sources also cover Belarus,
Georgia, Kazakhstan and 82 other countries. The new shop's checkout delivers
only to Estonia, Latvia, Lithuania, Finland and 21 other EU countries. The
Shopify listings in the other countries end when Shopify ends, and nothing
here brings them back. That is expected, not a fault.

---

## A. Before anything else (any day before the switch)

1. Open <https://merchants.google.com> and pick the account **Rempire Tower
   Shop (5819586565)**.
2. Go to **Products → All products** and **download** the full list with the
   download button above the table (check the wording). Keep the file. It is
   the record of what Shopify listed: 328 products per market.
3. Go to **Settings (gear icon) → Data sources**. Take a screenshot of the
   **six Shopify sources**: their names, languages and countries. You need
   this for step E.
4. Go to **Settings → Shipping and returns**. Take a screenshot of the
   shipping policies. Today they say **€15.00, 4–12 days** for every
   country.
5. Go to **Settings → Business info → Website** (check the wording). Check
   that the verified and claimed website is **rempireshop.com**. If it is
   another domain, stop here and tell Dim. Every link in our feed is on
   `rempireshop.com`, and Google rejects links to a website the account has
   not claimed. This is the go-live item «google-domain».
6. **In Shopify, leave the Google & YouTube app alone.** Do not delete it,
   do not disconnect it, and do not close the Shopify store. Shopify is the
   backup until our feed is approved (step E).

## B. On the day of the switch, after rempireshop.com opens the new shop

1. Open `https://rempireshop.com/feed/google-en.xml` in a browser. You
   should see text that starts with `<?xml` and `<rss`. Copy one `<g:link>`
   address into the browser. It must open the product in the **new** shop.
   If it opens Shopify, the domain has not switched yet: wait.
2. In Merchant Center, go to **Settings → Data sources → Add product source
   → Add products from a file** (check the wording).
3. Choose **Enter a link to your file** (check the wording) and paste
   `https://rempireshop.com/feed/google-en.xml`.
4. Fill in the rest:
   - **Name:** `Rempire — own feed — EN`
   - **Language:** English
   - **Countries:** Estonia, Latvia, Lithuania and Finland. Add the rest of
     the EU the shop delivers to if you want listings there as well:
     Austria, Belgium, Bulgaria, Croatia, Czechia, Denmark, France, Germany,
     Greece, Hungary, Ireland, Italy, Luxembourg, Netherlands, Poland,
     Portugal, Romania, Slovakia, Slovenia, Spain, Sweden.
   - **Fetch schedule:** daily, at **06:00, Europe/Tallinn time zone**.
   - Save.
5. Add the Estonian feed the same way:
   - address `https://rempireshop.com/feed/google-et.xml`
   - name `Rempire — own feed — ET`
   - language **Estonian**
   - country **Estonia**
6. Add the Russian feed the same way:
   - address `https://rempireshop.com/feed/google-ru.xml`
   - name `Rempire — own feed — RU`
   - language **Russian**
   - countries **Estonia, Latvia, Lithuania**, but only if Merchant Center
     offers them for Russian.

   I am **not sure** Google accepts Russian-language listings in these
   three countries. If it only offers countries such as Belarus or
   Kazakhstan, cancel this step. The shop does not deliver there, and a
   listing the shop cannot deliver would be disapproved.
7. On each new source, press **Fetch now** (check the wording; it may be
   under the source's menu). This starts the first fetch at once, so you do
   not have to wait until tomorrow morning.
8. **Do not touch the Shopify sources today.**

## C. Shipping: let our feed decide

Our feed carries its own delivery price for every product and country,
the same price the checkout charges:

- the cheapest parcel locker or pickup point, and the cheapest courier;
- **€0** where the product alone reaches the free-delivery threshold:
  **€59** in Estonia, Latvia, Lithuania and Finland, **€200** in the rest of
  the EU.

For example, a €15 product costs €2.49 by locker and €10.84 by courier in
Estonia, €9.39 and €15.69 in Finland, and €5.49 and €7.09 in Poland.

Google uses the price written on the item before any account-level shipping
policy. So the Shopify flat €15.00 policy cannot override our prices. This
is what to do about it:

1. **While both feeds run, change nothing.** The €15.00 policies still
   describe the Shopify listings.
2. On the second day, open **three of our products**: **Products**, filter
   by the data source `Rempire — own feed — EN`, then click a product. Look
   at its shipping, which should be per country. It must show our price, for
   example Estonia €2.49, and not €15.00 (check the wording). If it shows
   €15.00, stop and tell Dim.
3. After step E, when the Shopify sources are gone, go to **Settings →
   Shipping and returns** and **delete the Shopify shipping policies**.
   Nothing else uses them by then.
4. Delivery **times** are not in the feed yet. If Merchant Center flags our
   items for a missing delivery time (check the wording), tell Dim. The feed
   can carry the times too: 1–3 days in Estonia, and so on.

## D. Watch it for 1–3 days

1. Once a day, open **Products → All products** and filter by each of our
   three data sources.
2. The statuses you will see (check the wording):
   - **Under review / Pending:** normal for up to 3 days. The IDs are new.
   - **Approved:** listed.
   - **Limited:** listed, but with a warning.
   - **Not approved:** not listed. Open it to see why.
3. The warnings to expect, and what they mean:
   - **Missing GTIN / "limited performance due to missing identifiers"**
     (check the wording). The product has no barcode in the feed yet. When
     Renat scans the bottle's barcode in «Склад», the next day's fetch
     carries it. The shop's own brand (Rempire merch and soaps) is marked as
     having no barcode, which is correct.
   - **"Mismatched price" on a bigger size** (check the wording). The
     product page opens on the smallest size, so Google's crawler reads that
     size's price. If this appears for the larger sizes, tell Dim. Also look
     in **Settings → Automatic improvements → item updates** (check the
     wording). If Google is "correcting" the 250 ml price down to the 75 ml
     price there, switch off the automatic **price** updates.
   - **Image too small:** some product photos are narrow bottle cut-outs,
     only 109–249 pixels on the short side. Google's minimum is 100, so they
     pass, but bigger photos would do better.
4. In **Settings → Data sources**, click each of our sources. The last fetch
   should say it succeeded, with about 322 products for the EN and ET
   feeds. If a fetch failed, press **Fetch now** again later.

   The shop answers "try again later" on purpose when its database does not
   respond, so that Google keeps yesterday's items instead of taking a
   half-built list.

## E. Remove the Shopify sources, only after ours are approved

1. Wait until **most of our items show Approved** in all the markets you
   chose. This takes at least a full day, and usually 1–3 days.
2. Compare with the file from step A.2. About 100 Shopify products are not
   in the new shop, because Shopify listed 328 products and the new shop has
   about 224. Those listings will end. Nothing needs doing about them unless
   one of them should still be sold.
3. Go to **Settings → Data sources**. On each of the **six Shopify App API**
   sources, open the menu and choose **Delete / Remove source** (check the
   wording).
4. If a Shopify source comes back by itself the next day, the Shopify app is
   re-creating it. In Shopify admin, open **Google & YouTube** and turn off
   product syncing there (check the wording). Keep the app installed.
5. Then delete the Shopify shipping policies (step C.3).

## F. A week later: compare the clicks

1. Open **Performance** (check the wording) and choose the last 28 days,
   free listings.
2. Compare with the baseline: **175 clicks in 28 days** (19.09.2026).
3. A clear fall nearly always has one of two causes:
   - items not approved: see **Products → Needs attention**;
   - a delivery price or product price that disagrees with the product page.

   Send Dim a screenshot of either one.

---

## For the next developer

| | |
|---|---|
| Route | `src/app/feed/[file]/route.ts`: `google-en.xml`, `google-et.xml`, `google-ru.xml`. Any other name is a 404, and a database failure is a 503. Cache-Control is `public, max-age=0, s-maxage=3600` with no stale-while-revalidate, because Google fetches once a day and would always get the stale copy. |
| Builder | `src/lib/merchant-feed.ts` (`buildFeed()`, pure, and `loadFeedInput()`). |
| Photos and texts | `src/data/catalogue.feed.json`, written by `tools/pack-feed.mjs` (in `prebuild`) from `public/shop/catalogue2.js` and `content*.js`. A Vercel function cannot read `public/`, so the data is imported. `tests/merchant-feed.test.ts` fails when the committed copy is stale: run `npm run pack:feed`. |
| Links | `liveBaseFrom()` in `src/lib/seo-head.mjs`. It uses `PUBLIC_BASE_URL` when that is `rempireshop.com` or `www.`, and `https://rempireshop.com` otherwise. A staging or preview copy never emits its own host. |
| Price | `rungsOf()` restates `priceItems()` in `src/lib/orders.ts`: the owner's ladder, else the file's ladder shifted by his «Цена», else the file. The test prices items through `priceItems()` itself. |
| Availability | The stock word from `getOverrides()` plus `stockByVariant`: a size counted to zero is `out_of_stock`. Hidden products are left out. |
| Shipping | `shippingFor()`: `quoteFromRules()` over `settings.shipping_rules` for each carrier `offeredCarriers()` lists, the cheapest per country for parcel (only where `pickupOffered()`) and for courier, with the item's price as the subtotal. Countries are EE, LV, LT, FI and `EUROPE` minus `countriesOff`. Per item, both services, about 2.3 MB per feed raw and about 100 KB gzipped. |
| IDs | The product id, plus `_<size>` for one size of several. Ids longer than 50 characters get a shortened, hashed stem (`idStem()`). `item_group_id` is the stem. |
| GTIN | `stock_levels.ean`, only when it is a valid GTIN-8/12/13/14 outside the in-store ranges. `identifier_exists=no` only for the brand Rempire. |
| Not in the feed | Sets (bundles); gift cards; custom products with no photo, whose placeholder SVG Google cannot read; `unit_pricing` beyond ml/g sizes; delivery times. |

Known data gaps (23.09.2026, catalogue files; the database can only add to
these):

- **No barcodes in the catalogue files.** Every GTIN has to come from
  «Склад», so until Renat scans them, the 272 non-Rempire items carry a
  brand and no GTIN.
- **2 product names are Russian only** («Чёрное мыло 666», «Розовое мыло
  Rule Nr 1»). They stay in Russian in the EN and ET titles.
- **26 main photos are under 250 px on their short side.** None are under
  Google's 100 px minimum. 150 products have only one photo.
- **The Russian Shopify markets (BY, GE, KZ…) and the 82-country source**
  cannot be served: the shop does not deliver there.
