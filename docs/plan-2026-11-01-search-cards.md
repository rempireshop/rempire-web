# Search that understands — plan (01.11.2026)

**Why.** Renat: «shampoo» did not show one Kevin.Murphy wash. The quick fix
(`SRCH_TYPE` in `public/shop2/app.js`, live 01.11) is a hand-kept word table.
Dim: no special words; «after shampoo» must get the right answer; not slower;
more money is fine; Vercel function time must not go up.

**Shape.** The model works when a product is *built or saved*, never when a
shopper types. The phone searches local data, as fast as today.

| Step | What | Where it runs | State |
|---|---|---|---|
| 1 | **Cards**: per product `type` + `about` terms in RU/ET/EN, written by the model; plus a 256-number meaning vector (`text-embedding-3-small`, int8). Known phrases (bench + `tools/search-intents.json`) get vectors too. | build (`tools/pack-search-cards.mjs`, prebuild) — production builds only; reuses the live file's cards by input hash; fails open | built 01.11 |
| 2 | **Shop reads the cards**: `type` terms count like the name (replaces `SRCH_TYPE` per product), `about` terms like the description; meaning neighbours from the vectors join below the word matches, above a similarity floor, capped. Loaded on the first search, like the descriptions. | browser | next |
| 3 | **A vector for any phrase**: `GET /api/search/vec?q=` → OpenAI embeddings, CDN-cached per phrase; precomputed phrases need no call. | function: a few ms of work, the rest is waiting (not billed as active CPU) | after 2 |
| 4 | **Live edits**: a product saved in the panel / Помощник / Claude gets a fresh card at once (table `search_cards`, delta endpoint, tag-purged) instead of at the next deploy. | function on save | after handover |

**Measured by** `tools/search-bench.mjs` (629 real phrases — never fewer than
before), the 791-check type audit (every type word on every EN/ET/RU card,
alone and with the brand), and `tools/search-intents.json` (meaning: «after
shampoo» → conditioners and masks first). CI fails if any gets worse.

**Fails safe.** No key / OpenAI down → the build keeps the live cards; the
shop keeps today's search. A product without a card is still found by name.

**Cost.** Cards ~220 calls once (~€1–3), then only changed products.
Vectors $0.02 per 1M tokens — a year of searches under €1.
