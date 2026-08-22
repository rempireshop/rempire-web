# REMPIRE — Design System (Phase 1: storefront directions)

Source of truth for both directions on `/brand/directions`. Both share identical IA,
components, content model; they differ in type scale, rule weight, and how boldly the
tower is used. Tokens extend `src/app/globals.css`.

## Colour roles

| Role | Value | Notes |
|---|---|---|
| ink | `#1c1a00` | text, rules, fills — from the badge |
| paper | `#fdfcf9` | page ground |
| mist | `#edeae1` | shell chrome only, never storefront |
| fog | `#78745f` | secondary text ≥12px only (AA on paper) |
| error | `#8c1a0f` | functional only: validation, out-of-stock. Never decorative |
| product ground | `#ffffff` | packshot tiles; supplier images `mix-blend-mode: multiply` onto it |

Monochrome discipline: photography is the only colour. Direction B adds inverted ink
bands (max 1 per screen).

## Typography

**Pairing (Cyrillic-capable, replaces Latin-only Korolev in UI):**

| Family | Role | License | Loading |
|---|---|---|---|
| **Oswald** 400–600 | display: headings, labels, numerals | SIL OFL 1.1 — free, web ok | self-host woff2 in `public/fonts` |
| **Golos Text** 400–600 | body, UI, forms | SIL OFL 1.1 — Cyrillic-first design | self-host woff2 |
| Korolev Bold | badge/lockup artwork ONLY (outlined in SVG) | desktop OTF, web license unconfirmed | never as webfont until licensed |

Oswald's condensed industrial voice sits closest to Korolev's letterforms in the badge;
Golos Text was drawn for Russian UI and keeps Latin/Cyrillic as one voice. **No Google
Fonts CDN in production** (EU visitor-IP disclosure): the demo page uses the CDN for
preview only; production vendors woff2 files. Estonian (õäöü) covered by both.

Scale: body 13–14px/1.5; A display clamp(19–28px) weight 500; B display Oswald 600
uppercase clamp(26–64px). Never size controls around English — test RU/ET strings.

## Spacing, grid, rules

- Screen gutter: `4.5cqi` (container-query units; frame is the container).
- Product grids: `repeat(auto-fill, minmax(150px, 1fr))` — 2 cols at 390px, 5+ at 1280px.
- A: hairline rules `1px rgba(28,26,0,.15)`, section dividers `1px #1c1a00`. No cards, no shadows, radius 0.
- B: structural rules `2px #1c1a00`; bordered cell grids (`1px rgba(28,26,0,.2)`); tower watermark ≤6% opacity, one per page, cropped at an edge, never behind body text.

## Components (built in both directions)

Announce bar · header + search · category nav · product card (packshot on white,
brand caps 10px, name, price, quiet «В корзину») · category toolbar (filters, count,
sort) · filter drawer (left) · PDP (gallery, variants, qty, sticky mobile buy bar,
accordions: описание/преимущества/применение/состав/доставка) · cross-sell toast
(one suggestion on add-to-cart, dismissible, auto-hides 6s, never blocks) · cart drawer
(right; free-shipping progress to 50 €) · checkout (guest-first, one page: контакт →
доставка с пакоматами → оплата с банковскими ссылками; inline error states) · search
(suggestions, zero-result with category routes + «запрос сохранён») · blog index +
article (real long-form, indexable) · service row · newsletter · footer.

## Accessibility & SEO commitments

Focus-visible 1px ink outline offset 3px; no hover-only actions; 44px+ tap targets on
mobile; real H1 per screen; category intro copy indexable; breadcrumbs everywhere;
alt text on all product imagery; `prefers-reduced-motion` respected (see MOTION.md).

## Photography policy

Cut out on white (chosen): supplier packshots composited onto `#fff` tiles via
multiply blend — uneven supplier backgrounds read as deliberate. Reshoot list for
"expensive": merch (on-model), brand covers, blog heroes. Ratios: product 1:1,
brand tile 3:2, blog hero 16:9.

## Motion

See `MOTION.md` — tower motion system (Tower Build reveal + light pass, idle blink,
rook-turn ident/loop). Storefront chrome: 160–250ms ease-firm transitions only.

## Recommendation (unhedged)

**Direction B — «Башня».** Renat asked for minimalism and a white ground — B keeps
both, on the same white, the same grid, the same number of blocks — but it gives the
shop a spine Shopify themes cannot fake: real display typography, the tower used
architecturally, an editorial voice that feeds his stated success metric (organic
growth and SEO need indexable texture, and B's editorial blocks produce it naturally).
A executed perfectly is still mistakable for a very good default theme; B is
unmistakably REMPIRE at the first screenful, and it costs the same to build. Graft A's
quieter product cards into B if Renat finds the grid heavy.
