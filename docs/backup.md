# Database backup and restore

The production database (Railway Postgres 18: orders, customers, the owner's edits, sets, articles, settings) is backed up **every night at 02:15 UTC** by `.github/workflows/backup.yml` — since 29.10.2026; before that there was no backup at all (Railway's Hobby plan makes none).

Each night the job:
1. dumps the whole database (`pg_dump`, plain SQL, gzip);
2. **restores that dump into a throwaway Postgres and compares row counts** of orders, customers, products, sets, articles, settings, stock and the journal with the live database — so every backup is proven restorable, not hoped;
3. encrypts it (AES-256) and keeps it 30 days as a workflow artifact (GitHub → Actions → «Database backup» → a run → Artifacts).

A failed night mails the workflow owner like any red check.

## Setup (once)

GitHub → rempireshop/rempire-web → Settings → Secrets and variables → Actions → New repository secret:
- `BACKUP_DATABASE_URL` — the Postgres's public connection string (Railway → Postgres → Variables → `DATABASE_PUBLIC_URL`).
- `BACKUP_PASSPHRASE` — a long passphrase. **Keep it in the shop's password vault; Dim and Renat both.** Without it the backups cannot be opened.

Until both exist the job says so and stays green. Run it once by hand (Actions → Database backup → Run workflow) to see the first one.

## Restore

1. Download the artifact (a `.zip` holding `rempire-YYYY-MM-DD.sql.gz.gpg`) and unzip it.
2. Create an empty Postgres 18 (Railway → New → Database → PostgreSQL), copy its public URL.
3. `gpg --batch --passphrase "<BACKUP_PASSPHRASE>" -d rempire-YYYY-MM-DD.sql.gz.gpg | gunzip | psql "<new database URL>"`
4. Put the new URL into Vercel → rempire-web → Settings → Environment Variables → `DATABASE_URL` (Production), then redeploy.

The restore drill is the job itself: step 2 above runs every night.
