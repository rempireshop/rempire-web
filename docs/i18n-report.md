# i18n coverage report — Estonian + English (03.09.2026)

Follow-up to `docs/proofread-report.md`, closing item 7 of
`docs/audit/features-admin-assistant.md` ("~340 Russian interface strings have
no ET/EN translation") and the §4 *Trilingual gaps* section of the same audit.

Russian remains the source language. **No Russian key was renamed, reworded or
removed**, and no `$1` capture placeholder was changed. Only dictionary
*values*, new RU→{ET,EN} *entries*, new `UI_RX` rules, the chat widget's own
`T` table and the new English legal file were touched.

Same standard as the previous pass: Estonian in the voice of tradehouse.ee /
kaubamaja.ee, informal **sina** throughout, „…“ quotation marks, `12,90 €`,
`50 ml`; English in a UK/EU e-shop voice, **Cart** (not Basket), **Delivery**
(not Shipping), `€12.90`.

---

## 1. The measuring tool

`tools/i18n-gaps.mjs` — run it with **`npm run i18n:gaps`**.

It reproduces statically what `translateTree()` does at runtime:

1. tokenises `public/shop2/app.js` and `public/shop2/chat.js` into string
   literals, comments and regex literals;
2. re-joins literals glued with `+` into one chunk, putting a placeholder
   where an expression is interpolated — that is the string the browser
   actually ends up with;
3. cuts each chunk into text nodes on tag boundaries, and pulls out the four
   attributes the shop translates (`placeholder`, `aria-label`, `title`,
   `label`);
4. tests each fragment against the `UI[lang]` keys and the `UI_RX` rules — a
   fragment with a hole is probed with sample values, so `"от " + n + " €"` is
   recognised as covered by `/^от (\d.*)$/`;
5. groups what is left by the function it lives in (Checkout, PDP, Search,
   Account, Admin panel, …).

It also reports two things the audit asked about and nobody was watching:

* **ET/EN key parity** — the two blocks must hold the same key set;
* **duplicate keys** — a key written twice in one block, where JavaScript
  silently keeps the last value. See §6.

Flags: `--all` prints the covered fragments too, `--json` for machine use.

## 2. Counts, before and after

| | before | after | after the 03.09 cleanup |
|---|---|---|---|
| `UI.ET` keys | 442 | 808 | **810** |
| `UI.EN` keys | 442 | 808 | **810** |
| ET/EN parity gap | 0 | 0 | **0** |
| duplicate keys per block | 35 | 35 | **0** |
| `UI_RX` rules | 39 | 70 | **72** |
| visible Russian fragments outside the dictionary | 756 | 918 | 922 |
| **untranslated** (no key, no rule) | **306** | **0** | **0** |
| deliberately Russian (listed below) | 23 | 92 | 92 |

The last column is the cleanup pass of the same day: the 35 duplicates merged
(§6), three meta-description strings added for `setHead()`, one dead key
removed (the checkout's «Вопросы — …», now a pair of `UI_RX` rules around the
phone and e-mail the content layer holds).

The "before" column is this tool's own first run, before any edit in this pass.
The audit counted ~340 by a rougher method; the difference is
attribute-boundary artefacts that this extractor no longer produces.

The fragment total *rose* from 756 to 918 because four other agents added
features while this pass ran — promo codes, delivery-rate editing, the
passwordless account and the content editor. Their new strings are included in
the zero above: everything that renders today has ET and EN.

**This pass added 346 RU→{ET,EN} entries per language and 23 `UI_RX` rules.**
The rest of the growth is the other agents translating their own new copy.

### What was covered, by surface

| Surface | What was Russian on `/et/` and `/en/` |
|---|---|
| **Checkout field errors** | every one of them: name, street, postcode, town, phone, the "check the number" hint, the two e-mail messages, the three step failures, the company-invoice field, the FI and EU tariff notes |
| **Product page** | out-of-stock copy and its e-mail field, the fallback description / how-to-use / INCI / sizes-and-care blocks, the eight colour names in the variant picker, `Объём — 150 мл`, the review rating and video labels |
| **Search** | the empty state, "Popular searches" and its four chips, the "check the spelling" and "write to us" lines |
| **Account** | the whole screen — sign-in copy, default delivery, saved parcel locker, order and promo rows |
| **Shell** | eight `aria-label`s (logo, search, language, bottom nav, three social links), the splash "skip" button |
| **Admin panel** | ~200 strings: every tab intro, every KPI, the order table and order detail (`Собран` / `Передан в доставку` / `Доставлен`, the three action buttons), the goods editor (`Основное`, `Цена, €`, `Раздел`, `Подкатегория`, `Фото по объёмам`, `SEO для Google`, `Заголовок (до 60 знаков)`, `Описание (до 155 знаков)`), the whole Настройки tab, the connections list, the media errors, the assistant's nine canned answers and its suggestion chips |
| **Chat widget** | see §5 |

## 3. What is still Russian, on purpose

`npm run i18n:gaps` prints this list on every run, with the reason. It is the
only Russian the two translated storefronts can show.

| Group | Strings | Why |
|---|---|---|
| Language menu | `Русский` | each language names itself — `Eesti` and `English` are not translated either |
| **Renat's private change log** | `Цена «X Y»: A → B`, `Наличие «X»: …`, `Письмо «X»: …`, `Баннер: N слайдов, первый — «…»`, `Подкатегория «X»: …`, `Фото по объёмам «X»: …`, `Видео «X»: …`, `Фото «X»: N фотографий`, `Промокод X: …`, `Контент: …`, `Тарифы доставки: …`, `Доставка: без изменений`, and their word fragments (`включить`, `выключить`, `показать`, `скрыть`, `авто`, `убрано`, `как в каталоге`, `слайд/слайда/слайдов`, `фотография/фотографии/фотографий`, `везде`, `— никогда`) | `actionText()`, `shipActionText()`, `contentActionText()` — the "Журнал изменений" block in Настройки. Renat's own audit trail; translating it would need ~25 multi-capture regex rules for text only he reads. **Decision to confirm** (§7.10) |
| Internal matching keys | `кондиционер`, `маска`, `паста`, `спрей`, `воск`, `гель`, `пудра`, `масло`, `бальзам` in `TYPE_MATES` / `NAME_TAILS` / chat's `match()` | data keys used to pair products; never rendered. (`шампунь`, `борода`, `парфюм`, `футболка` **are** rendered, as search chips, and are translated) |
| Plural word forms | `товар/товара/товаров`, `точка/точки/точек`, `раздел/раздела/разделов` | `pl()` glues them to a number; the composed string (`12 товаров`) is translated by rule |
| Price prefix | `от` | glued to the amount; `от 12,90 €` is covered by `/^от (\d.*)$/` |
| Demo customer names | `М. Тамм`, `А. Иванов`, `Д. Петров` | names are not translated |
| Model prompt | `Напиши SEO title и description для товара …` | sent to the model, never shown to anyone |
| Assembled halves | 17 fragments the extractor cuts at a string-literal boundary | the *rendered* node is covered by a key or rule; the tool names which one on each line |

## 4. English legal pages

`public/shop/legal.en.js` — new, `var LEGAL_EN`, same shape as `legal.et.js`:
`{ slug: { title, html } }` for `shipping · returns · terms · privacy ·
contact`. Header says **draft — lawyer review before launch**.

Written from the Russian `legal.js` and the Estonian `legal.et.js`, not
machine-translated. The Estonian consumer-law anchors are kept deliberately —
the seller trades from Estonia, so VÕS applies whichever country the buyer
orders from:

* **14-day right of withdrawal** — VÕS §§ 56 and 56¹, in *Returns* and cited
  again in *Terms of sale* and the delivery rules;
* **two-year liability for non-conformity** — VÕS §§ 217–218, with the
  first-year presumption, plus the two-month notification window;
* **dispute routes** — the Consumer Disputes Committee of the Consumer
  Protection and Technical Regulatory Authority, and the EU ODR platform.

Sizes: shipping 9 790 · terms 5 124 · privacy 5 615 · returns 3 406 · contact
184 characters. The Russian originals are longer (26 k for shipping) because
they carry a Lithuanian-era boilerplate that repeats itself; the English draft
covers the same ground without the repetition. That is a judgement a lawyer
should sign off on before launch.

Wiring, exactly as `LEGAL_ET` is wired:

* `public/shop2/index.html` — `<script src="/shop/legal.en.js?v=i18n28">`
  immediately after `legal.et.js` (the whole file's `?v=` token was bumped
  `i18n27` → `i18n28` because `app.js` and `chat.js` changed);
* `public/shop2/app.js` — one line in `legalFor()`, matching the ET line;
* `tools/prerender-shop2.mjs` already loaded `legal.en.js` and already had an
  `EN` branch waiting for it (the SEO agent got there first), so
  `npm run prerender` now writes proper English policy pages. Before this pass
  `/shop2/en/info/shipping/` carried the title **Доставка и оплата** over a
  mangled English body; it now reads **Delivery and payment**.

### The `<meta>` word-split — resolved

`public/shop/content.js` was regenerated: **0 `<meta>` tags** remain in
`content.js`, `content.et.js` and `content.ru.js` (115 of 220 EN entries
carried them before). Nothing left to fix there.

**But the same symptom survives through a different route, and it is a real
bug outside this region.** Six EN entries (five ET, four RU) legitimately split
a word across an inline tag — `a<span>dds texture`, `s<span>trong hold`,
`f</span>ragrance`. A browser renders those correctly ("adds", "strong"). But
`stripTags()` in `public/shop2/app.js` replaces every tag with a **space**:

```js
function stripTags(h) { return String(h || "").replace(/<[^>]+>/g, " ")… }
```

so the SEO `<meta name="description">` and the Product JSON-LD for those
products read *"s trong durable hold"*, *"f ragrance"*, *"E carrier oil"*.
Affected: `davines-pasta-love-strong-hold-mat-clay`,
`proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml`,
`captain-fawcett-barberism-beard-oil`, `captain-fawcett-ricki-hall-booze-baccy-beard-balm`,
`gatsby-moving-rubber-grunge-mat-grey-hair-wax`,
`versace-man-fraiche-eau-de-toilette-for-men-100ml`.
Fix for whoever owns `setHead()`: strip inline tags (`span`, `b`, `strong`,
`i`, `em`, `u`, `a`) with `""` and only block-level tags with `" "`.

## 5. The chat widget

`translateTree()` walks `hdrSlot`, `bodySlot`, `navSlot` and `ovl` only, and
`chat.js` appends its root straight to `document.body` — so the `UI` dictionary
has never reached it. It carries its own `T = {RU, ET, EN}` table, which
covered the title, hint, greeting, chips, buttons and placeholder but not the
markup labels.

Four values were added to each of the three `T` blocks — `aria`, `close`,
`send`, `from` — and a six-line `paintLabels()` sets them on the FAB, the
panel, the close button and the send button, once at load and again on every
open (the same place the title, hint and placeholder are already refreshed).
The `от ` price prefix in `productRow()` now comes from `T` as well, so an
English shopper sees "from €12.90", an Estonian "alates 12,90 €".

**Added 03.09:** the open-time refresh is now a function of its own,
`paintPanel()`, and a `MutationObserver` on `<html lang>` — which `setHead()`
writes on every render — calls it when the shopper changes language. The
switcher sits in the header, which stays clickable while the chat is open, so
without this an open panel kept the language it was opened in: title, hint,
chips, greeting and all four labels. A closed bubble repaints only its labels.
Verified in the running shop: RU → ET with the panel closed, ET open, ET → EN
with the panel open (the log resets and the greeting comes back in English).

This is the one place a code line was touched rather than a dictionary value.
Without it the entries could not take effect, because the labels live in an
`innerHTML` string that nothing re-reads.

## 6. Duplicate keys — resolved 03.09

**All 35 are gone: `npm run i18n:gaps` reports 0 duplicates in each block,
810 keys, parity ok.** One entry per key now, and the pairs that disagreed were
decided rather than left to source order. What follows is the record of what
was chosen and why.

`UI` held **35 keys written twice** in each language block; JavaScript kept the
last one silently. Ten of them disagreed in value, so the file said one thing
and the shop did another:

| Key | dead value | value that actually ships |
|---|---|---|
| ET `Отследить` | Jälgi | **Jälgi pakki** |
| ET `возврат` | tagasimakse | **tagastatud** |
| ET `Слишком много попыток — подождите минуту.` | Liiga palju katseid — oodake minut. | **… oota minut.** (correct: *sina*) |
| ET `Статус` | Staatus | **Olek** |
| ET `активен` | kehtiv | **aktiivne** |
| ET `выключен` | väljas | **välja lülitatud** |
| EN `Корзина пуста` | The cart is empty | **Your cart is empty** |
| EN `не оплачен` | unpaid | **not paid** |
| EN `Не получилось — попробуйте ещё раз` | That did not work — try again | **That didn't work — please try again** |
| EN `Слишком много попыток — подождите минуту.` | Too many attempts — wait a minute. | **Too many tries — wait a minute.** |

Every one was a key an agent re-added without checking. The rule applied when
they were merged: **keep the value that was already shipping** — the later
definition — and delete the dead earlier one, except for the three where the
shipping value was the weaker wording, which this report had already picked
out. So:

* **Kept as shipped** (seven of the ten): ET `Отследить` → *Jälgi pakki*,
  ET `возврат` → *tagastatud* (a participle beside *tühistatud* / *makstud*),
  ET `Слишком много попыток…` → *…oota minut.* (informal **sina**), ET `Статус`
  → *Olek*, EN `Корзина пуста` → *Your cart is empty* (as
  `docs/proofread-report.md` has it), EN `Не получилось…` → *That didn't work —
  please try again*, EN `Слишком много попыток…` → *Too many tries — wait a
  minute.*
* **Overridden** (the three this report flagged): ET `активен` → *kehtiv* (a
  promo code is *valid*, not *active*), ET `выключен` → *väljas* (a status chip,
  not an action — and it sits beside `включён` → *sees*), EN `не оплачен` →
  *unpaid* (crisper than *not paid* in a status column).
* The other 25 held the same value twice; the earlier entry was deleted and the
  later one left in place. The two blocks were cut symmetrically, so ET and EN
  still read as mirror images — the three overrides deleted the *later* entry in
  both languages, not only in the one whose value changed.

The older duplicate set — `Новинки`, `Город`, `Применить`, `Сохранить`,
`Доставка`, `Корзина пуста`, `Сохранено ✓` — went with them.

## 7. Ten wording decisions worth Renat's eye

1. **`Основное` → *Põhiandmed* / *Basics*.** The goods editor's first heading.
   Literally it is "the main thing"; in a form it means "the core fields". If
   he reads it as "Main", say so and it becomes *Peamine* / *Main*.
2. **`Фото по объёмам` → *Fotod mahtude kaupa* / *Photos per size*.** English
   deliberately says *size*, not *volume*: the same control also serves the
   T-shirt sizes, where "volume" would be nonsense. Estonian keeps *maht*
   because that block only ever shows millilitres.
3. **`SEO для Google` → *SEO Google’i jaoks* / *SEO for Google*.** "SEO" was
   kept untranslated in both. The Estonian alternative is *Otsingumootori
   optimeerimine* — accurate, three times longer, and nobody says it.
4. **`Заканчиваются` → *Lõppemas* / *Running low*.** The KPI tile. English
   avoids "Ending" and "Out of stock" — the tile counts items that are low
   *or* out, and "Running low" is what a shop owner says.
5. **`Средний чек` → *Keskmine ostukorv* / *Average order value*.** Estonian
   retail says *keskmine ostukorv* (average basket); the literal *keskmine
   tšekk* means an average receipt slip.
6. **`Самовывоз` → *Järeletulek* / *Pickup*.** Carried over from the previous
   pass unchanged, and still one of the open questions there — Estonian shops
   are split between *Järeletulek*, *Tulen ise järele* and *Kauplusest*.
7. **`Русский — эстонский и английский пишутся сами` → *Vene keeles — eesti ja
   inglise keel kirjutatakse ise* / *In Russian — Estonian and English write
   themselves*.** This is the note under the description field, and it is a
   promise about how the shop works. If the auto-translation is not going to
   be switched on at launch, the Russian source should change first.
8. **The demo Google queries were localised** — `давинес шампунь` →
   *davines šampoon* / *davines shampoo*, `барбершоп мыло 666` → *barbershop
   seep 666* / *barbershop soap 666*. They are invented sample data on the
   Аналитика tab. Translating them keeps the screen consistent; leaving them
   Russian would have been defensible too. Say which he prefers.
9. **English keeps `Rempire Store OÜ` and the reg. code as placeholders**
   (§8), so nothing in the English pages hard-codes a company. The moment the
   identity question in `docs/proofread-report.md` is answered, all three
   languages change together.
10. **The admin change log stays Russian.** `actionText()` and its two
    siblings write ~25 lines like `Цена «Davines Pasta&Love»: 24 € → 22 €`
    into Настройки → Журнал изменений. Translating them means a multi-capture
    regex rule each, for text only Renat reads. If he will only ever work in
    Russian this is right; if he plans to hand the panel to someone else in
    Estonian, say so and they get rules.

## 8. Placeholder convention

The legal texts no longer freeze a company identity. `legal.en.js` uses exactly
the same tokens `legal.et.js` and `legal.js` use, and the same seven the
resolver knows:

```
{{legalName}}  {{regCode}}  {{vatNumber}}  {{address}}  {{email}}  {{phone}}  {{iban}}
```

* At runtime `cResolve()` in `public/shop2/app.js` replaces them from
  `contentConf().company`, i.e. from **Настройки → Контент**, HTML-escaped. An
  unknown token is left alone rather than blanked.
* At build time `resolveIdentity()` in `tools/prerender-shop2.mjs` fills them
  from `src/data/content.default.json` — `DEFAULT_CONTENT` of
  `src/lib/content.ts`, packed by `tools/pack-content.mjs` in `prebuild` (it
  used to be a second copy typed into the tool, and it had drifted); app.js
  replaces them again a moment later on hydration.
* Rule for anyone editing a policy page: **never type a company name, registry
  code, VAT number, address, e-mail or phone into `legal*.js`** — use the
  token. `legal.en.js` currently uses six of the seven (`{{iban}}` is not
  needed in the English pages).

The same file also uses `{EE}`, `{LV}`, `{FI}` in the announcement bar — a
different mechanism (`cTokens()`, free-delivery thresholds), not to be confused
with the double-brace identity tokens.

## 9. Files touched

| File | What |
|---|---|
| `tools/i18n-gaps.mjs` | **new** — the coverage tool |
| `package.json` | one line: `"i18n:gaps": "node tools/i18n-gaps.mjs"` |
| `public/shop2/app.js` | 346 new RU→{ET,EN} entries per language, 23 new `UI_RX` rules, one line in `legalFor()` |
| `public/shop2/chat.js` | `aria` / `close` / `send` / `from` in `T.RU`, `T.ET`, `T.EN`; `paintLabels()`; `productRow()` price prefix |
| `public/shop/legal.en.js` | **new** — `LEGAL_EN`, five pages, draft |
| `public/shop2/index.html` | `legal.en.js` script tag; `?v=i18n27` → `?v=i18n28` (13 assets) |
| `docs/i18n-report.md` | this file |
| `public/shop2/{en,et,ru}/**` | regenerated by `npm run prerender` (810 pages) |

The cleanup pass on the same day (03.09) touched, in this file's area:

| File | What |
|---|---|
| `public/shop2/app.js` | 35 duplicate keys merged per block (§6); three meta-description keys for `setHead()`; the checkout's «Вопросы — …» key replaced by two `UI_RX` rules; `?v=i18n28` → `?v=i18n29` |
| `public/shop2/chat.js` | `paintPanel()` split out of `openPanel()`, `<html lang>` observer (§5) |

## 10. Verification

* `node --check` passes on `public/shop2/app.js`, `public/shop2/chat.js`,
  `public/shop/legal.en.js`, `tools/i18n-gaps.mjs`.
* `npm run i18n:gaps` → **0 untranslated**, ET/EN parity ok (808 keys each).
* Smoke test: the shop's own `trText()` was run standalone over 22 of the new
  strings — plain keys, rule-driven ones (`Объём — 150 мл`, `Заказ #1042`,
  `Показать 12 товаров`, `Пакомат по умолчанию — 469 точек`) and one where a
  `$1` capture is itself a dictionary term (`Открыть товары →` → *Ava tooted →*
  / *Open products →*). All 22 resolve in both languages.
* `npm run prerender` → 810 pages, English policy pages now carry English
  titles and bodies.
* `npm run typecheck` → clean.
* `npm test` → 27 files, 435 tests, all passing.
* No git commit, no push.
