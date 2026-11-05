# Portability and handover

The project starts on Dmitri's accounts so demos can happen without waiting
on Renat to sign up for anything. Everything must therefore be movable to
Renat's own accounts later, and movable to a different vendor after that,
without a rewrite.

Two different problems, often confused:

- **Handover** — same service, different owner. Mostly an admin task, but
  only if we avoid the traps below.
- **Vendor exit** — different service entirely. An architecture problem,
  solved now or not at all.

## Rule 1 — some things must never start on Dmitri's account

Not everything is safely transferable later. Two categories must be Renat's
from day one:

**Payments.** A Montonio (or any PSP) contract is KYC'd to a specific legal
entity and settles into that entity's bank account. Money from Renat's
customers must never land in an account belonging to Diip Solutions — that
is a legal and tax problem, not an inconvenience, and "we'll move it later"
means re-onboarding from scratch. Renat signs the payment contract himself,
in the name of Rempire Store OÜ. Dmitri gets API credentials for the
integration, nothing more.

**Google properties.** Search Console, Merchant Center and Analytics should
be created under Renat's Google account with Dmitri added as a delegated
user. Search Console in particular carries historical performance data
attached to the property; recreating it later loses the history that makes
migration damage visible. Same for Meta business assets.

Everything else in the table below may start on Dmitri's account.

## Ownership register — as of 22.08.2026

| Asset | Whose account now | Target owner | How it moves |
|---|---|---|---|
| `github.com/dimnovare/rempire-web` | Dmitri | Renat or a shared org | GitHub repo transfer, or move both into an organisation now and change membership later |
| `github.com/dimnovare/rempire-api` | Dmitri | same | same |
| Vercel project `rempire-web` | Dmitri (`dimnovare-9994s-projects`) | Renat | Vercel supports transferring a project between teams; alternatively reconnect the repo to a new account and redeploy — the build is reproducible, so nothing is lost |
| Vercel Blob store `rempire-qa` | Dmitri | nobody — retire it | Questionnaire answers only. Export the JSON, keep it in the repo docs, delete the store. **Not to be used for production media** — see rule 2 |
| DNS zone `diipsolutions.eu` | Dmitri (Cloudflare) | stays Dmitri's | It is Dmitri's domain. Only hosts staging; nothing to hand over |
| `rempireshop.diipsolutions.eu` | Dmitri | retired at launch | Staging only. Dies when production goes live |
| `rempireshop.com` | **Renat** | unchanged | We never take ownership. We need one DNS change at cutover, ideally with Renat present |
| Telegram bot `@rempireshop_bot` | Dmitri | retire or hand over | Internal notification only, not part of the product. Token lives in Vercel env, revocable via BotFather |
| Railway (API + Postgres) | Dmitri, when created | Renat | Railway can transfer projects; a `pg_dump` restore into any Postgres is the fallback and should be rehearsed once regardless |
| Cloudflare R2 (media) | Dmitri, when created | Renat | S3-compatible; `rclone sync` to any S3 bucket. See rule 2 |
| Resend (email) | Dmitri initially | Renat | Domain-verified sending must eventually be on Renat's domain. See rule 3 |
| Payment provider | — | **Renat from the start** | See rule 1 |
| Google / Meta properties | — | **Renat from the start** | See rule 1 |

## Rule 2 — storage stays S3-compatible

Product images, CMS media and generated invoices are the assets that hurt
most to move, because URLs to them end up embedded in content and indexed by
Google.

- Use Cloudflare R2 through its **S3-compatible API only**. No R2-specific
  bindings, no Workers in the data path, no dependency on Cloudflare Image
  Resizing for anything the database points at. The migration to S3, Backblaze
  or Hetzner then reduces to `rclone sync` plus one environment variable.
- Never store an absolute vendor URL in the database. Store the object key;
  build the URL at render time from a single configured base. Moving buckets
  must not require rewriting rows.
- Serve media from a **custom domain** (`media.rempireshop.com` or similar)
  from day one, never from `*.r2.cloudflarestorage.com`. That way the vendor
  can change without a single public URL changing, and without re-indexing.
- Invoices are legal documents. They also get written to R2, and the same
  rules apply, plus retention: Estonian bookkeeping law requires keeping them
  for seven years, so the export path must be tested, not assumed.

Note the inconsistency this creates with the questionnaire, which currently
uses Vercel Blob. That is deliberate and temporary: Blob was the fastest way
to stop losing answers, the data is throwaway once Renat has answered, and
nothing links to those objects. Production media does not go there.

## Rule 3 — every third party sits behind an interface

The commerce backend talks to four kinds of outside service. Each gets a
narrow interface in the domain layer and an adapter in infrastructure:

| Concern | First adapter | Why it must be swappable |
|---|---|---|
| Payments | Montonio | Rates change; a second provider may be wanted for cards |
| Shipping / labels | Montonio Shipping | Carrier mix will change; DPD-only today is already wrong |
| Email | Resend | Starts on Dmitri's account, must move to Renat's domain |
| Object storage | Cloudflare R2 | See rule 2 |

The rule that makes this real: **no provider SDK type may appear in domain
code or in a database column.** Provider references are stored as opaque
strings alongside the name of the provider that issued them, so a historical
order still makes sense after a provider change.

Email deserves particular care because it starts on Dmitri's account. Message
*content* — templates in EN/ET/RU — belongs to the application, not to the
ESP. No templates in the Resend dashboard, no ESP-hosted content, no
provider-specific merge syntax. Switching ESPs should mean changing one
adapter and one API key, with the emails looking identical.

## Rule 4 — the data must be exportable on demand

Portability is a claim until it is tested. The definition of done for the
platform includes a documented, rehearsed export:

- `pg_dump` of the full database, restorable into a stock PostgreSQL.
- `rclone sync` of the media bucket.
- A catalogue export (products, variants, prices, stock) in CSV that a
  non-developer could hand to another agency.
- The redirect map as a plain CSV (already produced —
  `tools/url-inventory.mjs`).

No proprietary formats, no data that exists only inside a vendor UI. If a
feature can only be configured through a dashboard rather than committed
config, that is a lock-in risk and needs a written justification.

## What the demo phase specifically must avoid

Because the first phase is a demo on Dmitri's accounts, three temptations are
worth naming:

1. **Do not point `rempireshop.com` at anything before launch.** Staging
   stays on `rempireshop.diipsolutions.eu`, noindex, until the real cutover.
2. **Do not collect real customer data on the demo.** No real orders, no real
   newsletter signups, no real payments through a test account. Demo data
   only — otherwise the handover inherits a GDPR obligation nobody planned
   for.
3. **Do not let the demo become the production instance by accident.** The
   launch is a deliberate promotion with its own database, its own
   credentials and its own DNS change — not "we just flipped noindex off".
