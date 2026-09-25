/**
 * The cover's framing, and the frames that have to obey it.
 *
 * «возможность редактировать размер или двигать фото для обложки» — Renat,
 * round 20 and again 18.09.2026; and on 23.09.2026, the owner: «рамки
 * связаны — двигаешь одну, двигаются другие. Их надо двигать и настраивать
 * ОТДЕЛЬНО, и чтобы можно было увеличить». One photograph is drawn in three
 * frames the panel shows — the list tile and the top of the article
 * (1200×630) and the social square (518×518, src/lib/og-card.ts) — plus the
 * full-bleed 1200×630 card the build draws (tools/prerender-shop2.mjs). What
 * is stored is one string, `cover_focus`, holding a point and a zoom PER
 * FRAME; what this file guards is that each frame reads its own and only its
 * own, everywhere it is drawn.
 *
 * Five groups:
 *
 *  1. the vocabulary — what src/lib/blog-cover.mjs accepts, refuses, and
 *     writes back, and the check constraint that states the same thing to
 *     the database (db/migrations/205_blog_cover_frames.sql);
 *  2. the arithmetic — the CSS a frame wears and the rectangle a card cuts
 *     have to be the same part of the photo, and are checked against each
 *     other here, to a pixel, rather than each against a number;
 *  3. the twin. blogCoverFocus()/blogCoverWrite()/blogCoverBgStyle() in
 *     public/shop2/app.js are a deliberate third copy — the browser loads
 *     that file with no build step and cannot import the module — so they are
 *     sliced out by source text and run against it. This is the tripwire the
 *     sanitiser did not have: `data-fig` went missing from every prerendered
 *     article for a whole round because a second copy drifted and nothing
 *     compared them (see the header of src/lib/blog-html.mjs);
 *  4. the editor — the frames' markup, the thumb, two fingers, the slider,
 *     «Сбросить», the keys and the painter, each of them keyed to ONE frame;
 *  5. every renderer, by reading what it emits. A setting only the editor
 *     honours is worse than none.
 *
 * The database round trip, the social card's pixels and the request-time
 * page are in tests/blog-cover-frames.test.ts (they need PGlite and sharp).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COVER_FRAMES,
  containingCrop,
  coverBgStyle,
  coverFrame,
  coverImgStyle,
  focusCrop,
  readCoverFocus,
  writeCoverFocus,
} from "@/lib/blog-cover.mjs";

type Fr = { x: number; y: number; z: number };
type Focus = { fill: boolean; list: Fr; post: Fr; og: Fr };
type Where = "list" | "post" | "og";
type Rect = { left: number; top: number; width: number; height: number };

/** Each frame on its own: the list zoomed a little, the article as it was, the square close up. */
const LONG = "fill list 50 30 140 post 50 40 100 og 62.5 50 200";
const at = (x: number, y: number, z = 1): Fr => ({ x, y, z });
const all = (fr: Fr) => ({ list: fr, post: fr, og: fr });

/* ---------- 1. the vocabulary -------------------------------------------- */

describe("cover framing — what is stored", () => {
  it("reads the one-point form as all three frames on that point at zoom 1 — every article framed before 23.09.2026", () => {
    expect(readCoverFocus("fill 62 28")).toEqual({ fill: true, ...all(at(62, 28)) });
    expect(readCoverFocus("fit 0 100")).toEqual({ fill: false, ...all(at(0, 100)) });
  });

  it("reads each frame on its own: its point and its zoom", () => {
    expect(readCoverFocus(LONG)).toEqual({ fill: true, list: at(50, 30, 1.4), post: at(50, 40), og: at(62.5, 50, 2) });
    expect(readCoverFocus("fit list 0 0 300 post 100 100 100 og 33.3 66.7 150")).toEqual({
      fill: false, list: at(0, 0, 3), post: at(100, 100), og: at(33.3, 66.7, 1.5),
    });
  });

  it("takes a bare word as the centre", () => {
    expect(readCoverFocus("fill")).toEqual({ fill: true, ...all(at(50, 50)) });
    expect(readCoverFocus("fit")).toEqual({ fill: false, ...all(at(50, 50)) });
  });

  it("refuses everything outside the vocabulary — which reads as absent", () => {
    for (const bad of ["", null, undefined, "zoom 1 2", "fill 101 0", "fill 0 101", "fill -1 0",
      "fill 62", "fill 62 28 9", "cover", "fill,62,28", "<script>", "fill 62 28; drop table",
      "fill 62.25 28", "fill 100.5 0", "fill 62. 28",
      "fill list 50 30 099 post 50 40 100 og 62 50 200",      // zoomed out past «just filled»
      "fill list 50 30 301 post 50 40 100 og 62 50 200",      // past 3×
      "fill list 50 30 1.4 post 50 40 100 og 62 50 200",      // the zoom is per cent, not ×
      "fill list 50 30 140 post 50 40 100",                   // a frame missing
      "fill post 50 40 100 list 50 30 140 og 62 50 200",      // out of order
      "fill list 101 30 140 post 50 40 100 og 62 50 200",
      "fill list 50 30 140 post 50 40 100 og 62 50 200 hero 1 1 100",
      "fill hero 50 30 140 post 50 40 100 og 62 50 200"]) {
      expect(readCoverFocus(bad as string), String(bad)).toBeNull();
    }
  });

  it("normalises whatever the panel sends into the one shape the row holds", () => {
    expect(writeCoverFocus({ fill: true, x: 62.44, y: 27.46 })).toBe("fill 62.4 27.5");
    expect(writeCoverFocus({ fill: false, x: -20, y: 480 })).toBe("fit 0 100");
    expect(writeCoverFocus("FILL 62 28")).toBe("fill 62 28");
    expect(writeCoverFocus("fill")).toBe("fill 50 50");
    expect(writeCoverFocus({ fill: true, list: at(50, 30, 1.4), post: at(50, 40), og: at(62.5, 50, 2) })).toBe(LONG);
    expect(writeCoverFocus(LONG.toUpperCase())).toBe(LONG);
    // a zoom outside 1…3 is brought inside it, a position outside the photo onto its edge
    expect(writeCoverFocus({ fill: true, list: at(50, 30, 9), post: at(-5, 140, 0.2), og: at(62.5, 50, 2.004) }))
      .toBe("fill list 50 30 300 post 0 100 100 og 62.5 50 200");
  });

  it("writes the one-point form whenever the three frames agree and none is zoomed — an untouched article keeps its bytes", () => {
    expect(writeCoverFocus({ fill: true, ...all(at(62, 28)) })).toBe("fill 62 28");
    expect(writeCoverFocus("fill list 62 28 100 post 62 28 100 og 62 28 100")).toBe("fill 62 28");
    // …and the long form the moment one of them differs — by its point or only by its zoom
    expect(writeCoverFocus({ fill: true, list: at(62, 28), post: at(62, 28), og: at(62, 28, 1.05) }))
      .toBe("fill list 62 28 100 post 62 28 100 og 62 28 105");
    expect(writeCoverFocus({ fill: false, list: at(62, 28), post: at(62.1, 28), og: at(62, 28) }))
      .toBe("fit list 62 28 100 post 62.1 28 100 og 62 28 100");
  });

  it("round-trips: what is written reads back to the same framing and writes back to the same bytes", () => {
    for (const s of ["fill 62 28", "fit 0 100", "fill 33.3 0.5", LONG, "fit list 0 0 300 post 100 100 100 og 33.3 66.7 150"]) {
      expect(writeCoverFocus(readCoverFocus(s)), s).toBe(s);
    }
  });

  it("a frame left out of an object stands on the object's own point at zoom 1", () => {
    expect(writeCoverFocus({ fill: true, x: 10, y: 20, og: at(90, 20) })).toBe("fill list 10 20 100 post 10 20 100 og 90 20 100");
    expect(writeCoverFocus({ fill: true, og: at(90, 20, 2) })).toBe("fill list 50 50 100 post 50 50 100 og 90 20 200");
  });

  it("stores nothing for a value it does not know, so an old post stays an old post", () => {
    for (const bad of [null, undefined, "", "attention", { x: 1 }, { fill: true, x: NaN, y: 2 }, 7, { mode: "zoom", x: 1, y: 1 },
      { fill: true, list: { x: 1, y: NaN, z: 1 }, post: at(1, 1), og: at(1, 1) },
      { fill: true, list: at(1, 1), post: at(1, 1), og: { x: 1, y: 1, z: Infinity } }]) {
      expect(writeCoverFocus(bad as string), JSON.stringify(bad)).toBeNull();
    }
  });

  it("hands out one frame at a time, and nothing for a frame there is not", () => {
    expect(coverFrame(LONG, "og")).toEqual(at(62.5, 50, 2));
    expect(coverFrame("fit 7 9", "list")).toEqual(at(7, 9));
    expect(coverFrame(LONG, "hero")).toBeNull();
    expect(coverFrame(null, "og")).toBeNull();
    expect(COVER_FRAMES).toEqual(["list", "post", "og"]);
  });
});

