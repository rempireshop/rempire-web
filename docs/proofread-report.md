# Proofread report — Estonian + English (03.09.2026)

Native-standard pass over every ET/EN customer-facing string in the shop.
Russian is the source language and was **not touched**: no RU dictionary key was
renamed, removed or reworded, and no `$1`-style capture placeholder was changed.

Benchmark for Estonian: tradehouse.ee / kaubamaja.ee / photopoint.ee wording,
informal **sina** throughout, Estonian quotation marks „…“, `12,90 €`, `50 ml`.
Benchmark for English: UK/EU e-shop voice, **Cart** (not Basket) used
consistently, **Delivery** (not Shipping), `€12.90`.

## Totals

| | strings fixed |
|---|---|
| Estonian | **107** |
| English | **72** |
| Russian | 1 (markup only — a word that rendered split; no wording changed) |

## Files touched

| File | What |
|---|---|
| `public/shop2/app.js` | `UI` dictionary ET/EN values, `UI_RX` ET/EN templates, `TAIL_EXACT`, 8 new RU→{ET,EN} entries for strings the dictionary was missing |
| `public/shop2/chat.js` | assistant `T.ET` / `T.EN` values |
| `public/shop2/index.html` | cache-bust tokens bumped `i18n15` → `i18n16`, `reviews-pool.js?v=2` → `?v=3` |
| `public/shop/reviews-pool.js` | ET/EN reviewer names + copy (RU block untouched) |
| `tools/assemble-translations.mjs` | `sanitize()` now strips stray `<meta>` tags |
| `public/shop/content.et.js`, `content.ru.js`, `legal.et.js` | **regenerated** by `node tools/assemble-translations.mjs` — never hand-edited |
| `<scratchpad>/tr/out-03.et.json`, `out-11.et.json`, `out-17.et.json`, `legal.et.json` | translation sources the tool reads |

Verification: `node --check` passes on `app.js`, `chat.js`, `reviews-pool.js`,
`content.et.js`, `content.ru.js`, `legal.et.js`, `legal.ru.js`.
`UI` parses with **298 ET / 298 EN keys, zero parity gap**; `UI_RX` parses with
26 rules and **zero placeholder mismatches**. `npm run typecheck` fails only in
`tests/payments-montonio.test.ts`, `tests/payments-apply.test.ts`,
`tests/parcel-points.test.ts` — another agent's in-flight files, none of which I
touched.

## Top 10 most impactful fixes

1. **Stray `<meta charset="utf-8">` tags split words on product pages.** 115 of
   220 descriptions carried them; on the Davines clay they rendered as
   `a nnab tekstuuri` / `t ugev ja vastupidav hoid` (ET) and
   `п ридаёт текстуру` / `с ильная стойкая фиксация` (RU). Fixed in the
   assembler's `sanitize()` — the tag **and the whitespace after it** are eaten,
   so the halves rejoin while a tag between two real words still leaves a space.
   ET and RU are now clean (0 splits). **EN is still broken — see open item 1.**
2. **EN mixed "Shipping" and "Delivery" for the same thing.** Standardised on
   *Delivery* across 13 strings and regex templates
   (`Shipping & returns` → `Delivery & returns`, `Free shipping from $1` →
   `Free delivery from $1`, `Next — shipping` → `Next — delivery`, …).
   *Cart* was already consistent and was kept.
3. **ET stock badges were not shop language.** `нет в наличии` was
   *pole saadaval* → **otsas**; `мало` was *vähe* → **viimased**
   (`В наличии` → *Laos* was already right).
4. **Cyrillic reviewer names in the ET and EN review pools** — 56 names
   transliterated (ET Estonian-style: Sergei, Aleksei, Dmitri, Artjom, Deniss,
   Ženja; EN English-style: Sergey, Alexey, Dmitry, Artyom, Denis, Zhenya).
   The RU pool keeps its Cyrillic names.
5. **ET formality was mixed.** Every polite-plural (*teie*) form switched to
   informal *sina*: `vormistage` → `vormista`, `kontrollige` → `kontrolli`,
   `Mida otsite?` → `Mida otsid?`, `nõustute` → `nõustud`, `Lisage` → `Lisa
   juurde`, `Öelge, mida otsite` → `Ütle, mida otsid`, plus 4 admin strings
   (`Valige` → `Vali`, `Logige` → `Logi`, `proovige` → `proovi`,
   `Sisestage` → `Sisesta`). Zero *teie* forms remain.
