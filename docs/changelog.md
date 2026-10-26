# Rempire — what changed since launch

*Live on rempireshop.com since Thursday 08.10.2026, 22:55 (first full day 09.10).
One line per change that a shopper, Renat, Google or a future developer would
notice; the commit says how. Kept weekly until the handover on 09.11.2026,
where it becomes the «what was done» summary.*

## Week 1 — 08.10 → 11.10

**Launch night (08→09.10)**
- DNS switched to the new shop (Vercel); Shopify's address scheme kept so old links and Google's index still land: English unprefixed, `/ru`, `/et`, `/products/…`, `/collections/…`, no trailing slash (81cc4725). Old `/shop2/…` addresses answer one 301.
- Shopify variant links (`?variant=`, `/en-xx/`, `/cart/…` from Merchant Center) map to our sizes (3ee5147b).
- Structured data: one Offer per size with delivery prices and the returns policy, from the Merchant feed (2798ec15). IndexNow key + submit tool; 849 addresses accepted (d16383ce).
- SEO pack 1: approved titles and descriptions in three languages, OG cards per language, brand intros, `llms.txt`, AI crawlers allowed, delivery page prices fixed, product names without medical claims (ef7369f9).
- Real `<a href>` links and `<img>` photos in the storefront, same look (12b724d6).
- Subcollection pages for six existing chips at Shopify's old handles (8943f498, bb634b57).
- Speed: immutable cache for versioned assets, admin styles only in the panel, texts and dictionary off the first paint — slow phones ~35 % faster to first paint (5e926c07).
- GitHub «Smoke (deployed)» workflow tests rempireshop.com after every production deploy and on a schedule (d3e9981c).

**09.10**
- Home page heading = the approved home titles (865d7e5f); subcollection pages carry their own heading (2327fa04).
- Free Baltic delivery from 70 € stated in the home descriptions and in the Merchant feed (238264f7).
- Estonian copy fixes; Kevin.Murphy product types; natural ET/EN type names (71f58e9e, e7f0586b).
- Product descriptions as whole sentences, hand-written ones for the most searched products; sitemap dates only for real edits (235cabf2, 5a34da07). A System 4 chooser on the brand page was tried and reverted at Dim's request (30a53aa4).
- Nightly rebuild through a Vercel deploy hook (03:30 UTC) and after a blog post is published, unpublished, edited or deleted; CI runs typecheck + unit tests per push, the browser suite weekly (37eb0d4c).
- Merchant Center: our EN and RU feeds added beside Shopify's six; account return policy set. Search Console: indexing requested for the home pages and sections.
- Tower icon at `/favicon.ico` and `/apple-touch-icon.png` — browsers kept Shopify's «R» (24d3a0e7).

