/**
 * The printable gift card — the PDF itself, and the token that guards its URL.
 *
 * No database and no network: renderGiftCardPdf() is a pure function of the
 * card, the shop details and the language, which is the whole reason it takes
 * them as arguments (src/lib/giftcard-pdf.ts).
 *
 * "The text is present" is checked by really reading it back out of the file:
 * inflate every stream, pair each embedded font with its /ToUnicode CMap, then
 * decode the `<hex> Tj` runs of the page's content stream through the CMap of
 * whichever font was selected by the last `Tf`. That is a genuine extraction —
 * a card that drew the wrong date, lost its code or silently dropped Cyrillic
 * fails here, which asserting on byte length never would.
 */
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOP,
  giftPdfFilename,
  giftPdfKey,
  giftPdfPath,
  giftPdfToken,
  humanDate,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  renderGiftCardPdf,
  towerPath,
  verifyGiftPdfToken,
  wrapText,
} from "@/lib/giftcard-pdf";
import { giftValidUntil, GIFT_VALID_MONTHS } from "@/lib/giftcards";
import { isAllowedKey } from "@/lib/storage";
import { TEST_SECRET } from "./helpers";

/* ---------- a very small PDF reader ------------------------------------- */

/** Every top-level stream object, inflated where it is Flate-encoded. */
function streams(bytes: Uint8Array): Map<number, string> {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  const out = new Map<number, string>();
  const objRe = /(\d+) 0 obj/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(raw))) {
    const num = Number(m[1]);
    const head = raw.indexOf("stream", m.index);
    const nextObj = raw.indexOf(" 0 obj", m.index + m[0].length);
    if (head < 0 || (nextObj > 0 && head > nextObj)) continue;
    const start = head + (raw.startsWith("stream\r\n", head) ? 8 : 7);
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const body = buf.subarray(start, end);
    try {
      out.set(num, inflateSync(body).toString("latin1"));
    } catch {
      out.set(num, body.toString("latin1"));
    }
  }
  return out;
}

/** `<0001> <0414>` pairs → code → character. */
function cmapOf(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,})>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const chars = (m[2].match(/.{4}/g) ?? []).map((h) => String.fromCharCode(parseInt(h, 16)));
    map.set(m[1].toUpperCase(), chars.join(""));
  }
  return map;
}

/**
 * All the text the page draws, one string per `Tj`, in drawing order.
 *
 * The font a run is written in is named in the content stream (`/Golos… Tf`);
 * the CMap that decodes it is found by matching that name's family prefix
 * against the `/BaseFont` of the font dictionaries, which carry the
 * `/ToUnicode` object number.
 */
function extractText(bytes: Uint8Array): string[] {
  const blobs = streams(bytes);
  const all = [...blobs.values()].join("\n");

  /* /BaseFont /GolosText-Regular-2000 … /ToUnicode 12 0 R */
  const family = new Map<string, Map<string, string>>();
  const fontRe = /\/BaseFont\s*\/([A-Za-z0-9+._-]+)[\s\S]{0,400}?\/ToUnicode\s+(\d+)\s+0\s+R/g;
  let f: RegExpExecArray | null;
  while ((f = fontRe.exec(all))) {
    const cmapText = blobs.get(Number(f[2]));
    if (!cmapText || !cmapText.includes("beginbfchar")) continue;
    family.set(f[1].replace(/-\d+$/, ""), cmapOf(cmapText));
  }

  const content = [...blobs.values()].filter((t) => t.includes("BT") && t.includes("Tj"));
  const runs: string[] = [];
  for (const stream of content) {
    let current: Map<string, string> | undefined;
    const opRe = /\/([A-Za-z0-9+._-]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj/g;
    let op: RegExpExecArray | null;
    while ((op = opRe.exec(stream))) {
      if (op[1]) {
        const name = op[1].replace(/-\d+$/, "");
        current = family.get(name) ?? [...family.entries()].find(([k]) => name.startsWith(k))?.[1];
        continue;
      }
      const codes = (op[2] ?? "").toUpperCase().match(/.{4}/g) ?? [];
      runs.push(codes.map((c) => current?.get(c) ?? "�").join(""));
    }
  }
  return runs;
}

/** Every `1 0 0 1 x y Tm` baseline in the page's content stream. */
function baselines(bytes: Uint8Array): Array<{ x: number; y: number }> {
  const content = [...streams(bytes).values()].filter((t) => t.includes("BT") && t.includes("Tj"));
  const out: Array<{ x: number; y: number }> = [];
  for (const stream of content) {
    const re = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stream))) out.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return out;
}