/* The database says the same thing as readCoverFocus(), or a value the panel
   can produce is refused at save and the owner loses his framing to a 500. */
describe("the check constraint in db/migrations/205_blog_cover_frames.sql", () => {
  const sql = (f: string) => readFileSync(fileURLToPath(new URL(`../db/migrations/${f}`, import.meta.url)), "utf8");
  const c205 = (() => {
    const m = /cover_focus ~ '\^(.+)\$'/.exec(sql("205_blog_cover_frames.sql"));
    if (!m) throw new Error("205_blog_cover_frames.sql no longer states the vocabulary");
    return new RegExp("^" + m[1] + "$");
  })();
  const c193 = (() => {
    const m = /cover_focus ~ '\^([^']+)\$'/.exec(sql("193_blog_cover_focus.sql"));
    return new RegExp("^" + (m as RegExpExecArray)[1] + "$");
  })();

  it("allows every value the writer can produce", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pos = () => [0, 100, 50, rnd() * 100, rnd() * 120 - 10][Math.floor(rnd() * 5)];
    const zoom = () => [1, 3, 1 + rnd() * 2, 1.05, rnd() * 4][Math.floor(rnd() * 5)];
    for (let i = 0; i < 2000; i++) {
      const v = {
        fill: rnd() < 0.5,
        list: at(pos(), pos(), zoom()), post: at(pos(), pos(), zoom()), og: at(pos(), pos(), zoom()),
      };
      const w = writeCoverFocus(i % 7 ? v : { fill: v.fill, x: pos(), y: pos() }) as string;
      expect(c205.test(w), w).toBe(true);
      expect(writeCoverFocus(w), w).toBe(w);
    }
  });

  it("still allows everything 193 allowed — no row that exists today is broken by it", () => {
    for (const old of ["fit 50 50", "fill 0 0", "fill 100 100", "fit 7 99", "fill 62 28"]) {
      expect(c193.test(old), old).toBe(true);
      expect(c205.test(old), old).toBe(true);
    }
  });

  it("refuses what the reader refuses", () => {
    for (const bad of ["fill 101 0", "zoom 1 2", "fill 62", "FILL 62 28", "fill  62 28", "fill 05 28", "fill 62.25 28",
      "fill 100.5 0", "fill list 50 30 099 post 50 40 100 og 62 50 200", "fill list 50 30 301 post 50 40 100 og 62 50 200",
      "fill list 50 30 140 post 50 40 100", "fill post 50 40 100 list 50 30 140 og 62 50 200"]) {
      expect(c205.test(bad), bad).toBe(false);
    }
  });
});

/* ---------- 2. the arithmetic -------------------------------------------- */

describe("the style a frame wears", () => {
  it("crops each frame by its own point, and zooms only the frame that was zoomed", () => {
    expect(coverImgStyle("fill 62 28", "post")).toBe("object-fit:cover;object-position:62% 28%");
    expect(coverBgStyle("fill 62 28", "list")).toBe("background-size:cover;background-position:62% 28%");
    expect(coverBgStyle(LONG, "post")).toBe("background-size:cover;background-position:50% 40%");
    expect(coverImgStyle(LONG, "list")).toBe(
      "object-fit:cover;object-position:50% 30%;transform:scale(1.4);transform-origin:50% 30%;clip-path:inset(8.571% 14.286% 20% 14.286%)",
    );
    expect(coverBgStyle(LONG, "og")).toBe(
      "background-size:cover;background-position:62.5% 50%;transform:scale(2);transform-origin:62.5% 50%;clip-path:inset(25% 18.75% 25% 31.25%)",
    );
  });

  it("writes nothing for the shop's frames when the picture stands whole — the stylesheet already says so", () => {
    for (const f of ["fit 62 28", "fit 50 50", "", null, "nonsense", "fit list 50 30 140 post 50 40 300 og 62.5 50 200"]) {
      for (const where of ["list", "post"]) {
        expect(coverImgStyle(f as string, where), `${f} ${where}`).toBe("");
        expect(coverBgStyle(f as string, where), `${f} ${where}`).toBe("");
      }
    }
  });

  it("the social square crops whatever the page does", () => {
    expect(coverBgStyle("fit 62 28", "og")).toBe("background-size:cover;background-position:62% 28%");
    expect(coverBgStyle("fit list 50 30 140 post 50 40 100 og 62.5 50 200", "og")).toContain("transform:scale(2)");
  });

  it("writes nothing for a frame it does not know", () => {
    expect(coverImgStyle(LONG, "hero")).toBe("");
    expect(coverBgStyle(LONG, undefined)).toBe("");
  });
});

/** The four numbers of a zoom out of a style: scale, origin and the clip. */
function zoomOf(css: string) {
  const m = /transform:scale\(([\d.]+)\);transform-origin:([\d.]+)% ([\d.]+)%;clip-path:inset\(([\d.]+)% ([\d.]+)% ([\d.]+)% ([\d.]+)%\)/.exec(css);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return { z: n[0], ox: n[1], oy: n[2], top: n[3], right: n[4], bottom: n[5], left: n[6] };
}

/** What the browser shows of a `w`×`h` photo in a `W`×`H` frame wearing `css`,
    in the photo's own pixels: `cover`, placed by background-position, then
    the transform scaling it around its origin — the CSS rule written out. */
function cssVisible(w: number, h: number, W: number, H: number, css: string): Rect {
  const s0 = Math.max(W / w, H / h);
  const pos = /background-position:([\d.]+)% ([\d.]+)%/.exec(css) as RegExpExecArray;
  let offX = ((W - w * s0) * Number(pos[1])) / 100;
  let offY = ((H - h * s0) * Number(pos[2])) / 100;
  let scale = s0;
  const zm = zoomOf(css);
  if (zm) {
    const ox = (zm.ox / 100) * W, oy = (zm.oy / 100) * H;
    offX = ox + zm.z * (offX - ox);
    offY = oy + zm.z * (offY - oy);
    scale *= zm.z;
  }
  return { left: -offX / scale, top: -offY / scale, width: W / scale, height: H / scale };
}

const PHOTOS: Array<[number, number]> = [[1600, 1200], [1500, 1000], [1920, 1080], [1200, 630], [800, 1200], [3000, 1000], [1000, 1000], [4032, 3024]];
const FRAMINGS = [
  "fill 62 28", "fill 0 100", LONG,
  "fill list 0 0 300 post 100 100 250 og 12.5 87.5 105",
  "fill list 100 0 105 post 0 100 300 og 50 50 300",
  "fill list 33.3 66.7 170 post 81.2 4.9 133 og 99.9 0.1 299",
];

describe("the zoom keeps the frame's own box", () => {
  /* The clip is worked out in the element's own coordinates and then scaled
     with it (CSS Masking: a clip-path is transformed with its element). A
     local point u lands on screen at o + z·(u − o); the four edges of the
     inset have to land exactly on the four edges of the frame, or a zoomed
     cover either spills over the title under it or leaves a white line. */
  it("the clip lands on the frame's edges, whatever the point and the zoom", () => {
    for (const x of [0, 12.5, 50, 87.3, 100]) {
      for (const y of [0, 33.3, 50, 100]) {
        for (const z of [1.05, 1.4, 2, 2.95, 3]) {
          const css = coverBgStyle(writeCoverFocus({ fill: true, ...all(at(x, y, z)) }), "post");
          const zm = zoomOf(css);
          expect(zm, css).not.toBeNull();
          const q = zm as NonNullable<typeof zm>;
          const land = (u: number, o: number) => o + q.z * (u - o);
          expect(land(q.left, q.ox), css).toBeCloseTo(0, 2);
          expect(land(100 - q.right, q.ox), css).toBeCloseTo(100, 2);
          expect(land(q.top, q.oy), css).toBeCloseTo(0, 2);
          expect(land(100 - q.bottom, q.oy), css).toBeCloseTo(100, 2);
        }
      }
    }
  });

  it("at zoom 1 there is no transform at all — a frame nobody zoomed wears what it wore before", () => {
    expect(coverBgStyle("fill 62 28", "post")).not.toContain("transform");
    expect(coverImgStyle(LONG, "post")).not.toContain("clip-path");
  });
});

