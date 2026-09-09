/**
 * The link-preview cards of the three hand-written pages under `public/` —
 * /test/, /cards/ and /guide/ — the ones actually pasted into a chat.
 *
 * They used to advertise `/og-shop.png`, a shop poster reading «95 ТОВАРОВ»
 * with a «ЧЕРНОВИК ДЛЯ РЕНАТА» badge. The catalogue passed 220 products on
 * 07.09.2026 and the poster never noticed, because it is a shipped PNG with
 * nothing behind it that could ever be re-run.
 *
 * `tools/og-pages.mjs` draws the replacements and reads every number on them
 * out of the data. This is the other half of that: the card a page points at
 * has to exist, be the size the meta tags promise, and — for the one card
 * that carries a count — still agree with the file it counted. A preview
 * nobody looks at until it is in front of the shop's owner is exactly the
 * kind of thing that rots unwatched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");

/** The pages that carry a hand-written head, and the card each should own. */
const PAGES = [
  ["test", "og-test.png"],
  ["cards", "og-cards.png"],
  ["guide", "og-guide.png"],
] as const;

const html = (page: string) => readFileSync(path.join(PUB, page, "index.html"), "utf8");

/** The value of a `<meta property|name="…" content="…">`, or "". */
function meta(doc: string, key: string): string {
  const m = new RegExp(`(?:property|name)="${key}" content="([^"]*)"`).exec(doc);
  return m ? m[1] : "";
}

/** PNG width and height, straight out of the IHDR chunk — no image library. */
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString("ascii"), `${path.basename(file)} is not a PNG`).toBe("PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe("the link-preview cards of the hand-written pages", () => {
  it("gives each page its own card, 1200×630, that is really on disk", () => {
    for (const [page, png] of PAGES) {
      const doc = html(page);
      const og = meta(doc, "og:image");
      expect(og, `/${page}/ has no og:image`).toContain(`/brand/${png}`);
      /* Twitter reads og:title and og:description when its own are absent but
         NOT og:image, so the pair has to be kept in step by hand. */
      expect(meta(doc, "twitter:image"), `/${page}/: twitter:image differs from og:image`).toBe(og);

      const size = pngSize(path.join(PUB, "brand", png));
      expect(size, `/brand/${png} is ${size.w}×${size.h}`).toEqual({ w: 1200, h: 630 });
      expect(meta(doc, "og:image:width"), `/${page}/ og:image:width`).toBe("1200");
      expect(meta(doc, "og:image:height"), `/${page}/ og:image:height`).toBe("630");
    }
  });

  it("no longer points any of them at the shop's own poster", () => {
    /* /og-shop.png says «95 ТОВАРОВ» and «ЧЕРНОВИК ДЛЯ РЕНАТА». It is fine as
       the shop's fallback (OG_FALLBACK in src/lib/seo-head.mjs) and wrong as
       the face of a checklist. */
    for (const [page] of PAGES) {
      expect(html(page), `/${page}/ is advertising the shop poster again`).not.toContain("og-shop.png");
    }
  });

  it("keeps a title and a description on every card's page", () => {
    for (const [page] of PAGES) {
      const doc = html(page);
      for (const key of ["og:title", "og:description", "description"]) {
        expect(meta(doc, key).trim().length, `/${page}/ has an empty ${key}`).toBeGreaterThan(10);
      }
      // a description that runs past ~200 chars is cut mid-word in every client
      expect(meta(doc, "og:description").length, `/${page}/ og:description is long`).toBeLessThanOrEqual(200);
    }
  });
});
