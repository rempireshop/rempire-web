# Legal pages — review note (05.09.2026)

Status of the policy pages in `public/shop/legal.{ru,et,en}.js`
(`{ slug: { title, html } }` for shipping · returns · terms · privacy · contact;
`{{legalName}}` / `{{regCode}}` / `{{address}}` / `{{email}}` / `{{phone}}` /
`{{vatNumber}}` are filled in at render time by `cResolve()` in
`public/shop2/app.js` from «Настройки → Контент»).

## What changed on branch `q-legal-terms`

- **`terms` in `legal.ru.js` and `legal.et.js` replaced.** Until now both still
  carried Shopify's boilerplate terms of service — 15 mentions of Shopify per
  file, «[ПРИМЕЧАНИЕ ДЛЯ ПРОДАВЦА]» / «[MÄRKUS KAUPMEHELE]» notes and «[LINK]»
  placeholders. They are now translations of the EN «Terms of sale» draft in
  `legal.en.js`: the same 16 sections, the same h1/h2/p/a markup, the same six
  placeholders, the same links to the shipping / returns / privacy pages (the
  ET links carry the `/shop2/et/` prefix). Titles stay what the footer and the
  admin already call the page: «Условия продажи» / «Müügitingimused».
- Only the `terms` entry was spliced (a script parses the single-line JSON
  after `var LEGAL_XX = `, swaps that one key and writes the line back), so
  shipping, returns, privacy and contact are byte-identical to before and the
  CRLF line endings are kept. Whole-file check after the swap: 0 «Shopify»,
  0 «[» in either file.
- `docs/proofread-report.md` was left alone on purpose — `docs/audit/*.md` and
  `docs/i18n-report.md` cite it by line number.

## Status: machine-translated draft — lawyer pass pending (roadmap item p3d)

The RU and ET terms are an AI translation of the EN draft, and the EN draft is
itself marked «DRAFT, LAWYER REVIEW BEFORE LAUNCH» at the top of `legal.en.js`.
Nobody with an Estonian law licence has read any of the three. The page keeps
showing the «Текст перенесён с текущего сайта; перед запуском пройдёт проверку
юристом» note under the body (`screenInfo()` in app.js) — leave it there until
the lawyer pass is done.

## Terminology used (so the lawyer can flip a term once, consistently)

| EN | RU | ET | note |
|---|---|---|---|
| the store / web store | Интернет-магазин | e-pood | as in the shipping pages |
| contract of sale | договор купли-продажи | müügileping | the ET shipping page says «ostu-müügileping»; «müügileping» is the VÕS term — pick one |
| registry code | регистрационный номер | registrikood | RU follows the shipping page; Estonian-Russian texts often say «регистрационный код» |
| Law of Obligations Act | Обязательственно-правовой закон Эстонии | võlaõigusseadus | |
| 14-day right of withdrawal | 14-дневное право отказа от договора | 14-päevane taganemisõigus | |
| non-conformity / complaint | несоответствие товара условиям договора / претензия | lepingutingimustele mittevastavus / pretensioon | |
| bank link | банковская ссылка | pangalink | |
| discount code | промокод | sooduskood | as in the checkout UI |
| VAT number | номер плательщика НДС | KMKR number | |
| Consumer Disputes Committee of the TTJA | Комиссия по потребительским спорам при Департаменте защиты прав потребителей и технического надзора | Tarbijakaitse ja Tehnilise Järelevalve Ameti juures tegutsev tarbijavaidluste komisjon | |
| you | вы (lower case, as in the RU returns/privacy pages) | sina (as in the ET returns/privacy pages) | the ET shipping page is in the third person («Ostja»); the lawyer may prefer «Teie» in the terms |

## Sentences to look at (unsure wording, or a legal point rather than a language one)

1. **Liability cap** — «Beyond those rights, our liability is limited to the
   value of the order concerned.» RU «За пределами этих прав наша
   ответственность ограничена стоимостью соответствующего заказа», ET «Neist
   õigustest kaugemale ulatuvas osas on meie vastutus piiratud asjaomase
   tellimuse väärtusega». Faithful, but whether such a cap stands against a
   consumer (VÕS § 106) is the lawyer's call, in all three languages.
2. **Two-year clause** — one clause was added that the EN does not have, in
   both languages, to name the statutory right by its consumer-law term: RU
   «— в течение этого срока вы вправе предъявить претензию», ET «— selle aja
   jooksul on sul õigus esitada pretensioon». Delete it if a word-for-word EN
   mirror is wanted.
3. **«Who we are»** — «grooming store» → RU «магазин средств для ухода», ET
   «hooldustoodete pood»; «our own merchandise» → RU «собственный мерч»
   (colloquial; «фирменная продукция» for a stiffer register), ET «oma
   kaubamärgiga tooteid».
4. **«full active legal capacity»** → RU «обладающие полной дееспособностью»,
   ET «täieliku teovõimega» — standard terms, but the sentence mixes the age
   condition for natural persons with the representative condition for legal
   persons; the lawyer may want it split.
5. **Order cancellation grounds** — «where we cannot verify the details given»
   → RU «если мы не можем проверить указанные данные», ET «kui me ei saa
   esitatud andmeid kontrollida». Vague in all three languages.
6. **Discount-code sentence** — «A code is treated as used only once the order
   it was used on has been paid» → RU «Промокод считается использованным только
   после оплаты заказа, в котором он был применён», ET «Sooduskood loetakse
   kasutatuks alles siis, kui tellimus, mille juures seda kasutati, on
   tasutud». Long in Estonian; a native pass may shorten it.
7. **Placeholder inside a sentence** — «принадлежат компании {{legalName}}» /
   «kuuluvad ettevõttele {{legalName}}» are phrased so the company name stays
   in the nominative whatever «Настройки → Контент» holds. If the trading name
   is ever set to a bare brand («Rempire»), «компании» / «ettevõttele» reads
   oddly.
8. **«e-mail»** — RU says «по электронной почте» / «адрес электронной почты»
   as the shipping page does; the privacy page mixes in «e-mail». Cosmetic.

## Verification (05.09.2026)

- `node --check` passes on both files; loaded in a `vm` context, `terms.html`
  has 0 «Shopify», 0 «[», all six placeholders, and 1 h1 / 16 h2 / 18 p / 6 a
  in RU and ET, mirroring the EN.
- Render check: `node tools/e2e-build.mjs`, then `E2E_PORT=3517 npx playwright
  test e2e/info-pages.spec.ts --project=desktop` — 18 passed (the five info
  pages in RU, ET and EN, plus the three blog routes). /shop2/info/terms/,
  /shop2/et/info/terms/ and /shop2/en/info/terms/ were also opened in Chromium
  at 390 px: 200, `<html lang>` right, h1 + 16 h2 + 18 p + 6 links each, every
  placeholder resolved from the content settings, no horizontal overflow (the
  page has no lists). The generated files the prebuild touches
  (`public/shop2/index.html`, `src/data/content.default.json`,
  `src/db/migrations.generated.ts`) were restored before committing.
