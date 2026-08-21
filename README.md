# rempire-web

REMPIRE shop rebuild — the web application (storefront + admin eventually).
Current phase: **questionnaire for Renat** at `/qa` on the staging domain
`rempireshop.diipsolutions.eu`.

Backend counterpart: `rempire-api` (ASP.NET Core, separate repo).
Project brief and master prompts live in the `Rempire` docs folder
(`REMPIRE Commerce Platform — Claude Code Master Build Prompt.md` et al.).

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 App Router, static export (`output: "export"`) — remove the export flag when the real storefront needs a server |
| Language | TypeScript |
| Styling | Tailwind CSS 4, tokens in `src/app/globals.css` |
| Fonts | Korolev Bold, self-hosted from `public/fonts` |
| Package manager | bun |
| Hosting | Vercel, `rempireshop.diipsolutions.eu` |

```bash
bun install
bun run dev        # http://localhost:3300 — / redirects to /qa/
bun run build      # static export into out/
bun run typecheck
```

## Routes

```
/      → client redirect to /qa/
/qa/   → Russian questionnaire for Renat (22 questions, localStorage autosave)
```

Answers never leave the browser until Renat presses share/copy/email —
there is no backend. The share sheet / mailto target the project owner.

## Staging SEO safety

This host must never enter search indexes (non-negotiable until production
launch): `robots` metadata in `src/app/layout.tsx`, `public/robots.txt`,
and an `X-Robots-Tag: noindex, nofollow, noarchive` header from `vercel.json`.
Lift all three deliberately at launch, not before.

## Brand

The 2025 identity is the **tower badge** (`rempire_logo_2025`): rook tower,
REMPIRE TOWER arc, "est 2018", "666 ways", script slogan. Source vectors in
`public/brand/` (badge + lockup, dark/white) and `design/` (AI/PDF originals,
PNG renders).

`public/brand/rempire-tower.svg` and `src/components/Tower.tsx` are the tower
mark **extracted verbatim** from the badge (path 0, bbox `292.24 171.22
265.18 409.8`). Do not redraw; re-extract if the brand file changes.
Brand ink: `#1c1a00`.

### Font licensing — read before production

`Korolev Bold.otf` (Device Fonts) and `VodkaBrush-Regular.otf` arrived as
desktop OTFs from the client's Dropbox. Desktop licences usually do **not**
cover web embedding. Fine for a private staging questionnaire; before the
public storefront launches, confirm or buy webfont licences (and convert to
woff2). VodkaBrush is not used on the site yet — it lives in `design/` only.

## Link previews (OG)

`public/og-qa.png` is the 1200×630 card for `/qa`, wired in
`src/app/qa/page.tsx`. Rules that keep Telegram/WhatsApp happy (learned on
FrameForge): absolute image URL via `metadataBase`, explicit
`og:image:width/height`, the PNG must answer `200 image/png` with no
redirect. If the artwork changes, change the filename (`og-qa-v2.png`) —
clients cache by URL. Regenerate: `design/og-qa.html` in a 1200×630 viewport.

## Deploying

Vercel project `rempire-web` (dimnovare-9994), production = `main`.

1. `vercel --prod` (or push to `main` once the Git integration is on).
2. Domains: `rempireshop.diipsolutions.eu` (+ `www.` redirect).
3. DNS at the `diipsolutions.eu` zone: `CNAME rempireshop → cname.vercel-dns.com.`
   (+ same for `www.rempireshop`). Only these subdomains — apex and the other
   project subdomains stay untouched.