describe("what a frame shows is what a card cuts — the CSS and the crop agree to a pixel", () => {
  /* The two halves are written in two different languages — CSS in the
     browser, sharp's extract() on the server — and the only way the social
     card can look like the square the owner framed is for both to be the
     same arithmetic. So they are held to each other, not to numbers. */
  it("for every frame, photo and framing", () => {
    const shapes: Array<[Where, number, number]> = [["list", 1200, 630], ["post", 760, 399], ["og", 518, 518]];
    for (const [w, h] of PHOTOS) {
      for (const [where, W, H] of shapes) {
        for (const f of FRAMINGS) {
          const css = coverBgStyle(f, where);
          const want = cssVisible(w, h, W, H, css);
          const got = focusCrop(w, h, W, H, f, where) as Rect;
          const tag = `${w}×${h} ${where} ${f}`;
          expect(Math.abs(got.left - want.left), tag).toBeLessThanOrEqual(1.01);
          expect(Math.abs(got.top - want.top), tag).toBeLessThanOrEqual(1.01);
          expect(Math.abs(got.width - want.width), tag).toBeLessThanOrEqual(1.01);
          expect(Math.abs(got.height - want.height), tag).toBeLessThanOrEqual(1.01);
        }
      }
    }
  });
});

describe("the rectangle a social card keeps", () => {
  /* The rule the two sharp crops have to obey, because it is the rule CSS
     obeys: x% ACROSS THE PICTURE lines up with x% across the frame. At 0 the
     left edge stays on the left edge — not «centre the point, then clamp». */
  it("places the crop the way background-position does", () => {
    // a 2000×1000 photo into a square: 1000 wide, 1000 of slack across
    expect(focusCrop(2000, 1000, 1, 1, "fill 0 50", "og")).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
    expect(focusCrop(2000, 1000, 1, 1, "fill 100 50", "og")).toEqual({ left: 1000, top: 0, width: 1000, height: 1000 });
    expect(focusCrop(2000, 1000, 1, 1, "fill 50 50", "og")).toEqual({ left: 500, top: 0, width: 1000, height: 1000 });
    expect(focusCrop(2000, 1000, 1, 1, "fill 30 50", "og")).toEqual({ left: 300, top: 0, width: 1000, height: 1000 });
  });

  it("crops down the other axis for a tall photo", () => {
    // 1000×2000 into 1200×630: the width is the limit, 525 tall, 1475 of slack
    expect(focusCrop(1000, 2000, 1200, 630, "fill 50 0", "post")).toEqual({ left: 0, top: 0, width: 1000, height: 525 });
    expect(focusCrop(1000, 2000, 1200, 630, "fill 50 100", "post")).toEqual({ left: 0, top: 1475, width: 1000, height: 525 });
  });

  it("zooms in around the frame's own point — z times smaller, placed by the same rule", () => {
    const sq = (og: string) => `fill list 50 50 100 post 50 50 100 og ${og}`;
    expect(focusCrop(2000, 1000, 1, 1, sq("0 0 200"), "og")).toEqual({ left: 0, top: 0, width: 500, height: 500 });
    expect(focusCrop(2000, 1000, 1, 1, sq("100 100 200"), "og")).toEqual({ left: 1500, top: 500, width: 500, height: 500 });
    expect(focusCrop(2000, 1000, 1, 1, sq("50 50 300"), "og")).toEqual({ left: 834, top: 334, width: 333, height: 333 });
  });

  it("each frame is cut by its own setting — the list's zoom never reaches the square", () => {
    const f = "fill list 10 10 300 post 90 90 100 og 50 50 100";
    expect(focusCrop(2000, 1000, 1, 1, f, "og")).toEqual({ left: 500, top: 0, width: 1000, height: 1000 });
    // 1905×1000 is the widest 1200:630 rect in it; a third of that, a tenth of the way in
    expect(focusCrop(2000, 1000, 1200, 630, f, "list")).toEqual(
      { left: Math.round((2000 - 635) * 0.1), top: Math.round((1000 - 333) * 0.1), width: 635, height: 333 });
  });

  it("never leaves the picture — sharp's extract() throws on a rect that does", () => {
    for (const [w, h] of [[1200, 630], [630, 1200], [1, 1], [4001, 17], [2, 5000], [3, 3]]) {
      for (const p of ["fill 0 0", "fill 100 100", "fill 50 50", "fit 100 0", ...FRAMINGS]) {
        for (const where of ["list", "post", "og"] as const) {
          for (const crop of [focusCrop, containingCrop]) {
            const r = crop(w, h, 518, 518, p, where);
            expect(r, `${w}x${h} ${p} ${where}`).not.toBeNull();
            const rect = r as Rect;
            expect(rect.left).toBeGreaterThanOrEqual(0);
            expect(rect.top).toBeGreaterThanOrEqual(0);
            expect(rect.width).toBeGreaterThan(0);
            expect(rect.height).toBeGreaterThan(0);
            expect(rect.left + rect.width).toBeLessThanOrEqual(w);
            expect(rect.top + rect.height).toBeLessThanOrEqual(h);
            expect(Number.isInteger(rect.left + rect.top + rect.width + rect.height)).toBe(true);
          }
        }
      }
    }
  });

  it("gives the caller nothing when there is no point, no such frame, or no photograph to measure", () => {
    for (const crop of [focusCrop, containingCrop]) {
      expect(crop(1200, 630, 518, 518, null, "og")).toBeNull();
      expect(crop(1200, 630, 518, 518, "", "og")).toBeNull();
      expect(crop(1200, 630, 518, 518, "fill 50 50", "hero")).toBeNull();
      expect(crop(1200, 630, 518, 518, "fill 50 50", undefined)).toBeNull();
      expect(crop(undefined, undefined, 518, 518, "fill 50 50", "og")).toBeNull();
      expect(crop(0, 0, 518, 518, "fill 50 50", "og")).toBeNull();
    }
  });

  /* `fit` is the page's business, never the card's: the card crops whatever
     the page does, so the point has to work out a rectangle either way. */
  it("crops for `fit` too, because a social card has no other choice", () => {
    expect(focusCrop(2000, 1000, 1, 1, "fit 100 50", "og")).toEqual({ left: 1000, top: 0, width: 1000, height: 1000 });
  });
});

describe("the build's wide card keeps all of the square the owner framed", () => {
  it("at zoom 1 it is exactly the crop that card took before frames had a zoom", () => {
    for (const [w, h] of PHOTOS) {
      for (const p of ["fill 62 28", "fit 0 100", "fill 50 50", "fill 100 0"]) {
        expect(containingCrop(w, h, 1200, 630, p, "og"), `${w}×${h} ${p}`).toEqual(focusCrop(w, h, 1200, 630, p, "og"));
      }
    }
  });

  it("zoomed: the square's crop lies inside it, and it is no bigger than it has to be", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [w, h] of PHOTOS) {
      for (let i = 0; i < 150; i++) {
        const og = at(Math.round(rnd() * 1000) / 10, Math.round(rnd() * 1000) / 10, 1 + Math.round(rnd() * 200) / 100);
        const f = writeCoverFocus({ fill: true, list: at(50, 50), post: at(50, 50), og }) as string;
        const sq = focusCrop(w, h, 518, 518, f, "og") as Rect;
        const wide = containingCrop(w, h, 1200, 630, f, "og") as Rect;
        const tag = `${w}×${h} ${f}`;
        const base = focusCrop(w, h, 1200, 630, "fill 50 50", "og") as Rect;
        if (base.height >= sq.height) {
          // room for the whole square: it is inside, to the rounding of a pixel
          expect(wide.left, tag).toBeLessThanOrEqual(sq.left + 1);
          expect(wide.top, tag).toBeLessThanOrEqual(sq.top + 1);
          expect(wide.left + wide.width, tag).toBeGreaterThanOrEqual(sq.left + sq.width - 1);
          expect(wide.top + wide.height, tag).toBeGreaterThanOrEqual(sq.top + sq.height - 1);
          // …and tight: the square touches it top and bottom
          expect(wide.height - sq.height, tag).toBeLessThanOrEqual(2);
        } else {
          // a photo too narrow to hold the square at 1200×630: the card's widest rect, as before
          expect(wide, tag).toEqual(focusCrop(w, h, 1200, 630, writeCoverFocus({ fill: true, ...all(at(og.x, og.y)) }), "og"));
        }
        expect(Math.abs(wide.width / wide.height - 1200 / 630), tag).toBeLessThan(0.02);
      }
    }
  });
});

/* ---------- 3. the deliberate twin in public/shop2/app.js ---------------- */

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const app = readFileSync(APP_JS, "utf8");

