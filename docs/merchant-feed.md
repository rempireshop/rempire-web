# Google Merchant Center product feed

`tools/build-merchant-feed.mjs` generates `public/feed/google-shopping.xml` — an RSS 2.0 Google
Shopping feed: one `<item>` per sellable product (in/low stock, price > 0) with EN title and
description, EUR price, image, link and Google product category.

Live URL once deployed: **https://rempireshop.diipsolutions.eu/feed/google-shopping.xml**

Submit in Google Merchant Center: **Products → Feeds → Add feed** → choose **Scheduled fetch**,
paste the URL above, set a daily fetch time — Google re-downloads it on schedule.
Notes:
- At launch the shop moves to **rempireshop.com**: update `BASE` in the script, regenerate,
  and repoint the Merchant Center feed URL.
- The feed is a static snapshot — re-run `node tools/build-merchant-feed.mjs` after every
  catalogue rebuild (catalogue2.js / content.js changes), or stock and prices go stale.
