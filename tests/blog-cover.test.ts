/**
 * The cover's one setting, and the six frames that have to obey it.
 *
 * «возможность редактировать размер или двигать фото для обложки» — Renat,
 * round 20 and again 18.09.2026. One photograph is drawn in three shapes:
 * 1200×630 (the list tile and the top of the article), a 518×518 square (the
 * social card src/lib/og-card.ts draws when a scraper asks) and a full-bleed
 * 1200×630 (the one tools/prerender-shop2.mjs draws at build). What is stored
 * is one point, `cover_focus`; what this file guards is that nobody is
 * reading it and everybody is.
 *
 * Three groups:
 *
 *  1. the vocabulary — what src/lib/blog-cover.mjs accepts, refuses, and
 *     works out. `focusCrop()` has to place a rectangle the way CSS places a
 *     background, or the card and the page would disagree about the same
 *     number;
 *  2. the twin. blogCoverFocus()/blogCoverWrite()/blogCoverBgStyle() in
 *     public/shop2/app.js are a deliberate third copy — the browser loads
 *     that file with no build step and cannot import the module — so they are
 *     sliced out by source text and run against it. This is the tripwire the
 *     sanitiser did not have: `data-fig` went missing from every prerendered
 *     article for a whole round because a second copy drifted and nothing
 *     compared them (see the header of src/lib/blog-html.mjs);
 *  3. every renderer, by reading what it emits. A setting only the editor
 *     honours is worse than none.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  coverBgStyle,
  coverImgStyle,
  focusCrop,
  readCoverFocus,
  writeCoverFocus,
} from "@/lib/blog-cover.mjs";

/* ---------- 1. the vocabulary -------------------------------------------- */

describe("cover focus — what is stored", () => {
  it("reads the two words and the two numbers", () => {
    expect(readCoverFocus("fill 62 28")).toEqual({ fill: true, x: 62, y: 28 });
    expect(readCoverFocus("fit 0 100")).toEqual({ fill: false, x: 0, y: 100 });
  });

  it("takes a bare word as the centre", () => {
    expect(readCoverFocus("fill")).toEqual({ fill: true, x: 50, y: 50 });
    expect(readCoverFocus("fit")).toEqual({ fill: false, x: 50, y: 50 });
  });

  it("refuses everything outside the vocabulary — which reads as absent", () => {
    for (const bad of ["", null, undefined, "zoom 1 2", "fill 101 0", "fill 0 101", "fill -1 0",
      "fill 62", "fill 62 28 9", "cover", "fill,62,28", "<script>", "fill 62 28; drop table"]) {
      expect(readCoverFocus(bad as string), String(bad)).toBeNull();
    }
  });

  it("normalises whatever the panel sends into the one shape the row holds", () => {
    expect(writeCoverFocus({ fill: true, x: 62.4, y: 27.5 })).toBe("fill 62 28");
    expect(writeCoverFocus({ fill: false, x: -20, y: 480 })).toBe("fit 0 100");
    expect(writeCoverFocus("FILL 62 28")).toBe("fill 62 28");
    expect(writeCoverFocus("fill")).toBe("fill 50 50");
  });

  it("stores nothing for a value it does not know, so an old post stays an old post", () => {
    for (const bad of [null, undefined, "", "attention", { x: 1 }, { fill: true, x: NaN, y: 2 }, 7]) {
      expect(writeCoverFocus(bad as string), String(bad)).toBeNull();
    }
  });

  it("matches the check constraint in db/migrations/193_blog_cover_focus.sql", () => {
    const sql = readFileSync(fileURLToPath(new URL("../db/migrations/193_blog_cover_focus.sql", import.meta.url)), "utf8");
    const re = /cover_focus ~ '\^([^']+)\$'/.exec(sql);
    expect(re, "the migration still states the vocabulary").not.toBeNull();
    const constraint = new RegExp("^" + (re as RegExpExecArray)[1] + "$");
    for (const good of ["fit 50 50", "fill 0 0", "fill 100 100", "fit 7 99"]) {
      expect(constraint.test(good), good).toBe(true);
      expect(writeCoverFocus(good), good).toBe(good);
    }
    for (const bad of ["fill 101 0", "zoom 1 2", "fill 62", "FILL 62 28"]) {
      expect(constraint.test(bad), bad).toBe(false);
    }
  });
});