/* ---------- fixtures ----------------------------------------------------- */

const CARD = {
  code: "RMP-ACDE-4679",
  amount: 50,
  lang: "RU",
  createdAt: "2026-09-04T10:00:00.000Z",
  validUntil: "2027-09-04",
  recipient: { name: "Mari", from: "Renat", message: "С днём рождения!" },
};

async function render(over: Partial<typeof CARD> = {}, lang?: string) {
  return renderGiftCardPdf({ ...CARD, ...over }, { shop: DEFAULT_SHOP, lang });
}

/* ---------- the URL and its token ---------------------------------------- */

describe("gift-card PDF — the download token", () => {
  const withSecret = <T>(fn: () => T): T => {
    const before = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = TEST_SECRET;
    try {
      return fn();
    } finally {
      if (before === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = before;
    }
  };

  it("is deterministic, code-specific and verifies", () => {
    withSecret(() => {
      const t = giftPdfToken("RMP-ACDE-4679");
      expect(t).toHaveLength(32);
      expect(giftPdfToken("RMP-ACDE-4679")).toBe(t);
      expect(giftPdfToken("RMP-ACDE-4670")).not.toBe(t);
      expect(verifyGiftPdfToken("RMP-ACDE-4679", t)).toBe(true);
      // the code is upper-cased before signing, so a lower-case URL still opens
      expect(giftPdfToken("rmp-acde-4679")).toBe(t);
    });
  });

  it("refuses a token for another card, a truncated one, and nothing at all", () => {
    withSecret(() => {
      const t = giftPdfToken("RMP-ACDE-4679");
      expect(verifyGiftPdfToken("RMP-ACDE-4670", t)).toBe(false);
      expect(verifyGiftPdfToken("RMP-ACDE-4679", t.slice(0, 31))).toBe(false);
      expect(verifyGiftPdfToken("RMP-ACDE-4679", `${t}x`)).toBe(false);
      expect(verifyGiftPdfToken("RMP-ACDE-4679", "")).toBe(false);
      expect(verifyGiftPdfToken("RMP-ACDE-4679", null)).toBe(false);
    });
  });

  it("signs nothing — and accepts nothing — without SESSION_SECRET", () => {
    const before = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      expect(giftPdfToken("RMP-ACDE-4679")).toBe("");
      expect(verifyGiftPdfToken("RMP-ACDE-4679", "")).toBe(false);
      expect(verifyGiftPdfToken("RMP-ACDE-4679", "anything")).toBe(false);
    } finally {
      if (before !== undefined) process.env.SESSION_SECRET = before;
    }
  });

  it("builds the URL and the bucket key the rest of the shop links to", () => {
    withSecret(() => {
      const url = giftPdfPath("RMP-ACDE-4679");
      expect(url).toBe(`/api/giftcards/RMP-ACDE-4679/pdf/?t=${giftPdfToken("RMP-ACDE-4679")}`);
      expect(giftPdfFilename("RMP-ACDE-4679")).toBe("rempire-gift-card-RMP-ACDE-4679.pdf");
      // the R2 key has to survive src/lib/storage.ts's own gate
      expect(giftPdfKey("RMP-ACDE-4679")).toBe("giftcards/rmp-acde-4679.pdf");
      expect(isAllowedKey(giftPdfKey("RMP-ACDE-4679"))).toBe(true);
    });
  });
});

/* ---------- validity ------------------------------------------------------ */

