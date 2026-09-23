/* Where a cover photo is looked at — the one setting, and the one place that
   reads it.

   The complaint it answers (Renat, round 20 and again 18.09.2026, drawn on a
   screenshot of the blog editor): «возможность редактировать размер или
   двигать фото для обложки». One photo is shown in four frames of three
   different shapes — the list tile and the top of the article (1200×630), the
   social card the scraper asks for (a 518×518 square beside the title), and
   the one the build draws (a full-bleed 1200×630) — and until then the owner
   could choose nothing about any of them. The page fitted the picture in
   whole and left white bars at the sides; the social card cropped it with
   sharp's `attention` strategy, which is a guess at where the detail is and
   is where the halved faces came from.

   18.09.2026 answered it with ONE point for every frame. 23.09.2026 the owner
   asked for the next step: «рамки связаны — двигаешь одну, двигаются другие.
   Их надо двигать и настраивать ОТДЕЛЬНО, и чтобы можно было увеличить» —
   the three frames the editor shows («В списке статей», «В начале статьи»,
   «В соцсетях») each want their own framing, and a small face in a wide
   photo needs a closer look, not just a different spot. So each frame now
   has its own point AND its own zoom.

   The stored value is still one short string in one column, read and written
   here and nowhere else:

     fill 62 28   every frame at the point 62% across and 28% down, zoom 1 —
                  the only shape there was before 23.09.2026, and still what
                  is written whenever the three frames agree
     fill list 50 30 140 post 50 40 100 og 62.5 50 200
                  each frame on its own: x, y and the zoom in per cent
                  (100 = the frame just filled, CSS `cover`; up to 300).
                  x and y keep one decimal: at 3× a whole per cent of the
                  photo is a 15–28 px jump in the article's frame, which a
                  thumb can feel and a face can be cut by
     fit …        the same, with the two shop frames showing the photo whole
                  (their own rule in styles.css): their points and zooms are
                  kept for the day they are switched to `fill`; the social
                  square crops whatever the page does, so its own framing
                  steers it in both modes
     (absent)     every article written before 18.09.2026. The page fits the
                  picture whole and the social card goes on guessing with
                  `attention` — untouched, byte for byte.

   Why one string and not a column per number: the value travels as one
   token through every layer that already carries it — the row, both public
   routes, #blogdata/#blogpost, the build's export, the panel's draft and its
   «не сохранено» yardstick — so a frame setting cannot be dropped by a layer
   that forgot a new field, which is exactly how `data-fig` once went missing
   from every prerendered article. A point + zoom is also what every renderer
   below needs and nothing more.

   A closed vocabulary checked on the way in and on the way out, like
   `data-fig` in blog-cover's neighbour src/lib/blog-html.mjs: anything that
   is not one of the shapes above with numbers in range reads back as null,
   which is the same as absent, which is what every old post already is. The
   database states the same vocabulary as a check constraint
   (db/migrations/193_blog_cover_focus.sql, widened by 205_blog_cover_frames).

   Plain ESM (.mjs) for the reason blog-html.mjs and seo-head.mjs are: the
   prerender runs as a bare `node` script with no loader, and it draws covers
   too. The last reader, blogCoverFocus() and its neighbours in
   public/shop2/app.js, is a deliberate twin — a script the page loads without
   a build step cannot import this file — and tests/blog-cover.test.ts reads
   those functions out of app.js and runs them against these, so the twin
   cannot drift the way the sanitiser's did. */

/** The photo stands in the frame whole — what every cover did before this. */
export const COVER_FIT = "fit";
/** The photo fills the frame and is cropped around the point. */
export const COVER_FILL = "fill";
/** The three frames, in the order the long form stores them. */
export const COVER_FRAMES = ["list", "post", "og"];
/** 1 — the frame just filled edge to edge (CSS `cover`); 3 — the closest look. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
/**
 * Each frame's shape, width over height: the list tile and the top of the
 * article are 1200×630 (.blog__tileimg / .blog__cover in styles.css), the
 * social square is the 518×518 box src/lib/og-card.ts puts the photo in.
 */