describe("cover focus — the style a frame wears", () => {
  it("writes the two properties that crop, and only when they crop", () => {
    expect(coverImgStyle("fill 62 28")).toBe("object-fit:cover;object-position:62% 28%");
    expect(coverBgStyle("fill 62 28")).toBe("background-size:cover;background-position:62% 28%");
  });

  it("writes nothing at all for a picture that stands whole — the stylesheet already says so", () => {
    for (const f of ["fit 62 28", "fit 50 50", "", null, "nonsense"]) {
      expect(coverImgStyle(f as string), String(f)).toBe("");
      expect(coverBgStyle(f as string), String(f)).toBe("");
    }
  });
});

describe("cover focus — the rectangle a social card keeps", () => {
  /* The rule the two sharp crops have to obey, because it is the rule CSS
     obeys: x% ACROSS THE PICTURE lines up with x% across the frame. At 0 the
     left edge stays on the left edge — not «centre the point, then clamp». */
  it("places the crop the way background-position does", () => {
    // a 2000×1000 photo into a square: 1000 wide, 1000 of slack across
    expect(focusCrop(2000, 1000, 1, 1, "fill 0 50")).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
    expect(focusCrop(2000, 1000, 1, 1, "fill 100 50")).toEqual({ left: 1000, top: 0, width: 1000, height: 1000 });
    expect(focusCrop(2000, 1000, 1, 1, "fill 50 50")).toEqual({ left: 500, top: 0, width: 1000, height: 1000 });
    expect(focusCrop(2000, 1000, 1, 1, "fill 30 50")).toEqual({ left: 300, top: 0, width: 1000, height: 1000 });
  });

  it("crops down the other axis for a tall photo", () => {
    // 1000×2000 into 1200×630: the width is the limit, 525 tall, 1475 of slack
    expect(focusCrop(1000, 2000, 1200, 630, "fill 50 0")).toEqual({ left: 0, top: 0, width: 1000, height: 525 });
    expect(focusCrop(1000, 2000, 1200, 630, "fill 50 100")).toEqual({ left: 0, top: 1475, width: 1000, height: 525 });
  });

  it("never leaves the picture — sharp's extract() throws on a rect that does", () => {
    for (const [w, h] of [[1200, 630], [630, 1200], [1, 1], [4001, 17], [2, 5000]]) {
      for (const p of ["fill 0 0", "fill 100 100", "fill 50 50", "fit 100 0"]) {
        const r = focusCrop(w, h, 518, 518, p);
        expect(r, `${w}x${h} ${p}`).not.toBeNull();
        const rect = r as { left: number; top: number; width: number; height: number };
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
        expect(rect.left + rect.width).toBeLessThanOrEqual(w);
        expect(rect.top + rect.height).toBeLessThanOrEqual(h);
      }
    }
  });

  it("gives the caller nothing when there is no point or no photograph to measure", () => {
    expect(focusCrop(1200, 630, 518, 518, null)).toBeNull();
    expect(focusCrop(1200, 630, 518, 518, "")).toBeNull();
    expect(focusCrop(undefined, undefined, 518, 518, "fill 50 50")).toBeNull();
    expect(focusCrop(0, 0, 518, 518, "fill 50 50")).toBeNull();
  });

  /* `fit` is the page's business, never the card's: the card crops whatever
     the page does, so the point has to work out a rectangle either way. */
  it("crops for `fit` too, because a social card has no other choice", () => {
    expect(focusCrop(2000, 1000, 1, 1, "fit 100 50")).toEqual({ left: 1000, top: 0, width: 1000, height: 1000 });
  });
});

/* ---------- 2. the deliberate twin in public/shop2/app.js ---------------- */

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
/** `var <name> = …;` — the regex the twin reads the vocabulary with. */
function sliceVar(name: string): string {
  const start = app.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const end = app.indexOf(";", start);
  if (end < 0) throw new Error(`no terminating ; for var ${name} in app.js`);
  return app.slice(start, end + 1);
}

const twin = new Function(
  `${sliceVar("BLOG_FOCUS_RX")} ${slice("blogCoverFocus")} ${slice("blogCoverWrite")} ${slice("blogCoverBgStyle")}
   return { blogCoverFocus: blogCoverFocus, blogCoverWrite: blogCoverWrite, blogCoverBgStyle: blogCoverBgStyle };`,
)() as {
  blogCoverFocus: (raw: unknown) => { fill: boolean; x: number; y: number } | null;
  blogCoverWrite: (fill: boolean, x: number, y: number) => string;
  blogCoverBgStyle: (focus: unknown) => string;
};

