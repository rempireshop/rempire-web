# REMPIRE Q&A page — design spec

Date: 2026-08-21 · Status: approved (Dmitri, in-session) · Scope: sub-project 1 of the Rempire rebuild

## Goal

Get clear answers out of Renat (shop owner, not computer-friendly, Russian-speaking)
before building the REMPIRE e-commerce platform. One shareable link he opens on
his phone, answers in ~10 minutes, and returns answers with one tap.

## Decisions (confirmed with Dmitri)

1. **Two repos**, not a monorepo: `rempire-web` (Next.js → Vercel) +
   `rempire-api` (ASP.NET Core → Railway, skeleton for now). Supersedes the
   monorepo preference in the master build prompt.
2. **Russian only** — source questionnaire is already Russian.
3. **Interactive form**, no backend: tap-choices + few textareas, localStorage
   autosave, returns answers via native share sheet (WhatsApp/Telegram),
   clipboard, or prefilled mailto.
4. **Brand assets** downloaded from the client Dropbox (2025 tower badge
   identity, Korolev/VodkaBrush fonts).

## Content

22 questions in 8 sections (А Главное · Б Внешний вид · В Работа каждый день ·
Г Клиенты и рассылки · Д Статистика и AI · Е Оплата и доставка · Ж Переезд со
Shopify · З Деньги и сроки), condensed from the 26-question Russian original.
Merged: платежи 15+16+17→один, статистика 11+12, продвижение 13+14.
Data: `src/data/questions.ts`. ~14 tap questions, ~8 short-text.

## Architecture

- Next.js 15 App Router, TypeScript, Tailwind 4, bun; `output: "export"`
  (static) until the storefront needs a server. Same pinned versions as
  FrameForge (known-good set).
- `/qa` = server page with RU/OG metadata + `QaForm` client component.
  Root `/` client-redirects to `/qa/`.
- State: `Record<questionId, {sel: string[], text: string}>` in
  `localStorage["rempire-qa-v1"]`; summary builder produces a plain-text
  message; `navigator.share` / clipboard / `mailto:` deliver it.
- Visual: monochrome editorial — ink `#1c1a00` (the badge colour) on warm paper,
  Korolev Bold display, system sans body, tower mark inlined as
  `currentColor` SVG. 48px tap targets, visible focus, reduced-motion safe.

## SEO / previews

Staging is noindex three ways (meta robots, robots.txt, `X-Robots-Tag` via
vercel.json). OG card 1200×630 `og-qa.png` with absolute URLs per the
FrameForge checklist.

## Error handling

localStorage in try/catch (private mode → form still works, no autosave);
share cancel is not an error; clipboard failure leaves email/share paths.
Unanswered questions serialize as "—" and sending partial answers is fine.

## Testing

`bun run typecheck` + `bun run build` must pass; manual QA of the built
export (desktop + 375px mobile viewport) incl. tap/autosave/summary; header
and OG verification on the deployed host with curl.

## Out of scope

Design system, storefront, admin, API implementation, Shopify migration,
updating the two master prompts. Next sub-project starts from the answers
Renat sends back.