export const COVER_SHAPE = { list: 1200 / 630, post: 1200 / 630, og: 1 };

const MODES = { fit: 1, fill: 1 };
const FOCUS_RE = /^(fit|fill)(?:\s+(\d{1,3}(?:\.\d)?)\s+(\d{1,3}(?:\.\d)?))?$/;
const FRAMES_RE =
  /^(fit|fill)\s+list\s+(\d{1,3}(?:\.\d)?)\s+(\d{1,3}(?:\.\d)?)\s+(\d{3})\s+post\s+(\d{1,3}(?:\.\d)?)\s+(\d{1,3}(?:\.\d)?)\s+(\d{3})\s+og\s+(\d{1,3}(?:\.\d)?)\s+(\d{1,3}(?:\.\d)?)\s+(\d{3})$/;

/** A position → 0…100, to a tenth. The same expression as the twin's in app.js. */
const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));
/** A zoom → the whole per cent the row holds, 100…300. */
const zoomPct = (z) => {
  const p = Math.round(Number(z) * 100);
  return p < ZOOM_MIN * 100 ? ZOOM_MIN * 100 : p > ZOOM_MAX * 100 ? ZOOM_MAX * 100 : p;
};

/**
 * The stored string → `{ fill, list, post, og }`, each frame `{ x, y, z }`
 * (x and y per cent of the photo, to a tenth; z the zoom as a multiplier), or null
 * for absent and for anything this vocabulary does not contain. A bare
 * `"fill"` means the centre; the short form puts every frame on its point at
 * zoom 1 — which is how an article framed before 23.09.2026 opens now.
 */
export function readCoverFocus(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  let m = FOCUS_RE.exec(s);
  if (m) {
    const x = m[2] === undefined ? 50 : Number(m[2]);
    const y = m[3] === undefined ? 50 : Number(m[3]);
    if (x > 100 || y > 100) return null;
    const out = { fill: m[1] === COVER_FILL };
    for (const k of COVER_FRAMES) out[k] = { x, y, z: 1 };
    return out;
  }
  m = FRAMES_RE.exec(s);
  if (!m) return null;
  const out = { fill: m[1] === COVER_FILL };
  for (let i = 0; i < COVER_FRAMES.length; i++) {
    const x = Number(m[2 + i * 3]);
    const y = Number(m[3 + i * 3]);
    const zp = Number(m[4 + i * 3]);
    if (x > 100 || y > 100 || zp < ZOOM_MIN * 100 || zp > ZOOM_MAX * 100) return null;
    out[COVER_FRAMES[i]] = { x, y, z: zp / 100 };
  }
  return out;
}

/**
 * Anything describing a cover's framing (or a string already in the
 * vocabulary) → the one shape that is stored, or null. This is what the
 * column holds and what a payload from the panel is measured against, so a
 * hand-written API call cannot put anything else in the row.
 *
 * Takes `{ fill | mode, list, post, og }` with a `{ x, y, z }` per frame, and
 * still the one-point `{ fill | mode, x, y }` an older panel sends. A frame
 * left out stands on the object's own x/y (or the centre) at zoom 1. When the
 * three frames agree and none is zoomed the short form is written — the
 * value an article framed before 23.09.2026 already holds, byte for byte.
 */