/** `function <name>(…) { … }` out of app.js, by brace matching. */
function slice(name: string): string {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
/** `var <name> = …;` — a table or a regex the functions read. */
function sliceVar(name: string): string {
  const start = app.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const end = app.indexOf(";", start);
  if (end < 0) throw new Error(`no terminating ; for var ${name} in app.js`);
  return app.slice(start, end + 1);
}
const VOCAB = () =>
  `${sliceVar("COVER_FRAMES")} ${sliceVar("BLOG_FOCUS_RX")} ${sliceVar("BLOG_FRAMES_RX")}
   ${slice("blogCoverFocus")} ${slice("blogCoverWrite")} ${slice("blogCoverSet")}
   ${slice("blogCoverZoomCss")} ${slice("blogCoverBgStyle")}`;

const twin = new Function(
  `${VOCAB()} return { blogCoverFocus: blogCoverFocus, blogCoverWrite: blogCoverWrite, blogCoverSet: blogCoverSet, blogCoverBgStyle: blogCoverBgStyle };`,
)() as {
  blogCoverFocus: (raw: unknown) => Focus | null;
  blogCoverWrite: (fill: boolean, frames: Partial<Record<Where, Fr>> | null) => string;
  blogCoverSet: (raw: string, where: string, patch: Partial<Fr>) => string;
  blogCoverBgStyle: (focus: unknown, where?: string) => string;
};

/* Everything a cover could plausibly be asked to hold, including what a
   hand-written API call or an older row might put there. */
const CORPUS = [
  "fill 62 28", "fit 62 28", "fill", "fit", "fill 0 0", "fill 100 100", "fit 0 100", "fill 33.3 0.5",
  "FILL 62 28", "  fill 62 28  ", "fill  62  28", ...FRAMINGS, LONG.toUpperCase(), "fit list 0 0 300 post 100 100 100 og 33.3 66.7 150",
  "", "   ", "zoom 1 2", "cover", "fill 101 0", "fill 0 101", "fill -1 0", "fill 62", "fill 62.25 28",
  "fill 62 28 9", "fill,62,28", "attention", "<script>", "fill 62 28; drop table posts",
  "fill list 50 30 099 post 50 40 100 og 62 50 200", "fill list 50 30 140 post 50 40 100",
  null, undefined,
];

describe("the twin in app.js reads the same value as src/lib/blog-cover.mjs", () => {
  it("agrees on every shape a stored value could take", () => {
    for (const raw of CORPUS) {
      expect(twin.blogCoverFocus(raw), String(raw)).toEqual(readCoverFocus(raw as string));
    }
  });

  it("agrees on the style every frame wears", () => {
    for (const raw of CORPUS) {
      for (const where of ["list", "post", "og", "hero"]) {
        expect(twin.blogCoverBgStyle(raw, where), `${raw} ${where}`).toBe(coverBgStyle(raw as string, where));
      }
    }
  });

  it("writes back exactly what the row will hold, so a drag, a pinch and a slide survive a save", () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1000; i++) {
      const fill = rnd() < 0.5;
      const fr = () => at(rnd() * 120 - 10, rnd() * 120 - 10, i % 3 ? 1 : 0.5 + rnd() * 3);
      const frames = i % 5 ? { list: fr(), post: fr(), og: fr() } : all(at(Math.round(rnd() * 100), 40));
      const written = twin.blogCoverWrite(fill, frames);
      expect(writeCoverFocus(written), written).toBe(written);
      expect(writeCoverFocus({ fill, ...frames }), written).toBe(written);
    }
  });

  it("changes one frame and leaves the other two exactly as they were", () => {
    expect(twin.blogCoverFocus(twin.blogCoverSet(LONG, "post", { x: 10 }))).toEqual(
      { fill: true, list: at(50, 30, 1.4), post: at(10, 40), og: at(62.5, 50, 2) });
    expect(twin.blogCoverFocus(twin.blogCoverSet(LONG, "og", { z: 1 }))).toEqual(
      { fill: true, list: at(50, 30, 1.4), post: at(50, 40), og: at(62.5, 50) });
    // a one-point value: the other two keep that point — the legacy start of all three
    expect(twin.blogCoverFocus(twin.blogCoverSet("fill 62 28", "list", { z: 2 }))).toEqual(
      { fill: true, list: at(62, 28, 2), post: at(62, 28), og: at(62, 28) });
    // nothing chosen: the centre, and the page standing as it does («fit»)
    expect(twin.blogCoverSet("", "og", { x: 100 })).toBe("fit list 50 50 100 post 50 50 100 og 100 50 100");
    // …and a frame there is not changes nothing
    expect(twin.blogCoverSet(LONG, "hero", { x: 1 })).toBe(LONG);
  });
});

/* ---------- 4. the editor ------------------------------------------------ */

/** One `if (…) { … }` branch of a dispatcher, on its own. */
function sliceBranch(head: string): string {
  const start = app.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has the branch «${head}»`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in the branch «${head}»`);
}

type Dims = { w: number; h: number } | null;
const STILL = "Фото помещается целиком — двигать нечего.";