describe("gift-card validity", () => {
  it("is a year from the purchase, printed as dd.mm.yyyy", () => {
    expect(GIFT_VALID_MONTHS).toBe(12);
    expect(giftValidUntil("2026-09-04T10:00:00.000Z")).toBe("2027-09-04");
    expect(humanDate("2027-09-04")).toBe("04.09.2027");
    // a missing date is "from now", never NaN on the printed card
    expect(giftValidUntil(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(giftValidUntil("not a date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/* ---------- the page ------------------------------------------------------ */

describe("gift-card PDF — the page", () => {
  it("is one A5 landscape page a PDF reader can open", async () => {
    const bytes = await render();
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(Math.round(page.getWidth())).toBe(Math.round(PAGE_WIDTH));
    expect(Math.round(page.getHeight())).toBe(Math.round(PAGE_HEIGHT));
    expect(page.getWidth()).toBeGreaterThan(page.getHeight()); // landscape
    expect(doc.getTitle()).toContain("RMP-ACDE-4679");
    // three subset faces, a vector mark and one page: well under a mail cap
    expect(bytes.length).toBeLessThan(120_000);
  });

  it("prints the code, the amount, the validity and the shop's details", async () => {
    const runs = extractText(await render());
    const text = runs.join("\n");
    expect(text).toContain("RMP-ACDE-4679");
    expect(text).toContain("50 €");
    expect(text).toContain("Действует до 04.09.2027");
    expect(text).toContain("Подарочная карта".toUpperCase());
    // the wordmark is tracked out letter by letter, so it is seven runs
    expect(runs.join("")).toContain("REMPIRE");
    expect(text).toContain(DEFAULT_SHOP.legalName);
    expect(text).toContain(DEFAULT_SHOP.address);
    expect(text).toContain("rempireshop.com");
    expect(text).toContain("Промокод или подарочная карта");
    // no glyph came out as .notdef anywhere on the card
    expect(text).not.toContain("�");
  });

  it("prints the personal message and who it is from — and omits them when absent", async () => {
    const withMessage = extractText(await render()).join("\n");
    expect(withMessage).toContain("С днём рождения!");
    expect(withMessage).toContain("Renat");
    expect(withMessage).toContain("Mari");

    const bare = extractText(await render({ recipient: null as never })).join("\n");
    expect(bare).toContain("RMP-ACDE-4679");
    expect(bare).not.toContain("С днём рождения!");
    expect(bare).not.toContain("Mari");
  });

  it("is written in the order's own language", async () => {
    const et = extractText(await render({}, "ET")).join("\n");
    expect(et).toContain("Kehtib kuni 04.09.2027");
    expect(et).toContain("KINKEKAART");
    expect(et).toContain("Sooduskood või kinkekaart");

    const en = extractText(await render({}, "EN")).join("\n");
    expect(en).toContain("Valid until 04.09.2027");
    expect(en).toContain("GIFT CARD");
    expect(en).toContain("Promo code or gift card");

    // an unknown language falls back to Russian, never to an empty card
    const zz = extractText(await render({}, "zz")).join("\n");
    expect(zz).toContain("Действует до 04.09.2027");
  });

  it("keeps a long message inside the card instead of running off it", async () => {
    const long = "Поздравляю ".repeat(40);
    const text = extractText(await render({ recipient: { name: "", from: "", message: long } })).join("\n");
    expect(text).toContain("Поздравляю");
    // three lines at most — the fourth would land on the footer rule
    const lines = extractText(await render({ recipient: { name: "", from: "", message: long } })).filter((l) =>
      l.startsWith("Поздравляю"),
    );
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("keeps every line on the page, whatever the card carries", async () => {
    const long = "Поздравляю ".repeat(40);
    for (const card of [{}, { recipient: null as never }, { recipient: { name: "Mari", from: "Renat", message: long } }]) {
      for (const lang of ["RU", "ET", "EN"]) {
        const spots = baselines(await render(card, lang));
        expect(spots.length).toBeGreaterThan(8);
        for (const { x, y } of spots) {
          // inside the printable inset on every edge — an A5 sheet on a home
          // printer loses about 10 mm, and nothing may sit in it
          expect(y).toBeGreaterThanOrEqual(18);
          expect(y).toBeLessThanOrEqual(PAGE_HEIGHT - 18);
          expect(x).toBeGreaterThanOrEqual(30);
          expect(x).toBeLessThanOrEqual(PAGE_WIDTH - 60);
        }
        // nothing between the ink band and the footer rule is left empty:
        // the amount, the code and the validity always print
        expect(spots.filter((s) => s.y > 100 && s.y < 330).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("refuses a card with no code rather than printing an empty one", async () => {
    await expect(renderGiftCardPdf({ code: "", amount: 50 })).rejects.toThrow(/bad_code/);
  });

  it("draws the tower as a real vector path off the brand file", () => {
    const tower = towerPath();
    expect(tower).not.toBeNull();
    expect(tower?.d.startsWith("M")).toBe(true);
    expect(tower?.box).toHaveLength(4);
  });
});

describe("wrapText", () => {
  it("breaks on measured width and stops at the line budget", async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont("Helvetica");
    expect(wrapText("one two three", helv, 12, 1000)).toEqual(["one two three"]);
    expect(wrapText("one two three four five six", helv, 12, 40, 2)).toHaveLength(2);
    expect(wrapText("", helv, 12, 100)).toEqual([]);
    // a single word wider than the box still gets drawn rather than dropped
    expect(wrapText("supercalifragilistic", helv, 12, 10)).toEqual(["supercalifragilistic"]);
  });
});
