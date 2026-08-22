# Open questions after Renat's answers

Status 22.08.2026. Everything here is unresolved after the 26-question round
(`docs/RENAT-ANSWERS.md`). Grouped by what it blocks, not by topic.

## A. Blocks the architecture — ask Renat directly

1. **Who else works in the admin, and what do they do?**
   He said he only edits texts and pages; the business register lists zero
   employees. Someone adds products, checks stock and processes orders.
   Until we know who and what, we cannot design roles, permissions or the
   admin's default screen. *Blocks: admin UX, permissions model.*

2. **Which POS or cash-register system does the physical shop use?**
   He requires shop stock to stay in sync with the site. No integration can
   be scoped without the product name — and some systems have no API at all,
   in which case sync means scheduled imports or manual adjustment instead.
   *Blocks: inventory architecture, integration scope, price.*

3. **Do products have SKUs and barcodes today, and are they consistent?**
   Any stock sync, and any warehouse workflow, hangs off a stable identifier.
   If Shopify has half-filled SKU fields, that is a data-cleanup task to
   price in now rather than discover during migration.
   *Blocks: data model, migration plan.*

4. **Are there salon, wholesale or professional customers who pay different
   prices?** He carries professional brands and the company's registered
   activity is hairdressing, so this is likely. Customer-group pricing is
   cheap to design in from the start and expensive to retrofit.
   *Blocks: pricing model, CRM design.*

5. **Should customers be able to collect orders from the shop?**
   He selected DPD, Omniva, SmartPosti and courier, but not pickup — while
   also confirming a physical location. Probably an oversight; confirm.
   *Blocks: checkout design, shipping configuration.*

6. **Does he want product reviews on the new site?**
   He chose not to migrate reviews, which may mean there are none rather
   than that he does not want them. Reviews affect product-page design and
   are a real organic-search asset, which is his stated goal.
   *Blocks: product page design, data model.*

## B. Blocks invoicing and legal — ask Renat, then his accountant

7. **Which company details are canonical?**
   His answer matches neither the register nor any single value on the site:

   | | He said | Register | Site |
   |---|---|---|---|
   | Phone | 56237237 | +372 53035580 | both appear |
   | Email | rempiretower@gmail.com | renatgayanov@gmail.com | rempireshopinfo@, blackboxestonia@ |
   | Address | — | Paikuse, Pärnu | Mardi 1, Tallinn |

   Invoices, the legal notice and order emails all need one agreed set, and
   the invoice address in particular must be defensible.
   *Blocks: invoice templates, legal pages, transactional email.*

8. **Is the company registered for VAT OSS?** (accountant)
   He wants to sell to all of Europe. Cross-border B2C sales above €10,000
   per year across the EU require OSS registration and destination-country
   VAT rates. This determines whether v1 ships one VAT rate or a rate table.
   *Blocks: tax model, checkout totals, invoices.*

9. **Who signs off the legal pages?**
   The returns policy has to change — a blanket "cosmetics are
   non-returnable" is not permitted under EU distance-selling rules; only
   sealed hygiene goods opened after delivery may be excluded. We can draft,
   but somebody with legal responsibility must approve before launch.
   *Blocks: launch.*

## C. Access we need — requests, not questions

None of these are answerable in a form; they are things Renat has to hand
over or create. Several involve waiting on third parties, so start early.

10. **Shopify admin access** — a staff account or Admin API credentials, to
    audit the real catalogue and build a repeatable migration.
11. **Control of `rempireshop.com` DNS** — who holds the registrar login.
    Required to plan the cutover; nothing changes until launch day.
12. **Google accounts** — Analytics, Search Console and Merchant Center: do
    they exist, and who owns them? His headline goal is "гугл синхронизация",
    which means a Merchant Center product feed, and we cannot protect
    existing search rankings through a migration without Search Console.
13. **Payment provider** — he wants bank links, which the shop does not have
    today, so a new contract (Montonio being the obvious fit for the Baltics)
    has to be signed by him. Onboarding involves identity checks and takes
    real calendar time; start it before it becomes the critical path.
14. **Meta business assets** — Instagram and Facebook are part of the brand;
    catalogue sync and any social content on the site need access.

## D. Affects quality, not feasibility

15. **Product photography.** Does he hold original files, and is he willing
    to reshoot key products? "Expensive-looking" is decided more by
    photography consistency than by layout. Worth an honest conversation
    before he judges either design direction.
16. **Free shipping thresholds.** Keep the current €50 for EE/LV/LT/FI and
    €200 for the rest of the EU, or revisit?
17. **Instagram content on the site.** Useful for the editorial sections and
    cheap to wire up, if he wants it.

## Suggested handling

Items 1–6 are short and concrete: publish them as a second round on the same
`/qa` page (`/qa2`), in Russian, same one-button submission. Ten minutes of
his time.

Items 7 and 10–14 are better handled in a single call or message thread —
they need back-and-forth and, in several cases, him logging into something
while you watch. Items 8, 9 and 15 need other people (accountant, lawyer,
photographer) and should be started now because they run on someone else's
schedule.
