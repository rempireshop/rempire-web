# REMPIRE — Tower Motion

The tower moves like a chess piece: one confident move, then stillness. This document is the
contract for every animated appearance of the mark.

**Where the code is (07.09.2026).** `TowerAnimated.tsx` and the static `Tower.tsx` were React
components used only by the design-review hub at `/demo`, which was deleted together with the
rest of the prototype surfaces (`docs/audit/2026-09-07-cleanup.md`); the demo page
`/prototypes/motion/` went with it. Nothing in the shop is React, so there is nothing for them
to live in today. Both files, and the motion demo page, are in git history at `448cbd7` —
take them from there when the mark is animated again. This document is still the contract; the
timings and the technique below are what any reimplementation must match, and the canonical
mark it clips is `public/brand/rempire-tower.svg`.

## Technique — the mark is never redrawn

`rempire-tower.svg` is a single continuous ribbon (one subpath), so it cannot be split into
subpaths without redrawing. Instead the component renders **six clipped copies of the untouched
canonical path** — clip windows that tile the plane:

| group | data hook | window (user units) |
|---|---|---|
| merlon left | `[data-merlon="1"]` | x&lt;381, y&lt;212 |
| merlon center | `[data-merlon="2"]` | 381–466, y&lt;212 |
| merlon right | `[data-merlon="3"]` | x&gt;466, y&lt;212 |
| collar / flare | `[data-flare]` | y 210–300 + right pocket 508–580 × 300–371, minus band |
| band (arc) | `[data-band]` | 337–500 × 244–302 |
| body | `[data-body]` | y&gt;300, minus the pocket |

Wrappers: `[data-crown]` = merlons + flare + band; `[data-mark]` = whole tower.
Cuts run through paper except two ink crossings (merlon roots y≈210, band neck x≈338); both are
overlapped by ~2 units so coverage stays solid. **At rest the component shows the canonical path
itself** — a single untouched node; the windowed copies composite only while a state is playing
(clip-seam antialiasing makes a six-copy composite sub-pixel imperfect, so it is never the resting
render). Their tiling is verified by canvas diff at 28/80/400 px on `/brand/motion` — sub-antialias
residuals only, nothing past half-scale.
Clips move with their group, so a moving piece stays whole.

Two reveals go further with **masks over the same untouched path**: *Sketch-then-solid* re-traces
the ribbon with an animated stroke mask at 45 % pencil weight (two strokes — the body loop, then
crown and band; `stroke-dashoffset` on the hidden mask stroke, never on the mark — driven by rAF
attribute writes, since CSS animations do not tick inside a `<mask>` subtree), then floods to full
ink with a rising fill mask; *Brickwork*
assembles it through a running-bond brick mask, mortar seams visible only while building. Mask
layers are hidden at rest, so the rest pose is always the canonical path. Mask reveals repaint
(not pure compositor) — reveal-only, never for idle or loop.

**Transform + opacity only** for everything that repeats. No filters, no strokes, no layout properties. GPU-composited.

## Tokens

| token | value | used by |
|---|---|---|
| `--tw-t-draw` | 1600 ms | drawn-in-one-line reveal (house ident length; body 0–55 %, crown 55–97 %, swap at 88 %) |
| `--tw-t-brick` | 980 ms | brickwork reveal (48 ms/course, 240 ms/brick, 13 courses crown-down) |
| `--tw-ease-firm` | `cubic-bezier(.2,.8,.2,1)` | reveals, drops, hover |
| `--tw-ease-settle` | `cubic-bezier(.3,1.4,.4,1)` | arrival segments only, sparingly |
| `--tw-ease-inout` | `cubic-bezier(.45,0,.25,1)` | blink, rook turn |
| `--tw-t-reveal` | 640 ms | castling |
| `--tw-t-drop` | 520 ms | placed (+50 ms crown lag) |
| `--tw-t-build` | 1240 ms | Tower Build (default opening): base 0–340, band sweep 360–660, collar 480–780, merlons 620–1120 with −4 u settle |
| `--tw-t-light` | 1300 ms | light pass: 9 % paper band travels up the ink once, clipped to the mark |
| `--tw-t-rise` | 340 ms | build stage base duration |
| `--tw-t-blink` | 380 ms | idle |
| `--tw-t-turn` | 380 ms | ident merlon (110 ms stagger ×3) |
| `--tw-t-loop` | 2000 ms | loading period (motion in first 600 ms) |
| `--tw-t-hover` | 200 ms | hover — mark rises 2 px, reversible |