/* Everything a cover could plausibly be asked to hold, including what a
   hand-written API call or an older row might put there. */
const CORPUS = [
  "fill 62 28", "fit 62 28", "fill", "fit", "fill 0 0", "fill 100 100", "fit 0 100",
  "FILL 62 28", "  fill 62 28  ", "fill  62  28",
  "", "   ", "zoom 1 2", "cover", "fill 101 0", "fill 0 101", "fill -1 0", "fill 62",
  "fill 62 28 9", "fill,62,28", "attention", "<script>", "fill 62 28; drop table posts",
  null, undefined,
];

describe("the twin in app.js reads the same value as src/lib/blog-cover.mjs", () => {
  it("agrees on every shape a stored value could take", () => {
    for (const raw of CORPUS) {
      expect(twin.blogCoverFocus(raw), String(raw)).toEqual(readCoverFocus(raw as string));
    }
  });

  it("agrees on the style a frame wears", () => {
    for (const raw of CORPUS) {
      expect(twin.blogCoverBgStyle(raw), String(raw)).toBe(coverBgStyle(raw as string));
    }
  });

  it("writes back exactly what the row will hold, so a drag survives a save", () => {
    for (const [fill, x, y] of [[true, 62.4, 27.5], [false, -20, 480], [true, 0, 0], [false, 100, 100]] as
      Array<[boolean, number, number]>) {
      const written = twin.blogCoverWrite(fill, x, y);
      expect(writeCoverFocus(written), written).toBe(written);
      expect(writeCoverFocus({ fill, x, y })).toBe(written);
    }
  });
});

/* ---------- 2b. the thumb ------------------------------------------------ */

/** One `if (…) { … }` branch of the panel's click dispatcher, on its own. */
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

type Draft = { coverFocus: string };

/** A drag of (dx, dy) pixels on a `w`×`h` frame, from `from`. */
function drag(from: string, w: number, h: number, dx: number, dy: number): string {
  const d: Draft = { coverFocus: from };
  const start = twin.blogCoverFocus(from) ?? { fill: false, x: 50, y: 50 };
  const run = new Function(
    "S", "COVERDRAG", "blogCoverWrite", "admBlogPaintCover",
    `${slice("coverDragTo")} coverDragTo(1000 + arguments[4], 500 + arguments[5]);`,
  ) as (...a: unknown[]) => void;
  run(
    { adminBlogEdit: d },
    { px: 1000, py: 500, w, h, fill: start.fill, x: start.x, y: start.y },
    twin.blogCoverWrite,
    () => {},
    dx, dy,
  );
  return d.coverFocus;
}

describe("dragging the picture — what a thumb does to the point", () => {
  /* The direction is the whole question, and it is not arbitrary: at a
     higher x, `background-position` shows more of the RIGHT of the picture.
     So pulling the picture LEFT has to raise x, or the photograph would run
     away from the finger. */
  it("moves the picture with the finger, not against it", () => {
    expect(drag("fill 50 50", 400, 200, -200, 0)).toBe("fill 100 50");
    expect(drag("fill 50 50", 400, 200, 200, 0)).toBe("fill 0 50");
    expect(drag("fill 50 50", 400, 200, 0, -100)).toBe("fill 50 100");
    expect(drag("fill 50 50", 400, 200, 0, 100)).toBe("fill 50 0");
  });

  it("sweeps the whole picture across one whole frame, whatever the frame's size", () => {
    expect(drag("fill 0 50", 400, 200, -400, 0)).toBe("fill 100 50");
    expect(drag("fill 0 50", 132, 132, -132, 0)).toBe("fill 100 50");
    // …so a quarter of the way across is a quarter of the picture
    expect(drag("fill 0 50", 400, 200, -100, 0)).toBe("fill 25 50");
  });

  it("stops at the edges instead of running off them", () => {
    expect(drag("fill 50 50", 400, 200, -9999, -9999)).toBe("fill 100 100");
    expect(drag("fill 50 50", 400, 200, 9999, 9999)).toBe("fill 0 0");
  });

  it("keeps the mode it started in — a drag moves the point, never the size", () => {
    expect(drag("fit 50 50", 400, 200, -100, 0)).toBe("fit 75 50");
  });

  it("starts a first drag from the centre, leaving the page standing as it is", () => {
    // nothing chosen and the thumb on the square: the page is untouched
    // («fit»), only the social card stops guessing
    expect(drag("", 132, 132, -66, 0)).toBe("fit 100 50");
  });

  it("survives a frame with no width — a drag before layout must not write NaN", () => {
    expect(drag("fill 40 60", 0, 0, 30, 30)).toBe("fill 40 60");
  });
});

