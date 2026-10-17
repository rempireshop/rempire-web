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