export function writeCoverFocus(value) {
  if (value == null || value === "") return null;
  let v = value;
  if (typeof v === "string") {
    v = readCoverFocus(v);
    if (!v) return null;
  }
  if (typeof v !== "object") return null;
  const mode = String(v.mode || (v.fill ? COVER_FILL : COVER_FIT)).toLowerCase();
  if (!MODES[mode]) return null;
  const hasFrames = COVER_FRAMES.some((k) => v[k] && typeof v[k] === "object");
  const baseX = v.x === undefined && hasFrames ? 50 : Number(v.x);
  const baseY = v.y === undefined && hasFrames ? 50 : Number(v.y);
  const frames = [];
  for (const k of COVER_FRAMES) {
    const f = v[k] && typeof v[k] === "object" ? v[k] : null;
    const x = f ? Number(f.x) : baseX;
    const y = f ? Number(f.y) : baseY;
    const z = f && f.z !== undefined ? Number(f.z) : 1;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    frames.push({ k, x: clampPct(x), y: clampPct(y), zp: zoomPct(z) });
  }
  const [a] = frames;
  if (frames.every((f) => f.x === a.x && f.y === a.y && f.zp === 100)) return `${mode} ${a.x} ${a.y}`;
  return mode + frames.map((f) => ` ${f.k} ${f.x} ${f.y} ${f.zp}`).join("");
}

/** One frame's `{ x, y, z }` out of a stored value (or a read one), or null. */
export function coverFrame(focus, where) {
  const f = typeof focus === "string" || focus == null ? readCoverFocus(focus) : focus;
  return (f && COVER_FRAMES.includes(where) && f[where]) || null;
}

/* ---------- what a frame does with it ------------------------------------
 *
 * Both CSS properties below place a picture the same way, and it is worth
 * naming because the sharp crops further down have to agree with it: a
 * position of `x%` lines the point x% ACROSS THE PICTURE up with the point x%
 * across the frame. Not «centre the point» — at 0% the left edge stays on the
 * left edge instead of being dragged into the middle and clamped back, which
 * is what makes dragging feel like moving the photo rather than fighting a
 * clamp at the ends.
 *
 * THE ZOOM keeps that same point where it is and makes the picture z times
 * bigger around it: `transform: scale(z)` with `transform-origin` on the
 * point. Scaling around the frame's own x%/y% leaves the photo's x%/y% on
 * it, so this is exactly «cover × z, positioned at x% y%» — the rule the
 * crop below writes out in pixels — without knowing the photo's size, which
 * no page that draws a cover does. The scaled element is cut back to its own
 * box by `clip-path: inset(…)`; the inset is worked out in the element's own
 * coordinates, before the scale (the clip is scaled with the element), which
 * is why it reads `x · (1 − 1/z)`. Nothing moves in the layout — a transform
 * and a clip change only what is painted — so the frame keeps its size on
 * every screen, and there is no jump when the picture arrives.
 *
 * Nothing is written at all when there is no focus, and for the shop's two
 * frames when the mode is `fit`: their own rules in styles.css already fit a
 * cover whole and centre it, and an inline style that merely repeats them
 * would be one more thing to keep in step with them. The social square is
 * the panel's own frame and crops always.
 */

const r3 = (n) => String(Math.round(n * 1000) / 1000);

/** `;transform:…;transform-origin:…;clip-path:…` for a zoomed frame, "" at zoom 1. */
function zoomCss(fr) {
  if (!(fr.z > 1)) return "";
  const k = 1 - 1 / fr.z;
  return (
    `;transform:scale(${fr.z});transform-origin:${fr.x}% ${fr.y}%` +
    `;clip-path:inset(${r3(fr.y * k)}% ${r3((100 - fr.x) * k)}% ${r3((100 - fr.y) * k)}% ${r3(fr.x * k)}%)`
  );
}

/** The frame's setting when that frame crops at all — null when it stands the photo whole. */
function cropping(focus, where) {
  const f = typeof focus === "string" || focus == null ? readCoverFocus(focus) : focus;
  if (!f || !COVER_FRAMES.includes(where)) return null;
  return where === "og" || f.fill ? f[where] : null;
}

/** The inline style for an `<img>` frame — the server-rendered and prerendered pages. */
export function coverImgStyle(focus, where) {
  const fr = cropping(focus, where);
  return fr ? `object-fit:cover;object-position:${fr.x}% ${fr.y}%` + zoomCss(fr) : "";
}

