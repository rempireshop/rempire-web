/* Where a cover photo is looked at — the one setting, and the one place that
   reads it.

   The complaint it answers (Renat, round 20 and again 18.09.2026, drawn on a
   screenshot of the blog editor): «возможность редактировать размер или
   двигать фото для обложки». One photo is shown in four frames of three
   different shapes — the list tile and the top of the article (1200×630), the
   social card the scraper asks for (a 518×518 square beside the title), and
   the one the build draws (a full-bleed 1200×630) — and until now the owner
   could choose nothing about any of them. The page fitted the picture in
   whole and left white bars at the sides; the social card cropped it with
   sharp's `attention` strategy, which is a guess at where the detail is and
   is where the halved faces came from.

   So: ONE point, not a crop per frame. A crop would have to be drawn four
   times, once per shape, and redrawn the day a fifth frame appears or one of
   them changes ratio. A point is dragged once and every frame reads it — it
   is exactly what `object-position` / `background-position` already take, and
   the two sharp crops below are the same arithmetic written out. It is also
   the only one of the two that a thumb can do on a phone.

   The stored value is one short string, `"<mode> <x> <y>"`:

     fill 62 28   the photo fills the frame and is cropped; the point at 62%
                  across and 28% down is what the frame keeps
     fit 50 50    the photo stands in the frame whole, as it always has; the
                  point still steers the social card, which crops no matter
                  what the page does
     (absent)     every article written before this existed. The page fits the
                  picture whole and the social card goes on guessing with
                  `attention` — untouched, byte for byte.

   A closed vocabulary checked on the way in and on the way out, like
   `data-fig` in blog-cover's neighbour src/lib/blog-html.mjs: anything that
   is not one of the two words with two numbers in range reads back as null,
   which is the same as absent, which is what every old post already is.

   Plain ESM (.mjs) for the reason blog-html.mjs and seo-head.mjs are: the
   prerender runs as a bare `node` script with no loader, and it draws covers
   too. The fifth reader, blogCoverFocus() in public/shop2/app.js, is a
   deliberate twin — a script the page loads without a build step cannot
   import this file — and tests/blog-cover.test.ts reads that function out of
   app.js and runs it against this one so the twin cannot drift the way the
   sanitiser's did. */

/** The photo stands in the frame whole — what every cover did before this. */
export const COVER_FIT = "fit";
/** The photo fills the frame and is cropped around the point. */
export const COVER_FILL = "fill";

const MODES = { fit: 1, fill: 1 };
const FOCUS_RE = /^(fit|fill)(?:\s+(\d{1,3})\s+(\d{1,3}))?$/;

const clampPct = (n) => (n < 0 ? 0 : n > 100 ? 100 : Math.round(n));

/**
 * The stored string → `{ fill, x, y }`, or null for absent and for anything
 * this vocabulary does not contain. A bare `"fill"` means the centre.
 */
export function readCoverFocus(raw) {
  const m = FOCUS_RE.exec(String(raw == null ? "" : raw).trim().toLowerCase());
  if (!m) return null;
  const x = m[2] === undefined ? 50 : Number(m[2]);
  const y = m[3] === undefined ? 50 : Number(m[3]);
  if (x > 100 || y > 100) return null;
  return { fill: m[1] === COVER_FILL, x, y };
}

/**
 * `{ fill, x, y }` (or a string already in the vocabulary) → the one shape
 * that is stored, or null. This is what the column holds and what a payload
 * from the panel is measured against, so a hand-written API call cannot put
 * anything else in the row.
 */
export function writeCoverFocus(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const f = readCoverFocus(value);
    return f ? `${f.fill ? COVER_FILL : COVER_FIT} ${f.x} ${f.y}` : null;
  }
  if (typeof value !== "object") return null;
  const mode = String(value.mode || (value.fill ? COVER_FILL : COVER_FIT)).toLowerCase();
  if (!MODES[mode]) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return `${mode} ${clampPct(x)} ${clampPct(y)}`;
}

/* ---------- what a frame does with it ------------------------------------
 *
 * Both CSS properties below place a picture the same way, and it is worth
 * naming because the two sharp crops further down have to agree with it: a
 * position of `x%` lines the point x% ACROSS THE PICTURE up with the point x%
 * across the frame. Not «centre the point» — at 0% the left edge stays on the
 * left edge instead of being dragged into the middle and clamped back, which
 * is what makes dragging feel like moving the photo rather than fighting a
 * clamp at the ends.
 *
 * Nothing is written at all when there is no focus and when the mode is
 * `fit`: the frames' own rules in styles.css already fit a cover whole and
 * centre it, and an inline style that merely repeats them would be one more
 * thing to keep in step with them.
 */

/** The inline style for an `<img>` frame — the server-rendered and prerendered pages. */
export function coverImgStyle(focus) {
  const f = typeof focus === "string" ? readCoverFocus(focus) : focus;
  return f && f.fill ? `object-fit:cover;object-position:${f.x}% ${f.y}%` : "";
}

/** The same for the SPA's frames, which carry the picture as a background. */
export function coverBgStyle(focus) {
  const f = typeof focus === "string" ? readCoverFocus(focus) : focus;
  return f && f.fill ? `background-size:cover;background-position:${f.x}% ${f.y}%` : "";
}

/**
 * The crop a social card takes: the largest rect of the frame's shape that
 * fits inside a `w`×`h` photo, placed by the same rule the two styles above
 * follow. Integers, inside the photo by construction — sharp's `extract()`
 * throws on a rect that leaves the image.
 *
 * Returns null when there is nothing to crop (a photo already of that shape,
 * or dimensions sharp could not read), which is the caller's signal to resize
 * as it did before.
 */
export function focusCrop(w, h, frameW, frameH, focus) {
  const f = typeof focus === "string" ? readCoverFocus(focus) : focus;
  if (!f) return null;
  const sw = Math.floor(Number(w) || 0);
  const sh = Math.floor(Number(h) || 0);
  const fw = Number(frameW) || 0;
  const fh = Number(frameH) || 0;
  if (sw < 1 || sh < 1 || fw <= 0 || fh <= 0) return null;

  let cw = sw;
  let ch = Math.round((sw * fh) / fw);
  if (ch > sh) {
    ch = sh;
    cw = Math.round((sh * fw) / fh);
  }
  cw = Math.max(1, Math.min(sw, cw));
  ch = Math.max(1, Math.min(sh, ch));
  return {
    left: Math.max(0, Math.min(sw - cw, Math.round(((sw - cw) * f.x) / 100))),
    top: Math.max(0, Math.min(sh - ch, Math.round(((sh - ch) * f.y) / 100))),
    width: cw,
    height: ch,
  };
}