6. **`стайлинг` was translated as *stiliseerimine*** — that is Estonian for
   *stylisation* (an art term), not hair styling. Replaced with **viimistlus**
   in 3 homepage strings, matching the `Стайлинг` → `Viimistlus` category label.
7. **Sort labels used *enne* (= "before") instead of *ees* (= "first").**
   `Populaarsemad enne` → **Populaarsemad ees**, `Soodsamad enne` →
   **Soodsamad ees**, `Kallimad enne` → **Kallimad ees**. Classic MT tell.
8. **EN currency was written the Estonian way** in the hand-written strings:
   `1.50 € per day` → **€1.50 per day** (×2), `25, 50 or 100 €` →
   **€25, €50 or €100**, chat `gift under 50 €` → **gift under €50**.
9. **Carrier labels had the wrong Estonian word order.** `Kuller DPD` →
   **DPD kuller**, `Kuller SmartPosti` → **SmartPosti kuller**,
   `Kuller Omniva` → **Omniva kuller**, `Kuller ukseni` → **Kuller uksele**,
   and the regex `Pakiautomaat $1` → **`$1 pakiautomaat`** (so "DPD
   pakiautomaat", not "Pakiautomaat DPD"). EN `SmartPosti courier` →
   **SmartPost courier** (Estonian genitive had leaked into English).
10. **8 customer-facing strings had no dictionary entry at all** and rendered in
    Russian on ET/EN: the out-of-stock and empty-cart toasts, the back-in-stock
    and login-code toasts, the "link copied" toast, the reorder toast, the saved
    toast and the `В наличии ✕` filter chip. Added with ET and EN values.

## Every change

### `public/shop2/app.js` — `UI` dictionary, Estonian (50)

| before | after |
|---|---|
| Habemeajamisjärgne | Pärast raseerimist |
| vähe | viimased |
| pole saadaval | otsas |
| Vormista ost | Vormista tellimus |
| Populaarsemad enne | Populaarsemad ees |
| Uuemad (duplicate `Новинки` key) | Uued — see note below |
| Kohaletoimetamine ja maksmine | Tarne ja maksmine |
| Ostu vormistamine | Tellimuse vormistamine |
| Kliendi info | Kontaktandmed |
| Mida otsite? | Mida otsid? |
| Lisatud korvi | Lisatud ostukorvi |
| Kontot pole vaja — vormistage külalisena. | Kontot pole vaja — vormista tellimus külalisena. |
| Hinnad sisaldavad makse. Tarne arvutatakse vormistamisel. | Hinnad sisaldavad käibemaksu. Tarnehind arvutatakse tellimuse vormistamisel. |
| … enne käivitamist vaatab selle üle jurist. | … enne poe avamist vaatab selle üle jurist. |
| Värske saadetis | Värske kaup |
| Hooldus ja stiliseerimine, mis just saabusid. | Hooldus ja viimistlus, mis just kohale jõudsid. |
| Kõik vormi jaoks | Kõik habeme kuju jaoks |
| Värsked saabumised: hooldus ja stiliseerimine, … | Värske kaup: hooldus ja viimistlus, … |
| Rempire'i särgid — meie kunstnike pildid, trükime väikeste tiraažidena. | Rempire'i firmasärgid — meie kunstnike kavandid, trükime väikestes kogustes. |
| … sealhulgas oma keedetud seep. | … sealhulgas ise keedetud seep. |
| Kogu Rempire'i valik: hooldus, stiliseerimine, … | Kogu Rempire'i valik: hooldus, viimistlus, … |
| Nende filtritega ei sobinud midagi. | Nende filtritega ei leidnud ühtegi toodet. |
| Soodsamad enne / Kallimad enne | Soodsamad ees / Kallimad ees |
| Rekvisiidid | Ettevõtte andmed |
| … tellimus ootab 7 päeva, edasi 1,50 € päevas. Vaja on dokumenti. | … tellimus ootab 7 päeva, seejärel 1,50 € päevas. Vaja on isikut tõendavat dokumenti. |
| Tasuta järeletulek Mardi 1. | Tasuta järeletulek aadressil Mardi 1. |
| … makse oma pangas | … maksa oma pangas |
| Kuller ukseni (DPD) | Kuller uksele (DPD) |
| Kuller DPD / Kuller SmartPosti / Kuller Omniva | DPD kuller / SmartPosti kuller / Omniva kuller |
| tänav, maja | tänav, maja number |
| Eesnimi Perenimi | Eesnimi Perekonnanimi |
| Makse läbi panga — pood kaardiandmeid ei näe | Makse toimub panga kaudu — pood ei näe kaardiandmeid |
| 14 päeva tagastusõigust EL-i seaduse järgi | 14-päevane tagastusõigus EL-i seaduse järgi (×3) |
| Vajutades «Maksa» nõustute … | Vajutades „Maksa“ nõustud … |
| Avatud kosmeetika ei kuulu hügieeni tõttu tagastamisele. | Avatud kosmeetikat ei saa hügieenilistel põhjustel tagastada. |
| Särki võib proovida ja tagastada, kui ei sobinud. | … kui see ei sobi. |
| Töötavas poes tuleb siia … paki jälgimine. | Päris poes tuleb siia … paki jälgimisnumber. |
| Tariifid — … koos 24% käibemaksuga … 3–20% … täpsustame liitumisel. | Hinnad — … koos 24 % käibemaksuga … 3–20 % … täpsustame lepingu sõlmimisel. |
| Koodi ei leitud — kontrollige kirjapilti. | … kontrolli kirjapilti. |
| Reg 12216136 · KMKR EE102723858 | Reg-kood 12216136 · KMKR EE102723858 |
| Lisage — ja tarne on tasuta: | Lisa juurde — ja tarne on tasuta: |
| Demo-arvustused. Päris omad tulevad pärast käivitamist — kirjaga «hinnake tellimust». | Demo-arvustused. Päris arvustused tulevad pärast poe avamist — 10 päeva pärast saadetava kirjaga „Hinda tellimust“. (the "10 days" from the RU source had been dropped) |
| Ühendused | Liidestused |
| Valige kiri ja keel … | Vali kiri ja keel … |
| Logige administraatorina sisse | Logi administraatorina sisse |
| Liiga palju kirju — proovige hiljem | Liiga palju kirju — proovi hiljem |
| Sisestage e-posti aadress — … | Sisesta e-posti aadress — … |
| Siin on tühi. | Siin pole midagi. |

### `public/shop2/app.js` — `UI` dictionary, English (22)

| before | after |
|---|---|
| Shipping & returns | Delivery & returns |
| Shipping & payment | Delivery & payment |
| Shipping | Delivery |
| Next — shipping | Next — delivery |
| Taxes included. Shipping is calculated at checkout. | Taxes included. Delivery is calculated at checkout. |
| Free shipping applied ✓ | Free delivery applied ✓ |
| Add one — and shipping is free: | Add one more — and delivery is free: |
| We'll email you when it's back! | We'll e-mail you when it's back in stock! |
| Fresh delivery | Just arrived |
| Care and styling that just arrived. | Care and styling that has just landed. |
| Everything for shape | Everything to keep it in shape |
| Rempire tees — prints by our artists, small runs. | Rempire tees — prints by our own artists, made in small runs. |
| … then 1.50 € per day. ID required. | … then €1.50 per day. Photo ID required. (×2) |
| pay in your own bank | pay via your own bank |
| SmartPosti courier | SmartPost courier |
| street, house | street and house number |
| Name Surname | First name Last name |
| … final prices to be confirmed on connection. | … once the contracts are signed. |
| Reg 12216136 · KMKR EE102723858 | Reg. no 12216136 · VAT EE102723858 |
| Demo reviews. Real ones arrive after launch via a “rate your order” e-mail. | … after launch, via a “rate your order” e-mail sent 10 days later. |
| 25, 50 or 100 € — sent to the recipient by e-mail. | €25, €50 or €100 — sent to the recipient by e-mail. |

### `public/shop2/app.js` — `UI_RX` templates (12)

Capture placeholders (`$1`…`$3`) were preserved everywhere; a validator
confirms **0 placeholder mismatches** across all 26 rules.

| lang | before | after |
|---|---|---|
| ET | `Tasuta tarne — $1 lävi käes ✓` | `Tasuta tarne — piir $1 saavutatud ✓` |
| ET | `… järeletulek Mardi 1` | `… järeletulek aadressil Mardi 1` |
| ET | `Pakiautomaat $1` | `$1 pakiautomaat` |
| ET | `Kõik, mis on laos brändilt $1 — kõigist osakondadest.` | `Kõik brändi $1 tooted, mis on laos — kõigist poe osadest.` |
| ET | `Otsingule «$1» ei leidunud midagi.` | `Otsingule „$1“ ei leidnud midagi.` |
| EN | `$3 more to free shipping ($1, from $2)` | `$3 more to free delivery ($1, from $2)` |
| EN | `Free shipping — $1 threshold reached ✓` | `Free delivery — …` |
| EN | `Free shipping in Estonia from $1` | `Free delivery in Estonia from $1` |
| EN | `Free shipping from $1 — $2 to go` | `Free delivery from $1 — $2 to go` |
| EN | `Free shipping from $1` | `Free delivery from $1` |
| EN | `Free shipping: Estonia from $1 · …` | `Free delivery: Estonia from $1 · …` |
| EN | `Shipping — $1` | `Delivery — $1` |

`TAIL_EXACT`: ET `oversized T-särk` → `oversize T-särk` (Estonian retail uses
*oversize*, no `-d`).

### `public/shop2/app.js` — 8 new dictionary entries

These RU strings had no entry and rendered in Russian for ET/EN shoppers.
Adding them changed no existing key.

| RU (key) | ET | EN |
|---|---|---|
| Товара нет в наличии | Toode on otsas | This product is out of stock |
| Корзина пуста | Ostukorv on tühi | Your cart is empty |
| В наличии ✕ | Laos ✕ | In stock ✕ |
| Ссылка скопирована ✓ | Link kopeeritud ✓ | Link copied ✓ |
| Записали — сообщим, когда появится ✓ | Kirja pandud — anname teada, kui toode on taas laos ✓ | Noted — we'll let you know when it's back ✓ |
| Введите e-mail — на него придёт код | Sisesta e-posti aadress — sellele saadame koodi | Enter your e-mail — we'll send the code there |
| Товары заказа #1042 в корзине ✓ | Tellimuse #1042 tooted on ostukorvis ✓ | Items from order #1042 are in your cart ✓ |
| Сохранено ✓ | Salvestatud ✓ | Saved ✓ |

### `public/shop2/chat.js` (5)

| lang | before | after |
|---|---|---|
| ET | `Tere! Aitan valida. Öelge, mida otsite — näiteks «šampoon», …` | `Tere! Aitan valida. Ütle, mida otsid — näiteks „kohevust andev šampoon“, „kingitus kuni 50 €“ või „midagi habemele“.` |
| ET | `See sobib:` | `Need sobivad:` (the list is plural) |
| EN | `“gift under 50 €”` | `“gift under €50”` |
| EN | chip `Gift under 50 €` | `Gift under €50` |
| EN | `These fit:` | `Here's what fits:` |

### `public/shop/reviews-pool.js` (61)

* 28 ET + 28 EN reviewer names transliterated out of Cyrillic (RU block
  untouched — 28 Cyrillic names still there, as they should be).
* ET `Püsib ausalt 6-8 tundi` → `6–8 tundi` (en dash).
* EN `an honest 6-8 hours` → `6–8 hours`.
* EN `'doesn't use creams'` → `“doesn't use creams”` (straight quotes were the
  only ones in the file).
* EN `doesn't clash with cologne` → `doesn't clash with my fragrance`;
  `doesn't fight your cologne` → `doesn't compete with your fragrance`
  (*cologne* is an Americanism in a UK-voice shop, and the products are
  parfum/EDP).

### Product content — Estonian (11 entries)

Fixed in the translation sources (`out-03/11/17.et.json`), then regenerated with
`node tools/assemble-translations.mjs`. A rendered-text diff confirms **only**
these 11 ET entries and 1 RU entry changed.

| before | after | why |
|---|---|---|
| `valem` (×14, "formula") | `koostis` / `retseptuur` | *valem* is a maths/chemistry formula; Estonian cosmetics copy says *koostis* |
| `julmusevaba` / `Julmusevaba` | `loomkatsevaba` / `Loomkatsevaba` | literal calque of *cruelty-free* |
| `Dermatoloogide ja pediaatrite poolt testitud` | `Dermatoloogide ja pediaatrite testitud` | *poolt* passive calque |
| `annab tekstuuri, definitsiooni ning …` | `annab juustele tekstuuri, selged kontuurid ning …` | *definitsioon* is the English *definition* untranslated |
| `annab tekstuuri ja definitsiooni` | `annab tekstuuri ja selged kontuurid` | same |

### Legal pages — Estonian

`legal.et.json` → `returns.title` was **Toote tagastamine**, the footer link is
**Kauba tagastamine**; aligned the page title to the footer. The other four ET
legal pages read like real Estonian shop terms and needed no changes.

## Code-driven formatting — report, not edited

**`eur()` in `public/shop2/app.js` (line ~993) formats every price the Estonian
way in all three languages:**

```js
return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
```

* ET/RU output `12,90 €` and `43 €` — **correct**, nothing to change.
* EN output is also `12,90 €`. A UK/EU English shop writes **`€12.90`**, and it
  keeps the trailing zeros. Every price on the English storefront is currently
  formatted wrongly, including totals, thresholds and the cart.

Suggested language-aware version for whoever owns `eur()` — the `,00` strip is
only right for ET/RU, so it moves inside the branch:

```js
function eur(n) {
  var v = Math.round(n * 100) / 100;
  if (S.lang === "EN") return "€" + v.toFixed(2);
  return v.toFixed(2).replace(".", ",").replace(",00", "") + " €";
}
```

Two knock-on notes: the template literals that build price strings
(`THRESH.EE + " € · …"`, `"0 €"`, the admin KPI strings) also hard-code the
Estonian form, and the star-rating line does `String(avg).replace(".", ",")`
(lines ~1878 and ~1913) which gives `★ 4,8 out of 5` in English — that should
stay a full stop when `S.lang === "EN"`.

## Open items for the owning agents

1. **English product descriptions still carry the `<meta>` word-split.** One
   product is visibly broken: `davines-pasta-love-strong-hold-mat-clay` shows
   *"a dds texture and definition"* and *"s trong durable hold"*. I could not
   fix it from my side: `public/shop/content.js` is generated and must not be
   hand-edited, and `tools/build-content-full.mjs` seeds `content` from the
   **existing** `content.js` (`if (content[id]) continue;`), so carried-over
   entries are never re-sanitised. Two changes are needed in that tool, which is
   outside my region:
   * add `s = s.replace(/<meta\b[^>]*>\s*/gi, "");` to its `sanitize()`
     (same line I added to `assemble-translations.mjs`);
   * run the carry-over through it:
     `for (const [k, v] of Object.entries(OLD)) if (k === normId(k)) content[k] = sanitize(v);`

   115 of 220 EN entries carry `<meta>` tags — invalid inside `<body>` — even
   though only that one product breaks visibly.

2. **English legal pages read badly.** In `public/shop/legal.js`: 77 clause
   numbers are glued to the following word (`1.1Seller`, `1.2Buyer`,
   `2.1These`…), the dashes after them have no leading space (`1.1Seller–
   REMPIRE`), and there is one doubled word — *"at the Web Web store"*. The
   Estonian translations of the same pages are clean, because the translator
   restored the spacing. These pages are marked for lawyer replacement before
   launch, so this may resolve itself; flagging in case it does not.

3. **`public/shop2/index.html` has no ET/EN `<title>`, meta description or OG
   tags** — only Russian, plus a prerender block that is Russian-only. The
   `/shop2/et/` and `/shop2/en/` routes exist and are linked with `hreflang`.
   Whoever owns the head/prerender should add localised titles, descriptions and
   OG text per language.

4. **Duplicate key in the dictionary.** `"Новинки"` appears twice in each
   language block. In ET the two values disagreed (*Uuemad* as a sort option,
   *Uued* as a homepage heading) and JavaScript silently kept the second, so the
   sort option already rendered *Uued*. I set both to **Uued** so the file no
   longer lies about what ships. If the two contexts should read differently the
   RU side needs two distinct source strings — that is an RU-owner change.

5. **Untranslated admin strings.** These render in Russian on ET/EN because they
   are built with numbers or interpolation and have no `UI_RX` rule:
   `Наличие «<name>»: в наличии / мало / нет` (change log),
   `Цена, €` (product editor field label), the stock chips `нет` / `мало` /
   `в наличии` in the admin product list. Admin-only, so low priority, but they
   are the last Russian text left when the switcher is on ET/EN.

## Questions for Renat

1. **Two different company registration numbers are live on the site.** The
   footer says `Рег. 12216136 · KMKR EE102723858`; the legal pages say
   *"REMPIRE (THEFLOW OÜ) … registrikood 16320586"*. One of them is wrong, and
   it appears in the terms of sale. Which company and which registry code should
   the shop trade under?
2. **VAT number.** The footer shows `KMKR EE102723858`, which does not pair with
   either registry code above in an obvious way. Please confirm.
3. **Pickup storage fee.** The ET/EN copy says the order waits 7 days, then
   `1,50 € / €1.50` per day. Is that fee actually charged? If it is a deterrent
   that is never collected, softer wording would read better.
4. **"10 days" review e-mail.** The Russian says the "rate your order" letter
   goes out 10 days after the order; both translations had dropped the number
   and I restored it. Confirm 10 days is right before launch.
5. **Estonian for in-store pickup.** I kept **Järeletulek**. Estonian shops are
   split between *Järeletulek*, *Tulen ise järele* and *Kauplusest*. If you have
   a preference, it is a one-line change.
6. **Carrier spelling.** The Russian source strings say *SmartPosti* (an
   Estonian genitive) even in the English regex output, which produces
   "SmartPosti parcel locker". The carrier's own name is **Smartpost**. I fixed
   the standalone English label; changing the rest means editing the RU source
   strings, which I left alone. Confirm the spelling you want and the RU owner
   can align them.
7. **Beard vs hair "balm".** Both the hair-care chip `Кондиционеры` and the
   beard chip `Бальзамы` translate to Estonian **Palsamid**. Category context
   keeps them apart on screen, so I left both. If you would rather they read
   *Juuksepalsamid* and *Habemepalsamid*, say so — they get longer on a phone.

## E-mail wording suggestions

I did not touch `public/shop/emails/*.html` (the mail agent owns them). These
are the wording notes for whoever converts them, so the letters match the
storefront after this pass:

* **Use the same nouns as the shop.** ET: `Ostukorv`, `Tellimus`, `Tarne`,
  `Kuller`, `Pakiautomaat`, `Sooduskood`, `Kokku`, `Järeletulek`,
  `Kauba tagastamine`. EN: **Cart** (not Basket), **Delivery** (not Shipping),
  **Checkout**, **Parcel locker**, **Courier**, **Total**, **Returns**.
* **Subject lines.** ET `Tellimuse kinnitus — R-100042` /
  `Tellimus on teele saadetud — R-100042` /
  `Toode on taas laos` / `Sinu sooduskood`. EN `Order confirmation — R-100042` /
  `Your order is on its way — R-100042` / `Back in stock` / `Your promo code`.
  Keep the order number in the subject; Estonian shoppers search their inbox by
  it.
* **Address the reader informally in Estonian** (*sina*): `Aitäh tellimuse
  eest!`, `Sinu tellimus on kokku pandud`, `Anname teada, kui pakk teele läheb`.
  No *Lugupeetud klient* — it does not match the shop's voice.
* **Money.** ET `12,90 €` with a space before the euro sign; EN `€12.90` with
  two decimals. Do not reuse the storefront's `eur()` output for English until
  the fix above lands.
* **Units.** `50 ml`, `2 tk` in Estonian with a space; `50 ml`, `2 pcs` in
  English.
* **Estonian quotation marks are „…“**, not «…» and not "…". The storefront
  now follows this.
* **Legal line in the footer of every letter**: 14-day right of withdrawal, the
  hygiene exception for opened cosmetics, and the company's registry code —
  once question 1 above is settled.
* **Pickup letter** should name the address in the locative:
  `aadressil Mardi 1, 10145 Tallinn`, opening hours, and that a photo ID is
  needed (`Vaja on isikut tõendavat dokumenti` / `Photo ID required`).