Travel is authored in viewBox units so it scales with the mark: castling 146 u ≈ 10 px at the
28 px header, overshoot 8 u ≤ 1 px; placed drop 73 u ≈ 5 px; fortress rise 24 u; blink 14 u ≈ 1 px;
merlon turn 18 u.

## States

| state | where | rule |
|---|---|---|
| Reveal — Tower Build (primary) + one light pass | homepage/hero first paint, admin login | once per session (`sessionStorage: rempire-tower-revealed`); the light pass runs once after the build, never loops |
| Reveal — sketch-then-solid | brand pages, long-form moments | same session rule; too long for navigation |
| Reveal — castling (header pick) | 28 px sticky header | same session rule; quick and quiet where a build would linger |
| Reveal — brickwork / placed | alternates | same session rule |
| Idle — sentry blink | header mark only | every 6–9 s randomized, ≤380 ms, suppressed on hidden tab; never twice within 5 s |
| Hover / focus | logo links | 200 ms — the mark rises 2 px and returns, reversible; focus-visible = 1 px ink outline, offset 3 px |
| Ident — turn of the rook | logo click, order confirmed | 600 ms total; gate below 48 px rendered size (sub-pixel at 28) |
| Loop | route transitions, admin processing, later add-to-cart | 2 s period, stops only on the rest pose (iteration boundary) |

First integration: `/qa` header — reveal + rare idle only. The questionnaire must stay calm.

## Explorations (demoed on /brand/motion, not yet in TowerAnimated)

| concept | what | allowed placement |
|---|---|---|
| Ink rise | fill mask rises base→crown, 900 ms; fill level can track real progress | reveal alternate; determinate progress (add-to-cart, upload) — never checkout |
| Light pass | 9 % paper-light band travels up the ink once, 1300 ms, clipped to the mark | after Tower Build on the homepage; run once, never looping |
| Hero stage | oversized 6 % tower behind the wordmark; wordmark settles into its tracking | homepage hero opening — both brand elements share one motion |
| Sundial | 9 %-opacity shadow sweeps past the standing tower, 1800 ms | rare idle, hero ≥80 px only |
| The turn | 16° perspective quarter-glance and return, 700 ms | ident alternative |
| Letterpress | scale .982 press-and-release, 240 ms, no bounce | order-confirmed moment only |
| Breath | 0.65 % swell from the base every 4.2 s, compositor-only | hero ambient; paused on hidden tab |

## Assets

- `rempire-tower.svg` — canonical mark, never edited
- `rempire-tower-crown.svg` — crown-only cut (favicon / app / admin), exact geometry via clip window
- `rempire-tower-outline.svg` — derived centerline line variant, approximate; sketch uses only

## Never

- Never on checkout actions.
- Never looping in viewport while the user types.
- Never more than one animated mark visible.
- `prefers-reduced-motion: reduce` → static mark. Skipped, not shortened.
- Never delay interaction, block paint, or shift layout (mark owns its final box from first paint; CLS 0).
- No gold, no glow, no bounce physics, no squash.

## Quality gate

- Rest pose IS `rempire-tower.svg` (canonical node); motion-composite tiling verified at 28/80/400 px (automated check on `/brand/motion`).
- CLS 0 on reveal; SSR renders rest pose, play classes attach after hydration.
- Idle: randomized, suppressed when hidden, reduced-motion skipped.
- 60 fps target on mid-range Android (transform/opacity only; verify with 4× CPU throttle).
