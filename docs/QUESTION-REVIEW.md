# Round 2 questions — what survived the test, and why

Every question on `/qa2` had to pass three tests:

1. **Can we find the answer ourselves?** If yes, asking is worse than useless
   — it wastes his time and invites a wrong answer, because on several of
   these we now know his shop better than he does.
2. **Does it block a decision we are making now?** If it can wait, or if we
   can pick a sensible default and change it later cheaply, it should not be
   a question.
3. **Is he the right person?** Some answers belong to his accountant, his
   POS vendor, or a lawyer.

The catalogue audit on 22.08 (`rempire-api/docs/SHOPIFY-CATALOGUE-AUDIT.md`)
changed the answers to test 1 for several drafts. Three were cut.

## Cut

**"Есть ли у товаров артикулы (SKU) и штрихкоды?"** — fails test 1. We
measured it: 193 of 434 variants have a SKU, 44% coverage. Renat would
almost certainly have answered "да, есть", because owners rarely know their
own field coverage, and we would have believed a wrong answer over our own
data.

Replaced with the question we genuinely cannot answer: whether the physical
packaging carries a scannable barcode, and who could fill the gaps. Barcodes
are not exposed on Shopify's public endpoints, and most professional
cosmetics carry an EAN — if they do, the barcode becomes the sync key and
240 missing SKUs stop being a blocker.

**"Нужен ли самовывоз из магазина?"** — fails test 2. The current shop does
not offer local pickup (no pickup-availability block on product pages), so
it is a new option either way. But it is a checkout configuration toggle
worth minutes, not a structural decision. We will build it and default it
off; he can switch it on whenever he likes. Asking would have implied it
costs something to decide.

**"Нужны ли отзывы о товарах?"** — fails tests 1 and 2. The live site has no
review app installed and zero reviews on any product, which is why he chose
not to migrate them. Meanwhile the honest answer to "do you want reviews" is
always yes, so the question buys nothing. The product page will be designed
with room for ratings and the data model will support them; whether he
invests in collecting reviews is a conversation for after launch, not a
checkbox now.

## Kept

**Who else uses the admin.** Cannot be derived — the business register shows
zero employees, but someone maintains 224 products. Decides whether v1 needs
a users-and-permissions system at all, which is real money either way.
Changed from a blank text box to options, because a non-technical person
answers a list faster and more accurately than an empty field.

**Which POS the shop runs.** Cannot be derived, and no stock-sync work can be
scoped without it — some systems have an API, some have nothing, and the
difference decides whether "sync" means live integration or a nightly import.
Now offers the common Estonian systems plus "не знаю — посмотрю", so he can
answer honestly instead of guessing.

**Whether salons or wholesale customers get different prices.** Cannot be
derived. Customer-group pricing is cheap to design in now and expensive to
retrofit, exactly the kind of thing worth one question.

**Whether he will reshoot photography.** Cannot be derived, and it is now
urgent rather than abstract: 152 of 224 products have exactly one image. He
is about to choose between two design directions, and neither will look
"dorogoy" across a catalogue that thin on imagery. The question now carries
the number, so he is deciding against evidence rather than in principle.

**Which company details are canonical.** Cannot be derived — we verified the
register, and his own answer matched neither it nor the site. Invoice
templates, the legal notice and every transactional email are blocked on
one agreed set. The question shows him the specific conflicts rather than
asking him to hunt for them.

## Deliberately not asked at all

- The 62 inconsistent `product_type` values, the duplicate `BLACK FRIDAY`
  and `REMPIRE MERCH` collections, and the €0 "Delivery" product. These are
  cleanup we should do and then show him, not homework to hand back.
- Whether to keep the `en-lv` and `en-lt` locale URLs. He already said "вся
  Европа"; the URL strategy is our call to make and document.
- VAT OSS registration — his accountant's answer, not his.
- Sign-off on the rewritten returns policy — needs someone with legal
  responsibility.