**10.10 — Search Console «Merchant listings» fixes**
- Product `sku` at most 50 characters (the feed's id), Google's own category code instead of the section name, and the page script keeps the served values — Google reads the script-rewritten block (1814f468, b7c89a54).
- Set pages carry delivery and the returns policy (b5a8346b).
- Returns: free, except orders delivered by Nova Post (the customer's cost) — the returns page says so in three languages; the markup: free in EE/LV/LT, customer-paid elsewhere (e11ca738).

**11.10**
- Product data after the page script runs: delivery kept for a price changed since the build (unless it crosses a free-delivery threshold), product name in the page's language (5e890cc5). Search Console validation restarted.
- GitHub Actions storage: failure reports trimmed to the HTML report, kept 2 days; the 49 old reports (1 GB) deleted with Dim's OK (466a2f65).

## Week 2 — 12.10 → 18.10

**12.10**
- Search Console «Page with redirect»: the sitemap Google had was read on 08.10, before the move; resubmitted. Every current sitemap address answers 200.
- Handover plan for 09.11: phase C of the go-live list, at `rempireshop.diipsolutions.eu/handover` — Dim's own address only; rempireshop.com never serves the page or phase C's rows (host-gated rewrite and route). It went live on rempireshop.com for a few minutes first and was reverted at Dim's request. Logins sheet template for Renat kept outside the repository.
- Weekly e2e run fixed (separate session): nine specs followed the launch-night changes; one real bug — the blog translator left a product card in Russian in the Estonian and English text (e314a329); e2e shards get 60 minutes (7008909d).
- Search Console indexing requests: 11 Russian section and brand pages that Google had crawled but not indexed (most English and Estonian pages already were).

**13.10–15.10**
- Abandoned-cart mails to `@storebotmail.joonix.net` checked: Google StoreBot's checkout tests (one cart per address, language of the page) — not a bug.
- «Blocked by robots.txt» mail: only old Shopify cart/account addresses; none of the 849 sitemap addresses is blocked.
- Search Console indexing requests: 9 more Russian brand pages.

**16.10**
- Merchant Center: our EN and RU feeds 607 of 629 items approved (the rest are policy cases such as CBD); Shopify's six data sources deleted by Dim — Google Shopping now runs on rempireshop.com's own feeds.
- Russian Google descriptions of System 4 shampoos №1–4 say «номер N», as people search (543d1ade).
- Hand-written Google descriptions (RU/ET/EN) for the twelve most-shown Kevin.Murphy products; Estonian intros of «Habemehooldus» and «Juuksehooldus» rewritten in the words people search (Dim approved both).
- Merchant Center return policy re-created after Dim removed the old one: the same 24 EU countries, 30 days, by mail, return postage the customer's (Google's «free return» needs a label the shop provides, which it does not) — status Verified.
- Photo cut-out moved to gpt-image-2.5-sunburst — gpt-image-1 shuts down on 23.10.2026; the feature stays off in production (43fa2d2f).
- Shop chat, admin text generation and AI search moved to gpt-6-luna (no reasoning, same caps and wording) — gpt-4.1-mini shuts down on 14.01.2027; about 70 % cheaper per call (b2572d9f). Dim removed the old `OPENAI_MODEL=gpt-4.1-mini` from Vercel and redeployed; live search and shop chat checked on gpt-6-luna. Photo cut-out is on in production (`PHOTO_CUTOUT=openai`) — its first live run on the new image model is still to do.
- CI was red since d2ce0c07: the section-intro test still held the two longer Estonian lines to one line's length; it now knows they are approved.
- Google Business Profile: the Maps profile «REMPIRE» (tattoo salon, 222 reviews) links only to rempire.ee and is managed by another account; Renat asked to add the shop account as manager. rempire.ee has no link to the shop yet.

**17.10**
- Search Console indexing requests (the daily quota): the Estonian «Juuksehooldus» section, the four Russian System 4 shampoo pages, and six Kevin.Murphy products with new descriptions — Super Goo was not in Google's index at all.

**18.10**
- Search Console indexing requests: the other six Kevin.Murphy products with new descriptions, System 4 shampoo №2 (RU) again, and the Russian pages of Super Goo, Hydrate-Me Masque, Heated Defense and Touchable — Russian Heated Defense and Repair-Me Wash were not indexed yet.

## Week 3 — 19.10 → 25.10

**20.10**
- Search Console indexing requests: Russian Repair-Me Wash (not indexed yet) and the other seven Russian Kevin.Murphy pages with new descriptions — all twelve now asked for in English and Russian — plus Estonian Super Goo, Heated Defense and Repair-Me Wash.
- The admin assistant can now fix the article open in the blog editor («сделай товары ссылками на магазин», «исправь второй абзац»): every language changed, product names linked only to the shop's own pages, saved with «Вернуть» on the message. First case: a Kevin.Murphy shampoo article whose products were plain words.
- An article's «Товары в статье» list holds up to 40 products (was 12); products the assistant links in an edit join it. The shelf under the article still shows the first 8.
- «Rempire» connector for Renat's Claude (`https://rempireshop.com/api/mcp`): Claude finds the shop's products, prices and addresses in three languages, reads the blog and saves an article as a DRAFT — never publishes. Signed in with the admin password (OAuth, Claude's own «Подключить»); changing the admin password signs it out. docs/claude-connector.md. Dim connected it and saved a test draft the same evening; after that: product photos as cover and pictures in the text, and the admin's «Блог» list refreshes itself (a draft from Claude showed only after a reload).

**21.10**
- Search Console indexing requests: the nine Estonian Kevin.Murphy pages with new descriptions (all twelve now asked for in all three languages) and the Russian System 4 shampoo guide — the guide was not indexed in any language; its Estonian and English pages are next.

**22.10**
- All four published articles are now indexed in all three languages. Search Console week 14–20.10 vs 7–13.10: impressions +29 %, clicks to pages 23 → 50; average position 13.8 → 17.7 overall, but Estonia steady (9.3 → 9.7, clicks 5 → 14) and Russia steady (11.5 → 11.3) — the drop is impressions from countries the shop barely serves (India, Australia, UK, US, Netherlands) at positions 17–41 and new long-tail English queries. Pages report: 1 050 indexed; of 1 630 not, most are old Shopify addresses (redirects, /en-xx/ markets, ?page=); ~270 «crawled, not indexed» include real Russian product pages. Requested: the Russian beard section and seven Russian product pages (+ Super Goo, already indexed).

**23.10**
- Search Console, our own sitemap only: 782 of 849 pages indexed. The 67 left: 47 not yet crawled (the sets pages, brand pages such as Paul Mitchell, Xerjoff, Tom Ford, Versace, Byredo, and the new Kevin.Murphy Flawless), 14 crawled but not indexed, 3 legal pages Google still holds as blocked by Shopify's old robots.txt (today's robots.txt allows them), 3 canonical. Russian product pages are now indexed almost throughout. The quota ran out after one request (Kevin.Murphy Flawless, English); the rest is queued.
- Search report before/after launch, with competitors, Bing and AI search, as two dashboards (English for Dim, Russian for Renat) and a Russian PDF. Baseline: Google's AI answers show the shop ~39 times a day (21 before launch); in a 7-question test ChatGPT named the shop 4 times, Perplexity once (by name only); Copilot 0 citations.
- Bing Webmaster Tools: Bing has indexed only 128 of the shop's addresses (0 errors, 10 warnings). Submitted 100 by hand (home pages, gift sets, Estonian and English sections and brands); the other 53 (Russian sections, the last English brands) are tomorrow's quota.
- Google descriptions of the System 4, Kevin.Murphy and Captain Fawcett brand pages (three languages) now say «in stock in Tallinn», pickup at Mardi 1 and free Baltic delivery from 70 € — the threshold read from the delivery settings; the pages themselves look the same (Dim, plan step 3a).
**25.10**
- Search Console indexing requests (quota after 11): both Tom Ford Black Orchid pages again (the last two items of the «returnFees» Merchant-listings warning; the live pages are correct), the Estonian Kevin.Murphy, System 4 and Captain Fawcett pages (new descriptions), and the gift sets «beard-start» and «gift-rempire» in three languages — not in Google yet. The Russian and Estonian Kevin.Murphy Flawless pages were already indexed.
- Bing: the other 53 sections and brands plus 47 System 4, Captain Fawcett and Kevin.Murphy product pages submitted — every section, brand and set page is now with Bing.
- Orders R-100107/R-100108 and R-100110/R-100111 checked: the first of each pair was not paid (the customer left the bank page; Montonio marked it failed), the customer ordered again and paid. Not a payment bug, but the 3-day «order awaits payment» reminder went to the first customer although they had paid the second order.
- Unpaid order paid on a second try: when the same e-mail paid an order placed within 24 hours after an unpaid one, the daily run now cancels the unpaid one with no letter (journal: «reordered» and the paid order's number) instead of sending «ждёт оплаты» on day 3 and «отменён» on day 7 (Dim, 25.10). Orders younger than two hours are left alone.
- Google descriptions of product pages (all products, three languages) end with the price, «in stock» while sizes are left, the free Baltic delivery threshold from the delivery settings and pickup — e.g. «… · alates 9 € · laos · tasuta tarne alates 70 € · järeletulek Tallinnas». Hand-written lines keep every word and get the price where it fits. Reason: Google cut the price off our titles in Estonian results while competitors showed theirs (Dim, plan step 1). «Out of stock» is still never written.
- Shop statistics: a visit from a Google Ads click (gclid, or the campaign label utm_source=google-ads) is listed as «ads.google.com» under sources, so the €20 Shopping test can be told apart from normal Google results.
- Google Ads test published by Dim: Shopping, Estonia only, System 4 and Captain Fawcett, €20 in total, 25.10–08.11, manual bids of €0.25. The card on the shop's Ads account is not Dim's; Renat is asked whether it may be used.
- Handover list (phase C, Dim's address only) brought up to date: handover on 08.11; Merchant Center feeds and return policy done; three new rows (Google Ads card, Cloudflare card, Renat's own Claude connector). The documents are written from about 02.11, not before — the code still changes (Dim).
- The old overview page `/guide` («что уже готово») removed at Dim's word, with its `/guides` address and the links to it on `/test` and `/golive`; the unused `@vercel/blob` package removed from the code (nothing has read that storage since 07.09).
- Top strip names Europe and reads as one sentence: «Бесплатная доставка по Балтии от 70 €, в Финляндию и остальную Европу — от 200 €» (ET/EN alike; on a phone «Бесплатно: Балтия от 70 €, Европа от 200 €»). It replaces «Эстония от 70 € · LV, LT от 70 € · Финляндия от 200 €»; the amounts still come from the delivery settings (Dim).
- The strip, the footer and the product page no longer flash «от 59 €» for a moment while the page loads: their starting amounts are the live ones (Baltics 70 €, Finland and the rest of Europe 200 €) instead of the old 59 € (Dim). When «Бесплатно от» changes in «Доставка и оплата», those starting numbers in `public/shop2/app.js` (`THRESH`) should follow.
- What search engines and AI read about delivery no longer says «Baltics and Finland only» (a customer in Spain thought the shop would not ship to him). The home page's static text: «Доставка в 25 стран Европы. Бесплатно: по Балтии от 70 €, в Финляндию и остальную Европу от 200 €. Самовывоз на Mardi 1.» (ET/EN alike), the count and the amounts from the delivery settings; the info pages' descriptions the same sentence; the home descriptions «доставка по ЕС, по Балтии бесплатно от 70 €» (the Estonian one said «free from 70 €» without «Baltics»); the sets page and the Creed, Xerjoff and Byredo descriptions «доставка по ЕС». Shoppers see no change: none of these texts is on screen (Dim).
- Product editor «Для Google» → «Заполнить автоматически»: the AI now writes from the product's description in that language (it was sent the name, brand and section only, and 29 products got «Других сведений о продукте нет», «Toote kohta pole lisateavet», «The catalogue gives no further product details», even «В INPUT нет данных» as their Google description — Renat's videos). The prompt forbids talk about missing data, and such a sentence is dropped if one still comes back.
- Every product's name, brand and section can be changed in its card («Что за товар»), not only the owner's own products — the catalogue's ~220 said «их меняет Дим» (Renat, 26.10: «Не могу поменять название»). Stored as the owner's override (migration 224); the shop, search, cart, letters, invoices, «Склад», «Аналитика», promo codes, the Merchant feed and the static pages all follow, the static pages after an automatic rebuild. The page address and the feed's offer id never change; orders keep the name they were bought under. A name whose type word the shop cannot translate is refused, with similar known words suggested (Dim, 26.10). «Вернуть» in the journal puts the old name back.
- The «Rempire» connector for Renat's Claude can write a product's Google texts (RU/ET/EN, `save_product_google_text`): saved live, held to the same rules (length, language, no «нет данных»), each save a line in Админка → Журнал with «Вернуть». The connection page lists it (Dim, Renat).

## Week 4 — 26.10 → 01.11

**26.10**
- Renat's Claude («Rempire» connector) can change a product's page description (`save_product_description`) and its name, brand and section (`save_product_name`), besides its Google texts — the rules are the panel's own: plain text in three languages, no Russian on the Estonian and English pages, no «нет данных», a name every language can say (a type word the shop cannot translate is refused with the list of words it can). Each change is live at once and a journal line «… через Claude» with «Вернуть». Prices, stock, publishing and orders stay out of its reach. The connection page lists the new rights (Dim).
- «Вернуть» in the journal now also works for the owner's own products («c-…»: name, section, description, Google texts, sizes and prices), from any device — before, only the device that made the change could take it back. A Google text Claude writes for an own product lands on the product itself, where the panel keeps it, not in the catalogue overrides.
- Renat's Claude can change prices (`save_product_price`) and shelf counts (`save_product_stock`). A price that moves more than 30 % is saved only after Claude asked and Renat said yes (a typo like «5 €» for «50 €» is money); a count is saved only if nothing was sold or scanned since Claude read it — otherwise it says the new count and asks again. Prices have «Вернуть» in the journal; counts are in «Склад → История» as «Claude» (Dim).
- Renat's Claude can create a new product (`create_product`): always hidden — nobody sees it until Renat adds photos in «Товары → Скрытые» and turns on «Показывать в магазине». A product he already has is not created twice. The price check now compares with the price before Claude's first change of the day, so several small cuts cannot add up to a big one unasked (security review).
- The words of the section and brand pages — the Google title and description and the line under the heading, in three languages — can be changed without Dim: Renat's Claude writes them now (`save_page_text`), and «Настройки → Тексты страниц» follows. Stored as the shop setting `page_texts`; the shop shows them at once, the static pages after an automatic rebuild. Nothing changes until Renat writes something: the approved texts stay (the section lines moved from the shop's script into the shared SEO copy word for word).
- «Настройки → Тексты страниц»: every section and brand page in a fold, three boxes per language — the Google title, the Google description and the line under the heading. An empty box shows the shop's standard text in grey; what Renat types saves itself, is in the shop at once, has a journal line with «Вернуть» (from any device), and «Перевести с русского» fills Estonian and English. The «Языки магазина» line at the foot of «Настройки» is gone — it had nothing to tap (Dim).
- Page texts can be translated both ways Dim asked for: in «Тексты страниц» the button «Перевести на ET и EN» (on every language tab once the Russian is Renat's own) puts his Russian into Estonian and English — a long translation is cut at a word, never with «…»; and his Claude is told to offer and make the same translation (`get_page_texts` → `save_page_text`) for page texts and every other trilingual text it writes.