describe("«Вся фотография» / «Заполнить рамку»", () => {
  const press = (word: string, from: string) => {
    const ed = { coverFocus: from };
    const run = new Function(
      "d", "S", "blogCoverFocus", "blogCoverWrite", "render",
      `${sliceBranch("if (d.coverfit) {")}`,
    ) as (...a: unknown[]) => void;
    run({ coverfit: word }, { adminBlogEdit: ed }, twin.blogCoverFocus, twin.blogCoverWrite, () => {});
    return ed.coverFocus;
  };

  it("keeps the point across the switch — same photograph, same spot on it", () => {
    expect(press("fill", "fit 62 28")).toBe("fill 62 28");
    expect(press("fit", "fill 62 28")).toBe("fit 62 28");
  });

  it("starts in the middle when nothing was chosen", () => {
    expect(press("fill", "")).toBe("fill 50 50");
  });

  it("writes a value the row will accept", () => {
    for (const v of [press("fill", "fit 0 100"), press("fit", "fill 100 0")]) {
      expect(writeCoverFocus(v)).toBe(v);
    }
  });
});

/* ---------- 3. every renderer that draws a cover ------------------------- */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("every renderer reads the point", () => {
  /* Six frames, four files. Read as source rather than rendered because three
     of them need a database and two need sharp; what is being guarded is that
     the value reaches the element at all, which is exactly what went wrong
     with `data-fig` and went unnoticed for a round. */
  it("the SPA hands it to the one function that draws both of its frames", () => {
    expect(app).toContain('blogCoverFrameHTML("list", p.coverUrl, p.coverAlt || p.title, p.coverFocus)');
    expect(app).toContain('blogCoverFrameHTML("post", p.coverUrl, p.coverAlt || p.title, p.coverFocus)');
    // …and that function puts it on the element rather than dropping it
    expect(slice("blogCoverFrameHTML")).toContain("blogCoverBgStyle(focus)");
  });

  it("the request-time article and its tiles carry it as an inline style", () => {
    const page = read("../src/lib/blog-page.ts");
    expect(page).toContain('import { coverImgStyle } from "@/lib/blog-cover.mjs"');
    expect(page.match(/coverStyle\(post\.coverFocus\)/g) ?? []).toHaveLength(2);
    expect(page).toContain("coverFocus: p.coverFocus");   // #blogdata, for the SPA that adopts it
    expect(page).toContain("coverFocus: post.coverFocus");  // #blogpost
  });

  it("the prerendered article and its tiles carry the same style, from the same module", () => {
    const pre = read("../tools/prerender-shop2.mjs");
    expect(pre.match(/coverStyle\(post\.coverFocus\)/g) ?? []).toHaveLength(2);
    expect(pre).toContain("coverImgStyle");
    // …and the card the build draws crops to the point instead of guessing
    expect(pre).toContain("drawBlogCard(f, post.coverUrl, post.coverFocus)");
    expect(pre).toContain("focusCrop(turned ? meta.height : meta.width");
  });

  it("the build's export brings the column out of the row at all", () => {
    const exp = read("../tools/lib/blog-export.mjs");
    expect(exp).toContain("cover_focus");
    expect(exp).toContain("coverFocus: writeCoverFocus(r.cover_focus)");
  });

  it("the social card drawn at request time crops to it, and caches per point", () => {
    const og = read("../src/lib/og-card.ts");
    expect(og).toContain('import { focusCrop } from "@/lib/blog-cover.mjs"');
    expect(og).toContain("focus: post.coverFocus");
    expect(og).toContain("post.coverUrl, post.coverFocus");   // the ETag moves with the point
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

  it("a new photograph arrives with no point — 62% of one picture is not 62% of another", () => {
    expect(slice("blogCoverUpload")).toContain('S.adminBlogEdit.coverFocus = ""');
  });
});