describe("the three frames in the editor — each one its own", () => {
  /** The three frames admBlogSeeHTML() draws for a photo of this shape, one string each. */
  function frames(dims: Dims, focus: string, lang = "RU"): Record<Where, string> & { all: string } {
    const run = new Function(
      "blogCoverDims", "blogCoverFrameHTML", "esc", "S",
      `${VOCAB()} ${sliceVar("COVER_WIDE")} ${sliceVar("COVER_SHAPE")}
       ${sliceVar("BLOG_COVER_FILL_NOTE")} ${sliceVar("BLOG_COVER_OG_NOTE")} ${sliceVar("BLOG_COVER_OG_GUESS")} ${sliceVar("BLOG_COVER_STILL")}
       ${slice("blogCoverAxis")} ${slice("blogCoverMode")} ${slice("blogCoverZoomText")} ${slice("blogCoverHome")}
       ${slice("admBlogZoomHTML")} ${slice("admBlogSeeHTML")}
       return admBlogSeeHTML("/c.jpg", "Обложка", arguments[4]);`,
    ) as (...a: unknown[]) => string;
    const html = run(
      () => dims,
      // the shop's frame, with the style it was handed — enough to see which frame's setting it got
      (where: string, _u: string, _a: string, f: unknown) =>
        `<span class="${where === "list" ? "blog__tileimg" : "blog__cover"}" data-css="${twin.blogCoverBgStyle(f, where)}"></span>`,
      (s: string) => s,
      { lang },
      focus,
    );
    const part = (where: string) => {
      const at0 = html.indexOf(`adm-see__one--${where}"`);
      const next = html.indexOf("adm-see__one--", at0 + 1);
      return html.slice(at0, next < 0 ? html.indexOf('adm-see__note"') : next);
    };
    return { list: part("list"), post: part("post"), og: part("og"), all: html };
  }
  const attr = (html: string, name: string) => (new RegExp(`${name}="([^"]*)"`).exec(html) || [])[1];
  const stillShown = (html: string) => /adm-see__still">/.test(html);

  it("every frame is keyed by its own name, and so are its slider and its «Сбросить»", () => {
    const f = frames({ w: 1600, h: 1200 }, LONG);
    for (const where of ["list", "post", "og"] as const) {
      expect(attr(f[where], "data-coverframe"), where).toBe(where);
      expect(attr(f[where], "data-coverzoom"), where).toBe(where);
      expect(attr(f[where], "data-coverreset"), where).toBe(where);
      expect(attr(f[where], "data-coverzoomval"), where).toBe(where);
    }
    // each slider stands at its own frame's zoom
    expect(f.list).toContain('value="140"');
    expect(f.post).toContain('value="100"');
    expect(f.og).toContain('value="200"');
    expect(f.list).toContain(">1,4×<");
    expect(f.og).toContain(">2×<");
    expect(frames({ w: 1600, h: 1200 }, LONG, "EN").list).toContain(">1.4×<");
  });

  it("each frame draws its own crop: the list's zoom is on the list and nowhere else", () => {
    const f = frames({ w: 1600, h: 1200 }, LONG);
    expect(attr(f.list, "data-css")).toBe(coverBgStyle(LONG, "list"));
    expect(attr(f.post, "data-css")).toBe(coverBgStyle(LONG, "post"));
    expect(f.post).not.toContain("scale(");
    expect(f.og).toContain(coverBgStyle(LONG, "og"));
  });

  it("«Сбросить» is there to press only under a frame somebody moved", () => {
    const f = frames({ w: 1600, h: 1200 }, "fill list 50 50 100 post 50 50 100 og 20 50 100");
    expect(f.list).toMatch(/data-coverreset="list" disabled>/);
    expect(f.post).toMatch(/data-coverreset="post" disabled>/);
    expect(f.og).toMatch(/data-coverreset="og">/);
  });

  it("a 1200×630 photo at zoom 1: the shop frames say there is nothing to move, and take a zoom", () => {
    const f = frames({ w: 1200, h: 630 }, "fill 50 50");
    for (const where of ["list", "post"] as const) {
      expect(attr(f[where], "data-coverdrag"), where).toBe("");
      expect(stillShown(f[where]), where).toBe(true);
      expect(f[where], where).toContain(STILL);
      expect(f[where], where).toContain("data-coverzoom");
    }
    expect(attr(f.og, "data-coverdrag")).toBe("x");
    expect(stillShown(f.og)).toBe(false);
  });

  it("…and once one of them is zoomed it crops every side and moves both ways — that one only", () => {
    const f = frames({ w: 1200, h: 630 }, "fill list 50 50 150 post 50 50 100 og 50 50 100");
    expect(attr(f.list, "data-coverdrag")).toBe("xy");
    expect(stillShown(f.list)).toBe(false);
    expect(attr(f.post, "data-coverdrag")).toBe("");
    expect(stillShown(f.post)).toBe(true);
  });

  it("a 4:3 photo: the shop frames move it up and down, the square sideways", () => {
    const f = frames({ w: 1600, h: 1200 }, "fill 50 50");
    expect(attr(f.list, "data-coverdrag")).toBe("y");
    expect(attr(f.post, "data-coverdrag")).toBe("y");
    expect(attr(f.og, "data-coverdrag")).toBe("x");
    expect(f.all).not.toMatch(/adm-see__still">/);
  });

  it("«Вся фотография»: the shop frames take nothing — no thumb, no zoom, no excuse; the square still does", () => {
    const f = frames({ w: 1200, h: 630 }, "fit list 50 50 200 post 50 50 100 og 50 50 100");
    for (const where of ["list", "post"] as const) {
      expect(f[where], where).not.toContain("data-coverdrag");
      expect(f[where], where).not.toContain("data-coverzoom");
      expect(f[where], where).not.toContain(STILL);
      // the stored zoom is kept for «Заполнить рамку», but the page shows the photo whole
      expect(attr(f[where], "data-css"), where).toBe("");
    }
    expect(attr(f.og, "data-coverdrag")).toBe("x");
    expect(f.og).toContain("data-coverzoom");
  });

  it("a square photo: the square has nothing to cut at zoom 1, and the line about its crop goes too", () => {
    const f = frames({ w: 1000, h: 1000 }, "fill 50 50");
    expect(attr(f.og, "data-coverdrag")).toBe("");
    expect(stillShown(f.og)).toBe(true);
    expect(f.all).toMatch(/data-covernote hidden>/);
    expect(attr(f.post, "data-coverdrag")).toBe("y");
    // zoomed in, it crops — and says so
    const z = frames({ w: 1000, h: 1000 }, "fill list 50 50 100 post 50 50 100 og 50 50 180");
    expect(attr(z.og, "data-coverdrag")).toBe("xy");
    expect(z.all).toMatch(/data-covernote>/);
  });

  it("before the photograph is measured every frame that crops moves both ways, as it did", () => {
    const f = frames(null, "fill 50 50");
    for (const where of ["list", "post", "og"] as const) expect(attr(f[where], "data-coverdrag"), where).toBe("xy");
    expect(f.all).not.toMatch(/adm-see__still">/);
  });

  it("the note under the frames says each one is set on its own", () => {
    expect(frames(null, "fill 50 50").all).toContain(
      "Каждая рамка настраивается отдельно: потяните фото пальцем, чтобы выбрать, что останется видно, и увеличьте его ползунком под рамкой.");
  });
});

/* A thumb, two fingers and the keys, through the handlers themselves —
   coverPointerDown/Move/End and coverKey sliced out of app.js with the
   state they share, the element they are given standing in for the frame. */
function gestures(start: string, dims?: Dims) {
  const d = { coverFocus: start, coverUrl: "/c.jpg" };
  let paints = 0;
  const api = new Function(
    "S", "COVER_DIMS", "admBlogPaintCover", "blogPaintState", "admBlogRepaintSee",
    `var COVER_REPAINT_DUE = false; var COVERDRAG = null;
     ${VOCAB()} ${sliceVar("COVER_KEY_STEP")} ${sliceVar("COVER_KEY_ZOOM")}
     ${slice("blogCoverSlack")} ${slice("coverDragBase")} ${slice("coverDragTo")} ${slice("coverPinchDist")} ${slice("coverPinchTo")}
     ${slice("coverPointerDown")} ${slice("coverPointerMove")} ${slice("coverDragEnd")} ${slice("coverKey")}
     return { down: coverPointerDown, move: coverPointerMove, up: coverDragEnd, key: coverKey,
       gesture: function () { return COVERDRAG; } };`,
  )({ adminBlogEdit: d }, { "/c.jpg": dims || undefined }, () => { paints++; }, () => {}, () => {}) as {
    down: (e: unknown) => void; move: (e: unknown) => void; up: (e: unknown) => void; key: (e: unknown) => void;
    gesture: () => unknown;
  };
  /** A frame on screen: its box carries the name, the element the ways it moves. */
  const frame = (where: string, drag: string, w: number, h: number) => {
    const box = { getAttribute: (n: string) => (n === "data-coverframe" ? where : null) };
    const el = {
      attrs: { "data-coverdrag": drag } as Record<string, string>,
      clientWidth: w, clientHeight: h,
      getAttribute(n: string) { return n in this.attrs ? this.attrs[n] : null; },
      closest(sel: string) { return sel === "[data-coverdrag]" ? el : sel === "[data-coverframe]" ? box : null; },
      setPointerCapture() {},
    };
    return el;
  };
  const ev = (el: unknown, id: number, x: number, y: number) => ({ target: el, pointerId: id, clientX: x, clientY: y, preventDefault() {} });
  const now = () => readCoverFocus(d.coverFocus) as Focus;
  /** One finger down at (500, 500), moved by (dx, dy), lifted. */
  const drag = (el: unknown, dx: number, dy: number) => {
    api.down(ev(el, 1, 500, 500));
    api.move(ev(el, 1, 500 + dx, 500 + dy));
    api.up(ev(el, 1, 500 + dx, 500 + dy));
    return now();
  };
  return { d, api, frame, ev, now, drag, paints: () => paints };
}

describe("dragging — a frame moves its own point, and only its own", () => {
  it("a drag on «В начале статьи» moves the article's point; the list and the square stay where they were", () => {
    const g = gestures(LONG, null);
    const after = g.drag(g.frame("post", "xy", 400, 210), 0, -105);
    expect(after.post).toEqual(at(50, 40 + 50 / 1)); // one frame's height (unmeasured) is the whole way; half of it, half
    expect(after.list).toEqual(at(50, 30, 1.4));
    expect(after.og).toEqual(at(62.5, 50, 2));
  });

  it("an article framed before today: the drag splits the frames, the other two keep the old point", () => {
    const g = gestures("fill 62 28", { w: 1600, h: 1200 });
    const after = g.drag(g.frame("list", "y", 400, 210), 0, 30);
    expect(after.list.y).toBeLessThan(28);
    expect(after.post).toEqual(at(62, 28));
    expect(after.og).toEqual(at(62, 28));
    expect(g.d.coverFocus).toMatch(/^fill list 62 [\d.]+ 100 post 62 28 100 og 62 28 100$/);
  });

  it("the picture sticks to the finger: it travels as far as the finger until an edge meets the frame", () => {
    // a 4:3 photo in a 400×210 frame fills it 400×300: 90 px of it hidden, top and bottom together
    const g = gestures("fill 50 50", { w: 1600, h: 1200 });
    const el = g.frame("post", "y", 400, 210);
    expect(g.drag(el, 0, -45).post.y).toBe(100);      // up by half of 90: from the middle to the bottom edge
    g.d.coverFocus = "fill 50 50";
    expect(g.drag(el, 0, 9).post.y).toBe(40);          // down 9 px = a tenth of the way
    g.d.coverFocus = "fill 50 50";
    expect(g.drag(el, 0, -9999).post.y).toBe(100);     // and it stops at the edge
  });

  it("zoomed in there is further to travel, so a pixel of finger is less of the photo", () => {
    // at 2× the same photo is 800×600 in the frame: 400 hidden across, 390 down
    const g = gestures("fill list 50 50 100 post 50 50 200 og 50 50 100", { w: 1600, h: 1200 });
    const after = g.drag(g.frame("post", "xy", 400, 210), -40, 39);
    expect(after.post).toEqual(at(60, 40, 2));
  });

  it("at zoom 1 a frame moves only along the side it crops; «still» moves nowhere", () => {
    const g = gestures("fill 50 50", { w: 1600, h: 1200 });
    expect(g.drag(g.frame("post", "y", 400, 210), -200, 0).post).toEqual(at(50, 50));
    expect(g.drag(g.frame("og", "", 132, 132), -60, -60).og).toEqual(at(50, 50));
  });

  it("before the photo is measured, one frame's width is the whole way across, as before", () => {
    const g = gestures("fill 0 50", null);
    expect(g.drag(g.frame("post", "xy", 400, 200), -100, 0).post.x).toBe(25);
    g.d.coverFocus = "fill 0 50";
    expect(g.drag(g.frame("og", "xy", 132, 132), -132, 0).og.x).toBe(100);
  });

  it("the first drag on the square leaves the page standing as it is — «fit»", () => {
    const g = gestures("", null);
    g.drag(g.frame("og", "xy", 132, 132), -66, 0);
    expect(g.d.coverFocus).toBe("fit list 50 50 100 post 50 50 100 og 100 50 100");
  });

  it("survives a frame with no size — a drag before layout must not write NaN", () => {
    const g = gestures("fill 40 60", { w: 1600, h: 1200 });
    expect(g.drag(g.frame("post", "xy", 0, 0), 30, 30).post).toEqual(at(40, 60));
    expect(g.d.coverFocus).not.toContain("NaN");
  });

  it("repaints the frames on every move, and writes nothing into the draft when the finger is not its own", () => {
    const g = gestures("fill 50 50", { w: 1600, h: 1200 });
    const el = g.frame("post", "y", 400, 210);
    g.api.down(g.ev(el, 1, 0, 0));
    g.api.move(g.ev(el, 1, 0, -9));
    g.api.move(g.ev(el, 2, 0, -90));   // some other pointer on the page
    expect(g.now().post.y).toBe(60);
    expect(g.paints()).toBe(1);
    g.api.up(g.ev(el, 2, 0, 0));       // …lifting it does not end this drag
    expect(g.api.gesture()).not.toBeNull();
    g.api.up(g.ev(el, 1, 0, 0));
    expect(g.api.gesture()).toBeNull();
  });
});

describe("two fingers — a pinch zooms the frame they are on", () => {
  it("spreading the fingers to twice their distance doubles that frame's zoom, around its own point", () => {
    const g = gestures(LONG, { w: 1600, h: 1200 });
    const el = g.frame("post", "y", 400, 210);
    g.api.down(g.ev(el, 1, 100, 100));
    g.api.down(g.ev(el, 2, 200, 100));
    g.api.move(g.ev(el, 2, 300, 100));
    expect(g.now()).toEqual({ fill: true, list: at(50, 30, 1.4), post: at(50, 40, 2), og: at(62.5, 50, 2) });
    g.api.move(g.ev(el, 2, 900, 100)); // eight times the distance: held at 3×
    expect(g.now().post.z).toBe(3);
    g.api.move(g.ev(el, 2, 110, 100)); // pinched right in: held at 1×
    expect(g.now().post.z).toBe(1);
  });

  it("when one finger lifts the other drags on from where it is, at the new zoom", () => {
    const g = gestures("fill 50 50", { w: 1600, h: 1200 });
    const el = g.frame("post", "y", 400, 210);
    g.api.down(g.ev(el, 1, 100, 100));
    g.api.down(g.ev(el, 2, 200, 100));
    g.api.move(g.ev(el, 2, 300, 100));   // 2×
    el.attrs["data-coverdrag"] = "xy";    // what admBlogPaintCover() writes once it is zoomed
    g.api.up(g.ev(el, 2, 300, 100));
    expect(g.api.gesture()).not.toBeNull();
    g.api.move(g.ev(el, 1, 60, 139));     // at 2×: 400 px across and 390 down to travel
    expect(g.now().post).toEqual(at(60, 40, 2));
    g.api.up(g.ev(el, 1, 60, 139));
    expect(g.api.gesture()).toBeNull();
  });
});

describe("the keys — on the frame that has the focus", () => {
  const key = (g: ReturnType<typeof gestures>, el: unknown, k: string) => {
    g.api.key({ target: el, key: k, preventDefault() {} });
    return g.now();
  };

  it("arrows move that frame's point two per cent at zoom 1, the way it can move", () => {
    const g = gestures(LONG, { w: 1600, h: 1200 });
    const post = g.frame("post", "y", 400, 210);
    expect(key(g, post, "ArrowDown").post).toEqual(at(50, 42));
    expect(key(g, post, "ArrowLeft").post).toEqual(at(50, 42)); // this frame does not move sideways
    expect(g.now().list).toEqual(at(50, 30, 1.4));
  });

  it("zoomed in, a press moves the picture about as far on screen — the step shrinks with the zoom", () => {
    const g = gestures(LONG, { w: 1600, h: 1200 });
    expect(key(g, g.frame("og", "xy", 132, 132), "ArrowRight").og).toEqual(at(63.5, 50, 2));
  });

  it("«+» and «−» zoom that frame by a tenth, between 1× and 3×", () => {
    const g = gestures(LONG, { w: 1600, h: 1200 });
    const list = g.frame("list", "xy", 400, 210);
    expect(key(g, list, "+").list.z).toBe(1.5);
    expect(key(g, list, "=").list.z).toBe(1.6);
    expect(key(g, list, "-").list.z).toBe(1.5);
    const post = g.frame("post", "", 400, 210);
    expect(key(g, post, "-").post.z).toBe(1);            // not below 1
    expect(key(g, post, "ArrowUp").post).toEqual(at(50, 40)); // «still»: arrows have nowhere to go
    expect(key(g, post, "+").post.z).toBe(1.1);          // …but it zooms
    expect(g.now().og).toEqual(at(62.5, 50, 2));
  });

  it("leaves every other key, and Ctrl-combinations, to the browser", () => {
    const g = gestures(LONG, { w: 1600, h: 1200 });
    const list = g.frame("list", "xy", 400, 210);
    let prevented = 0;
    g.api.key({ target: list, key: "+", ctrlKey: true, preventDefault() { prevented++; } });
    g.api.key({ target: list, key: "a", preventDefault() { prevented++; } });
    expect(prevented).toBe(0);
    expect(g.d.coverFocus).toBe(LONG);
  });
});

describe("the slider, «Сбросить» and «Вся фотография» / «Заполнить рамку»", () => {
  const branch = (head: string, params: string[], ...args: unknown[]) => {
    const body = sliceBranch(head);
    return (new Function(...params, `${VOCAB()} if (false) {} ${body.startsWith("else") ? body : "else " + body}`) as (...a: unknown[]) => void)(...args);
  };

  it("the slider under a frame zooms that frame, and repaints without a render()", () => {
    const d = { coverFocus: LONG };
    let painted = 0, state = 0;
    branch('else if (t.matches("[data-coverzoom]")) {', ["t", "S", "admBlogPaintCover", "blogPaintState"],
      { matches: (s: string) => s === "[data-coverzoom]", dataset: { coverzoom: "og" }, value: "255" },
      { adminBlogEdit: d }, () => { painted++; }, () => { state++; });
    expect(readCoverFocus(d.coverFocus)).toEqual({ fill: true, list: at(50, 30, 1.4), post: at(50, 40), og: at(62.5, 50, 2.55) });
    expect([painted, state]).toEqual([1, 1]);
  });

  it("«Сбросить» puts that frame back in the centre at zoom 1, the other two as they are", () => {
    const d = { coverFocus: LONG };
    branch("if (d.coverreset) {", ["d", "S", "admBlogPaintCover", "blogPaintState"],
      { coverreset: "list" }, { adminBlogEdit: d }, () => {}, () => {});
    expect(readCoverFocus(d.coverFocus)).toEqual({ fill: true, list: at(50, 50), post: at(50, 40), og: at(62.5, 50, 2) });
    // all three back in the centre: the value is the plain one-point form again
    d.coverFocus = "fill list 50 50 100 post 50 50 100 og 10 10 300";
    branch("if (d.coverreset) {", ["d", "S", "admBlogPaintCover", "blogPaintState"],
      { coverreset: "og" }, { adminBlogEdit: d }, () => {}, () => {});
    expect(d.coverFocus).toBe("fill 50 50");
  });

  // 1a: the switch is a pick, so it saves at once (blogAutosave("change")) — counted here
  let saves: string[] = [];
  const press = (word: string, from: string) => {
    const ed = { coverFocus: from };
    branch("if (d.coverfit) {", ["d", "S", "render", "blogAutosave"], { coverfit: word }, { adminBlogEdit: ed }, () => {},
      (ev: string) => { saves.push(ev); });
    return ed.coverFocus;
  };

  it("saves at once — a pick, not a word being typed", () => {
    saves = [];
    press("fill", "fit 62 28");
    expect(saves).toEqual(["change"]);
  });

  it("keeps every frame's point and zoom across the switch — same photograph, same framing", () => {
    expect(press("fill", "fit 62 28")).toBe("fill 62 28");
    expect(press("fit", "fill 62 28")).toBe("fit 62 28");
    expect(press("fit", LONG)).toBe(LONG.replace(/^fill/, "fit"));
    expect(press("fill", LONG.replace(/^fill/, "fit"))).toBe(LONG);
  });

  it("starts in the middle when nothing was chosen", () => {
    expect(press("fill", "")).toBe("fill 50 50");
  });

  it("writes a value the row will accept", () => {
    for (const v of [press("fill", "fit 0 100"), press("fit", "fill 100 0"), press("fit", LONG)]) {
      expect(writeCoverFocus(v)).toBe(v);
    }
  });
});

describe("the painter — what a thumb changes, on the frames already on screen", () => {
  /* admBlogPaintCover() against a stand-in for the three frames it finds on
     the page: each frame's style, its [data-coverdrag], the «двигать нечего»
     line, the slider, the number and «Сбросить». */
  function paint(focus: string, dims: Dims) {
    type Box = {
      frame: { css: Map<string, string>; style: { setProperty: (k: string, v: string) => void; removeProperty: (k: string) => void } };
      pan: { attrs: Record<string, string>; setAttribute: (k: string, v: string) => void };
      still: { hidden: boolean }; range: { value: string }; zv: { textContent: string }; reset: { disabled: boolean };
      querySelector: (s: string) => unknown;
    };
    const boxes: Record<string, Box> = {};
    for (const where of ["list", "post", "og"]) {
      const css = new Map<string, string>([["background-position", "stale"], ["transform", "stale"]]);
      const b: Box = {
        frame: { css, style: { setProperty: (k, v) => { css.set(k, v); }, removeProperty: (k) => { css.delete(k); } } },
        pan: { attrs: { "data-coverdrag": "y" }, setAttribute(k, v) { this.attrs[k] = v; } },
        still: { hidden: false }, range: { value: "100" }, zv: { textContent: "" }, reset: { disabled: true },
        querySelector(s: string) {
          if (s === { list: ".blog__tileimg", post: ".blog__cover", og: ".adm-see__og" }[where]) return b.frame;
          return ({ "[data-coverdrag]": b.pan, ".adm-see__still": b.still, "[data-coverzoom]": b.range,
            "[data-coverzoomval]": b.zv, "[data-coverreset]": b.reset } as Record<string, unknown>)[s] ?? null;
        },
      };
      boxes[where] = b;
    }
    const note = { textContent: "", hidden: false };
    const doc = {
      querySelector(s: string) {
        const m = /data-coverframe="(\w+)"/.exec(s);
        if (m) return boxes[m[1]] ?? null;
        return s === "[data-covernote]" ? note : null;
      },
    };
    new Function(
      "S", "document", "COVER_DIMS", "translateTree",
      `${VOCAB()} ${sliceVar("COVER_WIDE")} ${sliceVar("COVER_SHAPE")} ${sliceVar("BLOG_COVER_OG_NOTE")} ${sliceVar("BLOG_COVER_OG_GUESS")}
       ${sliceVar("COVER_PAINT_PROPS")} ${sliceVar("COVER_FRAME_EL")}
       ${slice("blogCoverAxis")} ${slice("blogCoverMode")} ${slice("blogCoverZoomText")} ${slice("blogCoverHome")}
       ${slice("blogCoverPaintEl")} ${slice("admBlogPaintCover")}
       admBlogPaintCover();`,
    )({ adminBlogEdit: { coverFocus: focus, coverUrl: "/c.jpg" }, lang: "RU" }, doc, { "/c.jpg": dims || undefined }, () => {});
    return { boxes, note };
  }
  const styleOf = (css: Map<string, string>) => [...css].map(([k, v]) => `${k}:${v}`).join(";");

  it("writes each frame's own crop and clears what it no longer says", () => {
    const { boxes } = paint(LONG, { w: 1600, h: 1200 });
    expect(styleOf(boxes.list.frame.css)).toBe(coverBgStyle(LONG, "list"));
    expect(styleOf(boxes.post.frame.css)).toBe(coverBgStyle(LONG, "post"));   // no stale transform left on it
    expect(styleOf(boxes.og.frame.css)).toBe(coverBgStyle(LONG, "og"));
  });

  it("a zoomed frame moves every way and stops saying «двигать нечего»; the others keep their own mode", () => {
    const { boxes, note } = paint("fill list 50 50 150 post 50 50 100 og 50 50 100", { w: 1200, h: 630 });
    expect(boxes.list.pan.attrs["data-coverdrag"]).toBe("xy");
    expect(boxes.list.still.hidden).toBe(true);
    expect(boxes.post.pan.attrs["data-coverdrag"]).toBe("");
    expect(boxes.post.still.hidden).toBe(false);
    expect(boxes.og.pan.attrs["data-coverdrag"]).toBe("x");
    expect(note.hidden).toBe(false);
  });

  it("the slider, the number and «Сбросить» follow the frame's own zoom", () => {
    const { boxes } = paint(LONG, { w: 1600, h: 1200 });
    expect([boxes.list.range.value, boxes.list.zv.textContent, boxes.list.reset.disabled]).toEqual(["140", "1,4×", false]);
    expect([boxes.post.range.value, boxes.post.zv.textContent, boxes.post.reset.disabled]).toEqual(["100", "1×", false]);
    expect([boxes.og.range.value, boxes.og.zv.textContent, boxes.og.reset.disabled]).toEqual(["200", "2×", false]);
    const home = paint("fill 50 50", { w: 1600, h: 1200 }).boxes;
    expect(home.post.reset.disabled).toBe(true);
  });

  it("the photo's shape arriving under a thumb on a slider is painted in place — the slider is not rebuilt away", () => {
    const calls: string[] = [];
    const slider = { matches: (s: string) => s === "[data-coverzoom]" };
    const see = { contains: (n: unknown) => n === slider, parentNode: { replaceChild: () => calls.push("rebuilt") } };
    const repaint = (active: unknown, drag: unknown) =>
      new Function(
        "S", "document", "COVERDRAG", "admBlogPaintCover", "admBlogSeeHTML", "admBlogCoverWords", "translateTree",
        `var COVER_REPAINT_DUE = false; ${slice("admBlogRepaintSee")} admBlogRepaintSee("/c.jpg"); return COVER_REPAINT_DUE;`,
      )(
        { adminBlogEdit: { coverUrl: "/c.jpg", coverFocus: LONG } },
        { querySelector: () => see, activeElement: active, createElement: () => ({ set innerHTML(_v: string) {}, firstChild: {} }) },
        drag, () => calls.push("painted"), () => "", () => ({ say: "" }), () => {},
      );
    expect(repaint(slider, null)).toBe(false);
    expect(calls).toEqual(["painted"]);
    calls.length = 0;
    expect(repaint(null, { el: {} })).toBe(true);   // a thumb on a frame: later, once it lifts
    expect(calls).toEqual([]);
    expect(repaint(null, null)).toBe(false);
    expect(calls).toEqual(["rebuilt"]);
  });

  it("«Вся фотография»: the shop frames are cleared back to their stylesheet; the square keeps its crop", () => {
    const { boxes } = paint("fit list 50 30 140 post 50 40 100 og 62.5 50 200", { w: 1600, h: 1200 });
    expect(boxes.list.frame.css.size).toBe(0);
    expect(boxes.post.frame.css.size).toBe(0);
    expect(styleOf(boxes.og.frame.css)).toBe(coverBgStyle(LONG, "og"));
  });
});

/* ---------- 5. every renderer that draws a cover ------------------------- */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("every renderer reads its own frame", () => {
  it("the SPA's frame function hands each frame its own setting", () => {
    const run = new Function(
      "tower", "esc",
      `${VOCAB()} var BLOG_COVER_CLS = { list: "blog__tileimg", post: "blog__cover" }; ${slice("blogCoverFrameHTML")}
       return blogCoverFrameHTML;`,
    )(() => "", (s: string) => s) as (w: string, u: string, a: string, f: unknown) => string;
    expect(run("list", "/c.jpg", "a", LONG)).toContain(coverBgStyle(LONG, "list"));
    expect(run("post", "/c.jpg", "a", LONG)).toContain(coverBgStyle(LONG, "post"));
    expect(run("post", "/c.jpg", "a", LONG)).not.toContain("scale(");
    // the shop's own two places pass the article's value through it
    expect(app).toContain('blogCoverFrameHTML("list", p.coverUrl, p.coverAlt || p.title, p.coverFocus)');
    expect(app).toContain('blogCoverFrameHTML("post", p.coverUrl, p.coverAlt || p.title, p.coverFocus)');
  });

  it("the request-time article and its tiles carry it as an inline style — tile by the list's, cover by the article's", () => {
    const page = read("../src/lib/blog-page.ts");
    expect(page).toContain('import { coverImgStyle } from "@/lib/blog-cover.mjs"');
    expect(page.match(/coverStyle\(post\.coverFocus, "list"\)/g) ?? []).toHaveLength(1);
    expect(page.match(/coverStyle\(post\.coverFocus, "post"\)/g) ?? []).toHaveLength(1);
    expect(page).not.toMatch(/coverStyle\(post\.coverFocus\)/);
    expect(page).toContain("coverFocus: p.coverFocus");   // #blogdata, for the SPA that adopts it
    expect(page).toContain("coverFocus: post.coverFocus");  // #blogpost
  });

  it("the prerendered article and its tiles carry the same style, from the same module", () => {
    const pre = read("../tools/prerender-shop2.mjs");
    expect(pre.match(/coverStyle\(post\.coverFocus, "list"\)/g) ?? []).toHaveLength(1);
    expect(pre.match(/coverStyle\(post\.coverFocus, "post"\)/g) ?? []).toHaveLength(1);
    expect(pre).toContain("coverImgStyle(focus, where)");
    // …and the card the build draws keeps the square the owner framed for social media
    expect(pre).toContain("drawBlogCard(f, post.coverUrl, post.coverFocus)");
    expect(pre).toContain('containingCrop(turned ? meta.height : meta.width, turned ? meta.width : meta.height, OG_W, OG_H, coverFocus, "og")');
  });

  it("the build's export brings the column out of the row at all", () => {
    const exp = read("../tools/lib/blog-export.mjs");
    expect(exp).toContain("cover_focus");
    expect(exp).toContain("coverFocus: writeCoverFocus(r.cover_focus)");
  });

  it("the social card drawn at request time crops to the square's own point and zoom, and caches per value", () => {
    // og-card.ts holds a NUL byte — read as bytes, compared as text
    const og = readFileSync(fileURLToPath(new URL("../src/lib/og-card.ts", import.meta.url))).toString("utf8");
    expect(og).toContain('import { focusCrop } from "@/lib/blog-cover.mjs"');
    expect(og).toContain('PHOTO.size, PHOTO.size, spec.focus, "og",');
    expect(og).toContain("focus: post.coverFocus");
    expect(og).toContain("post.coverUrl, post.coverFocus");   // the ETag moves with the framing
    expect(og).toContain("pipeline = pipeline.extract(rect)");
  });

  it("the two public routes answer with it, or the SPA has nothing to draw", () => {
    expect(read("../src/app/api/blog/route.ts")).toContain("coverFocus: p.coverFocus");
    expect(read("../src/app/api/blog/[slug]/route.ts")).toContain("coverFocus: post.coverFocus");
  });

  it("the panel sends it and counts it as an unsaved change", () => {
    expect(app).toContain("coverFocus: d.coverFocus || null");
    expect(sliceVar("BLOG_SIG_FIELDS")).toContain('"coverFocus"');
    expect(slice("blogDraftSig")).toContain("d.coverFocus");
    // …and the admin route lets it through to @/lib/blog
    expect(read("../src/app/api/admin/blog/route.ts")).toContain("coverFocus: body.coverFocus");
  });

  it("a new photograph arrives with no framing — 62% of one picture is not 62% of another", () => {
    expect(slice("blogCoverUpload")).toContain('S.adminBlogEdit.coverFocus = ""');
  });

  it("the handlers are wired: the slider, «Сбросить», the pointer and the keys", () => {
    expect(app).toMatch(/\[data-coverfit\],\[data-coverreset\],/);
    expect(app).toContain('document.addEventListener("pointerdown", coverPointerDown);');
    expect(app).toContain('document.addEventListener("pointermove", coverPointerMove, { passive: false });');
    expect(app).toContain('document.addEventListener("pointerup", coverDragEnd);');
    expect(app).toContain('document.addEventListener("pointercancel", coverDragEnd);');
    expect(app).toContain('document.addEventListener("keydown", coverKey);');
  });
});

describe("the shop's frames: shape, clip and the tile's lift", () => {
  const css = read("../public/shop2/styles.css");
  const admin = read("../public/shop2/admin.css");

  it("knows the shop frames' shape from styles.css", () => {
    expect(css).toMatch(/\.blog__tileimg \{[^}]*aspect-ratio: 1200 \/ 630/);
    expect(css).toMatch(/\.blog__cover \{[^}]*aspect-ratio: 1200 \/ 630/);
    const shape = new Function(`${sliceVar("COVER_WIDE")} ${sliceVar("COVER_SHAPE")} return COVER_SHAPE;`)();
    expect(shape).toEqual({ list: 1200 / 630, post: 1200 / 630, og: 1 });
  });

  it("a zoomed tile still lifts under the pointer — through `translate`, which stacks with its inline scale", () => {
    expect(css).toContain('.blog__tile:hover .blog__tileimg[style*="scale("] { translate: 0 -2px; }');
    expect(css).toContain(".blog__tile .blog__tileimg { transition: transform .4s var(--ease), translate .4s var(--ease); }");
  });

  it("the panel's box around a frame clips a zoomed one, so it cannot widen the editor", () => {
    expect(admin).toMatch(/\.adm-see__f \{[^}]*overflow: hidden/);
  });

  /* Measured in Chrome: a 375 px frame at scale(3) with its clip-path still
     makes the page 1125 px wide; the tile or the article around it clipping
     sideways brings it back to the screen. Both the SPA's markup and the
     server's put the cover as a direct child of the tile and of the article. */
  it("the tile and the article holding a zoomed cover clip sideways, so the page cannot slide", () => {
    expect(css).toContain('.blog__tile:has(> [style*="scale("]), .blog__post:has(> .blog__cover[style*="scale("]) { overflow-x: clip; }');
    const lf = (s: string) => s.replace(/\r\n/g, "\n");
    expect(lf(app)).toMatch(/'<article class="sec blog__post blog__read">' \+\n\s*blogHeadHTML\(post\)/);
    expect(lf(read("../src/lib/blog-page.ts"))).toMatch(/'<article class="sec blog__post blog__read">' \+\n\s*\(post\.coverUrl/);
  });
});

describe("which way a photograph is cut in each frame at zoom 1", () => {
  const shape = new Function(
    `${sliceVar("COVER_WIDE")} ${slice("blogCoverAxis")} return { axis: blogCoverAxis, WIDE: COVER_WIDE };`,
  )() as { axis: (dims: Dims, frame: number) => string | null; WIDE: number };

  it("works out which side a photograph is cut along in each frame", () => {
    const { axis, WIDE } = shape;
    // an ordinary landscape photo: top and bottom in the shop, left and right in the square
    for (const [w, h] of [[1600, 1200], [1500, 1000], [1920, 1080]]) {
      expect(axis({ w, h }, WIDE), `${w}×${h} in 1200×630`).toBe("y");
      expect(axis({ w, h }, 1), `${w}×${h} in the square`).toBe("x");
    }
    // the size the hint recommends: nothing to cut in the shop, only the square cuts
    expect(axis({ w: 1200, h: 630 }, WIDE)).toBe("");
    expect(axis({ w: 1210, h: 630 }, WIDE)).toBe("");      // within 2%
    expect(axis({ w: 1200, h: 630 }, 1)).toBe("x");
    // a panorama: sideways everywhere; a portrait: up and down everywhere
    expect(axis({ w: 3000, h: 1000 }, WIDE)).toBe("x");
    expect(axis({ w: 800, h: 1200 }, WIDE)).toBe("y");
    expect(axis({ w: 800, h: 1200 }, 1)).toBe("y");
    // a square catalogue photo loses nothing to the square
    expect(axis({ w: 1000, h: 1000 }, 1)).toBe("");
    // not measured yet: both ways, as it was
    expect(axis(null, WIDE)).toBeNull();
  });
});
