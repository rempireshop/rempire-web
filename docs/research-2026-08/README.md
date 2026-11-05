# Research notes, August 2026

Copied on 05.11.2026 from the repository `rempireshop/rempire-api` before it
was deleted (Dim's decision). That repository held the plan for a separate
ASP.NET Core backend, which was never built: the shop runs entirely in this
repository. Only the notes were worth keeping. They are a record of what was
known in August 2026: prices, plans and tariffs here are not current.

| Note | What it is | Superseded by |
|---|---|---|
| `PAYMENT-PROVIDERS.md` | Montonio, LHV, Stripe, Revolut, SumUp, Nexi; the restricted-business check | `docs/payments.md` (Montonio, live) |
| `COST-COMPARISON.md` | Shopify against the custom stack, 22.08.2026 | `docs/accounts.md` (real costs) |
| `BARCODE-SCANNING.md` | Hardware scanner first, phone camera second | `docs/inventory.md`, the panel's scanner |
| `SHIPPING-RATES.md` | Carrier tariffs read on 27.08.2026 | `docs/shipping.md` (Montonio contract prices) |
| `SHOPIFY-CATALOGUE-AUDIT.md` | The Shopify catalogue as it stood on 22.08.2026 | `src/data/catalogue*.json` |
| `PORTABILITY-AND-HANDOVER.md` | Which accounts must be the shop's from day one | `docs/accounts.md`, `docs/RUNBOOK.md` |

The two Shopify one-off scripts that lived next to them (`audit-shopify.mjs`,
`url-inventory.mjs`) were not copied: the catalogue and the old URL map they
produced are already in this repository.
