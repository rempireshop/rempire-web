# Rempire admin assistant — spec

*Status: design doc, 02.09.2026. Build starts when the real backend exists (needs service logins — see «Сервисы и логины» in the roadmap).*

## What it is

An AI assistant built into the shop admin. Renat (non-technical, Russian-speaking) talks to it in plain Russian; it does the actual work. **It must be able to change everything the admin can change** — that is the contract. No "read-only helper": products, prices, stock, orders, categories, banners, texts, legal pages, shipping settings, discounts.

Chat-first UI inside `/admin`, with every change previewed as a diff card ("вот что я изменю — подтвердить?") before it lands. One-tap undo per change; full change log kept.

## Baked-in rules (not optional, not per-request)

These run automatically on every relevant operation. Renat never has to ask.

### 1. Watermark on every image
Every image uploaded to the shop — new product photo, banner, gallery shot — gets the Rempire watermark **exactly as on the current shop's images**. Same mark, same corner, same opacity/scale ratio. Implementation: server-side compositing step in the upload pipeline (ImageMagick, same stack as the cutouts), applied after background removal and before resizing. The watermark asset comes from the brand kit (Dropbox — see memory `rempire-brand-assets`). Before first implementation: pull 3–4 current shop images and measure placement/opacity so the new mark is indistinguishable from the old.

### 2. Background removal on product images
Every uploaded **product** photo goes through the adaptive cutout pipeline we already run for the catalogue (`tools/refit-cutouts.mjs` logic: per-image flood-tolerance sweep, stop at the cliff, never one fixed fuzz). Merch/model shots are exempt (frame kept) — the assistant decides by product category, same rule as the build scripts. Output: transparent-background webp, 900px, 24px padding — identical to the existing 220.

### 3. SEO on every text
Every text the assistant writes or edits — product description, category intro, banner, page — is SEO-optimized by construction:
- product type + brand present naturally in title and body (no stuffing);
- `SEO Title` ≤ 60 chars and `SEO Description` ≤ 155 chars generated for every product, every language;
- one `h1` per page, clean heading hierarchy, alt-texts on images;
- all three languages (RU/EN/ET) get their own SEO fields, not translations of each other's keywords.

### 4. Three languages always
A new product or edited text is not "done" until RU + EN + ET all exist. The assistant writes the source language and translates the other two in the same operation; Renat sees all three in the preview.

## What Renat can say to it (examples)

- «Добавь новый товар — вот фото и цена 24 €» → cutout + watermark + description in 3 languages + SEO fields + category guess, preview, confirm.
- «Подними цены Paul Mitchell на 5 %» → diff of every affected product, confirm once.
- «Что с заказом №1043?» → status, tracking, customer message draft.
- «Сделай баннер на скидку -20 % на бороду до пятницы» → banner + discount rule, both previewed.
- «Этого товара больше нет» → archive (not delete), redirect kept.

## Guardrails

- Destructive actions (delete product, cancel paid order, refund) always require an explicit confirm — no batch-confirm covers them.
- The assistant never touches: payment provider settings, domain/DNS, legal page *content* (it may translate, not rewrite policy meaning — lawyer owns that).
- Everything it changes is logged: who/when/what/undo.

## Architecture (thin now, real later)

- **Model**: OpenAI API, **Dim's own account initially** (per 02.09 agreement); later a shop account — with all other logins ending up with Renat. Key lives server-side only, never in the browser.
- **Backend**: the same API the admin uses — assistant gets no private side-doors, so its permissions are exactly the admin's permissions.
- **Image ops**: server-side ImageMagick workers (cutout → watermark → resize), queue with per-image status shown in chat.
- **Translations**: same model call, glossary pinned (brand names stay Latin, units per language) — the glossary starts from the rules used for the catalogue translation fleet of 02.09.2026.

## Dependencies before build

1. Real backend + DB (products, orders) — replaces the static `catalogue2.js` demo.
2. Service logins (roadmap «Сервисы и логины»): OpenAI key, hosting, Resend.
3. Watermark asset + placement measurements from the current shop.
