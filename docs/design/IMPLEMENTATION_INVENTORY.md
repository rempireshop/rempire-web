# Implementation inventory — /brand/directions (Phase 1)

## Built (interactive demo, Directions.dc.html)
- Comparison shell: RU, direction switch А/Б, phone 390 / desktop 1280, screen tabs,
  plain-language note per direction (brief §7)
- Both directions × 7 storefront surfaces: главная, категория, товар, корзина (drawer),
  оформление (shared calm checkout), поиск (+ zero-result state), блог (index + article)
- Cross-sell: one-time toast on add-to-cart (Renat q9), dismissible, auto-hide 6s
- Cart: live count, qty, free-shipping progress to 50 €, empty state
- Checkout: guest-first, Omniva/SmartPosti/DPD/courier with parcel-machine select,
  bank links (Swedbank/SEB/LHV/Luminor/Coop), card, Apple/Google Pay, PayPal, invoice;
  inline error state demo

## Design-only / mock data
- All prices, counts («24 товара»), stock states — real catalog values from
  rempireshop.com (22.08.2026) but hardcoded
- Product photos hotlinked from Shopify CDN — migrate to own storage
- Blog covers + article hero: image slots awaiting real photography
- INCI accordion: placeholder («переносится из карточки поставщика»)
- Language switch (RU/ET/EN), account, promotions: not designed yet

## Not yet designed (next round)
- Admin: dashboard, product edit, order workspace, inventory, CMS editor,
  **assistant (the centrepiece — Renat q6)**
- Direction-B mobile menu interior; brand landing page; 404/empty categories

## Known issues / decisions to confirm
- Returns copy in checkout follows EU law (14 days, unsealed-hygiene exception),
  NOT Renat's blanket «косметика возврату не подлежит» — needs lawyer sign-off
  (see docs/RENAT-ANSWERS.md legal flags)
- Пикап из магазина не выбран в q17 при живом магазине — уточнить
- Fonts served from Google CDN in demo only; production must self-host (EU)