/** The same for the SPA's frames, which carry the picture as a background. */
export function coverBgStyle(focus, where) {
  const fr = cropping(focus, where);
  return fr ? `background-size:cover;background-position:${fr.x}% ${fr.y}%` + zoomCss(fr) : "";
}

/* ---------- the crops the social cards take ------------------------------ */

/** The largest `fw`:`fh` rect inside a `sw`×`sh` photo, in whole pixels. */
function fitRect(sw, sh, fw, fh) {
  let cw = sw;
  let ch = Math.round((sw * fh) / fw);
  if (ch > sh) {
    ch = sh;
    cw = Math.round((sh * fw) / fh);
  }
  return { cw: Math.max(1, Math.min(sw, cw)), ch: Math.max(1, Math.min(sh, ch)) };
}

function cropAt(sw, sh, fw, fh, fr, z) {
  const base = fitRect(sw, sh, fw, fh);
  const cw = Math.max(1, Math.min(sw, Math.round(base.cw / z)));
  const ch = Math.max(1, Math.min(sh, Math.round(base.ch / z)));
  return {
    left: Math.max(0, Math.min(sw - cw, Math.round(((sw - cw) * fr.x) / 100))),
    top: Math.max(0, Math.min(sh - ch, Math.round(((sh - ch) * fr.y) / 100))),
    width: cw,
    height: ch,
  };
}

function measure(w, h, frameW, frameH) {
  const sw = Math.floor(Number(w) || 0);
  const sh = Math.floor(Number(h) || 0);
  const fw = Number(frameW) || 0;
  const fh = Number(frameH) || 0;
  return sw < 1 || sh < 1 || fw <= 0 || fh <= 0 ? null : { sw, sh, fw, fh };
}

/**
 * The crop a `frameW`×`frameH` card takes of a `w`×`h` photo for the frame
 * `where`: the largest rect of the card's shape, made `z` times smaller by
 * that frame's zoom and placed by its point, by the same rule the two styles
 * above follow — so what the panel's frame shows and what the card keeps are
 * the same part of the photo. Integers, inside the photo by construction:
 * sharp's `extract()` throws on a rect that leaves the image.
 *
 * Returns null when there is nothing to go on (no focus, an unknown frame,
 * or dimensions sharp could not read), which is the caller's signal to
 * resize as it did before.
 */
export function focusCrop(w, h, frameW, frameH, focus, where) {
  const fr = coverFrame(focus, where);
  const d = measure(w, h, frameW, frameH);
  if (!fr || !d) return null;
  return cropAt(d.sw, d.sh, d.fw, d.fh, fr, fr.z);
}

/**
 * The crop a card of ANOTHER shape takes when it has to stand for the frame
 * `where` — the full-bleed 1200×630 card the build draws for an article
 * (tools/prerender-shop2.mjs) standing for the social square the owner framed
 * in the panel. The same point, and the zoom brought down only as far as it
 * takes for the wider rect to keep all of the square inside it: the part of
 * the photo the owner chose for social media is never cut off, and the wider
 * card shows as little more around it as its shape allows. Never below zoom 1
 * — a photo too narrow to hold the square at the card's shape gives the
 * card's widest rect, placed by the point, which is exactly the crop this
 * card took before frames had zooms (18.09.2026).
 *
 * Containment follows from the rule both crops share: two rects placed at
 * the same x%/y% nest whenever one is at least as large as the other along
 * that side.
 */
export function containingCrop(w, h, frameW, frameH, focus, where) {
  const fr = coverFrame(focus, where);
  const d = measure(w, h, frameW, frameH);
  if (!fr || !d) return null;
  const own = fitRect(d.sw, d.sh, COVER_SHAPE[where], 1);
  const card = fitRect(d.sw, d.sh, d.fw, d.fh);
  const z = Math.max(ZOOM_MIN, Math.min((fr.z * card.cw) / own.cw, (fr.z * card.ch) / own.ch));
  return cropAt(d.sw, d.sh, d.fw, d.fh, fr, z);
}
