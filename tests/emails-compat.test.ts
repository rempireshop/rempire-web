/**
 * Mail-client compatibility rules, held against every letter × RU/ET/EN as
 * rendered from the realistic samples (src/emails/samples.ts — the same
 * renders tools/render-emails.mjs writes to disk and screenshots, so what
 * this file checks is byte-for-byte what the PNGs show).
 *
 * What a mail client does to HTML, and which rule below answers it:
 *   · Outlook on Windows lays out with Word: no flex/grid/position/float, no
 *     background images, tables for structure, styles inline — "layout";
 *   · Gmail keeps <style> only on some paths and clips a letter over ~102 KB
 *     — "inline CSS" (every styled element carries its own style; the block
 *     only adds what cannot be inlined: media queries, dark-mode hooks, the
 *     optional web font), "size";
 *   · dark-mode clients repaint the colours — "colour scheme" (the meta
 *     pair, the prefers-color-scheme block, the [data-ogsc] hooks, and a logo
 *     that survives a near-black card: the tower on an OPAQUE white tile);
 *   · a phone shows a ~360 px column — "buttons" (44 px tall, the touch
 *     minimum, and clickable across their face), the single 600 px column
 *     that scales down, and nothing that must stay on one line — an order
 *     number, "2 шт", a price — allowed to wrap;
 *   · image-blocking clients show the alt text — "images";
 *   · the plain-text part is what a watch, a screen reader and a spam filter
 *     read — "text part";
 *   · an Estonian or English customer must never get a Russian sentence —
 *     "language".
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Lang, RenderedEmail, TemplateId } from "@/emails";
import { renderSample, SAMPLE_LANGS, SAMPLE_TEMPLATES } from "@/emails/samples";

const BASE = "https://rempireshop.com";
let priorBase: string | undefined;

beforeAll(() => {
  priorBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = BASE;
});

afterAll(() => {
  if (priorBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = priorBase;
});

/* ---------- the renders ------------------------------------------------- */

type Sample = RenderedEmail & { template: TemplateId; lang: Lang; id: string };

let cache: Sample[] | null = null;
/** Rendered once, after beforeAll has pinned PUBLIC_BASE_URL. */
function samples(): Sample[] {
  if (!cache) {
    cache = SAMPLE_TEMPLATES.flatMap((template) =>
      SAMPLE_LANGS.map((lang) => ({ template, lang, id: `${template}/${lang}`, ...renderSample(template, lang) })),
    );
  }
  return cache;
}

/** Runs `check` as one `it` per letter, so a failure names the letter. */
function forEvery(check: (mail: Sample) => void | Promise<void>): void {
  for (const template of SAMPLE_TEMPLATES) {
    for (const lang of SAMPLE_LANGS) {
      it(`${template} / ${lang}`, async () => {
        const mail = samples().find((m) => m.template === template && m.lang === lang)!;
        await check(mail);
      });
    }
  }
}

/* ---------- small HTML readers ------------------------------------------ */

/** Every opening tag of one name, as raw strings. */
function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? m[1] : null;
}

function styleBlock(html: string): string {
  const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  return m ? m[1] : "";
}

/** All CSS the letter carries — the inline attributes and the block. */
function allCss(html: string): string {
  const inline = [...html.matchAll(/\sstyle="([^"]*)"/gi)].map((m) => m[1]).join("\n");
  return inline + "\n" + styleBlock(html);
}

/** The <style> block with everything a client may legitimately drop taken
 *  out — the font @import, :root, every @media block, the [data-ogsc]
 *  dark-mode hooks. Whatever is left is a rule the letter depends on and
 *  would lose in Gmail. */
function unexplainedCss(css: string): string {
  return css
    .replace(/@import\s+url\([^)]*\)\s*;/g, "")
    .replace(/:root\s*\{[^}]*\}/g, "")
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
    .replace(/\[data-ogsc\][^{]*\{[^}]*\}/g, "")
    .trim();
}

function withoutStyle(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ");
}

const CYRILLIC_WORD = /\S*[Ѐ-ӿ]\S*/;

/* ---------- layout --------------------------------------------------- */

describe("layout: one 600 px column of presentation tables, nothing Word cannot lay out", () => {
  forEvery(({ html }) => {
    expect(html).toContain('<table role="presentation" width="600"');
    expect(html).toContain("max-width:600px");
    for (const t of tags(html, "table")) {
      expect(attr(t, "role"), `a table without role="presentation": ${t}`).toBe("presentation");
    }
    // the hidden preheader is the one <div>; everything else is table cells
    const divs = tags(html, "div");
    expect(divs, "only the hidden preheader may be a <div>").toHaveLength(1);
    expect(divs[0]).toContain("display:none");

    const css = allCss(html);
    expect(css).not.toMatch(/display\s*:\s*(flex|grid|inline-flex|inline-grid)/i);
    expect(css).not.toMatch(/position\s*:\s*(absolute|fixed|relative|sticky)/i);
    expect(css).not.toMatch(/float\s*:/i);
    expect(css).not.toMatch(/background(-image)?\s*:\s*url/i);

    for (const bad of ["<script", "<link", "<form", "<iframe", "<video", "<svg", "<button", "<input"]) {
      expect(html.toLowerCase(), `${bad} has no place in a letter`).not.toContain(bad);
    }
  });
});

/* ---------- inline CSS ----------------------------------------------- */

describe("inline CSS: every styled element carries its own style; the <style> block only adds what cannot be inlined", () => {
  forEvery(({ html }) => {
    const classed = html.match(/<[a-z][^>]*\sclass="[^"]*"[^>]*>/gi) ?? [];
    expect(classed.length).toBeGreaterThan(10);
    for (const t of classed) {
      expect(attr(t, "style"), `carries a class but no inline style: ${t.slice(0, 140)}`).not.toBeNull();
    }
    const block = styleBlock(html);
    expect(block.length).toBeGreaterThan(0);
    expect(unexplainedCss(block), "a <style> rule that is not a media query, :root, @import or a [data-ogsc] hook").toBe("");
    expect(Buffer.byteLength(block, "utf8")).toBeLessThan(8 * 1024);
  });
});

/* ---------- images --------------------------------------------------- */

describe("images: every <img> has alt, width, height and an https src", () => {
  forEvery(({ html }) => {
    const imgs = tags(html, "img");
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    for (const img of imgs) {
      expect(attr(img, "alt"), `no alt: ${img}`).toBeTruthy();
      expect(attr(img, "width"), `no width: ${img}`).toMatch(/^\d+$/);
      expect(attr(img, "height"), `no height: ${img}`).toMatch(/^\d+$/);
      expect(attr(img, "src"), `not https: ${img}`).toMatch(/^https:\/\//);
    }
  });
});

/* ---------- links ---------------------------------------------------- */

describe("links: absolute https (or mailto) only", () => {
  forEvery(({ html }) => {
    const refs = [...html.matchAll(/\s(href|src)="([^"]*)"/gi)];
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const m of refs) {
      expect(m[2], `${m[1]}="${m[2]}"`).toMatch(/^(https:\/\/|mailto:)/);
    }
    expect(html).toContain(`href="${BASE}/`);
  });
});

/* ---------- size ------------------------------------------------------ */

describe("size: well under Gmail's clip", () => {
  forEvery(({ html, text }) => {
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(100 * 1024);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(20 * 1024);
  });
});

/* ---------- preheader -------------------------------------------------- */

describe("preheader: the first thing in <body> is a hidden line for the inbox preview", () => {
  forEvery(({ html }) => {
    const m = html.match(/<body[^>]*>\s*(<div[^>]*>)([\s\S]*?)<\/div>/i);
    expect(m, "no hidden <div> right after <body>").toBeTruthy();
    const [, open, inner] = m!;
    expect(open).toContain("display:none");
    expect(open).toContain("mso-hide:all");
    const line = inner.replace(/&nbsp;|&zwnj;/g, "").trim();
    expect(line.length, `preheader too short: "${line}"`).toBeGreaterThanOrEqual(20);
    // the zero-width padding that keeps the client from pulling body text in
    expect(inner).toContain("&zwnj;");
  });
});

/* ---------- the plain-text part -------------------------------------- */

describe("text part: present, readable, no markup", () => {
  forEvery(({ text }) => {
    expect(text.length).toBeGreaterThan(80);
    expect(text).not.toMatch(/<[a-z!/]/i);
    expect(text).not.toMatch(/&(amp|nbsp|lt|gt|quot|#39);/);
    expect(text).toContain("Rempire Store OÜ");
    expect(text).toContain(`${BASE}/`);
    expect(text).not.toMatch(/\n{3,}/);
  });
});

/* ---------- subject --------------------------------------------------- */

describe("subject: one non-empty line in every language", () => {
  forEvery(({ subject }) => {
    expect(subject.trim().length).toBeGreaterThanOrEqual(5);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).not.toMatch(/undefined|NaN|\{[a-z]+\}/);
  });

  for (const template of SAMPLE_TEMPLATES) {
    it(`${template}: three different subjects`, () => {
      const set = new Set(samples().filter((m) => m.template === template).map((m) => m.subject));
      expect(set.size).toBe(3);
    });
  }
});

/* ---------- language --------------------------------------------------- */

describe("language: no Russian left in an ET/EN letter", () => {
  forEvery(({ lang, subject, text, html }) => {
    if (lang === "ru") {
      expect(withoutStyle(html)).toMatch(CYRILLIC_WORD);
      return;
    }
    for (const [what, s] of [
      ["subject", subject],
      ["text", text],
      ["html", withoutStyle(html)],
    ] as const) {
      const hit = s.match(CYRILLIC_WORD);
      expect(hit, `${what} carries Cyrillic: "${hit?.[0]}"`).toBeNull();
    }
  });
});

/* ---------- colour scheme ------------------------------------------- */

describe("colour scheme: declared for light and dark, with a logo that survives a dark card", () => {
  forEvery(({ html }) => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("[data-ogsc]");
    // the body has its own ground, so a force-inverting client never lands on transparent
    expect(html).toMatch(/<body class="em-bg" style="[^"]*background-color:#[0-9a-f]{6}/i);
    const logo = tags(html, "img").find((t) => (attr(t, "src") ?? "").endsWith("/brand/tower-email.png"));
    expect(logo, "the header logo is /brand/tower-email.png").toBeTruthy();
  });

  it("the logo file is the tower on an opaque white tile, drawn at its own proportions", async () => {
    const file = path.join(process.cwd(), "public", "brand", "tower-email.png");
    const meta = await sharp(readFileSync(file)).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha, "a transparent tower vanishes on a dark card").toBe(false);
    const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]], "the top-left pixel is white").toEqual([255, 255, 255]);
    const logo = tags(samples()[0].html, "img").find((t) => (attr(t, "src") ?? "").endsWith("/brand/tower-email.png"))!;
    const ratio = Number(attr(logo, "width")) / Number(attr(logo, "height"));
    expect(Math.abs(ratio - meta.width! / meta.height!)).toBeLessThan(0.01);
  });
});

/* ---------- buttons ---------------------------------------------------- */

describe("buttons: 44 px tall, clickable across their face, and Outlook gets its padding too", () => {
  const WITH_CTA: readonly TemplateId[] = ["order-shipped", "abandoned-cart", "back-in-stock", "gift-card", "birthday"];

  forEvery(({ template, html }) => {
    const anchors = tags(html, "a").filter((t) => (attr(t, "class") ?? "").includes("em-btn-a"));
    if (WITH_CTA.includes(template)) expect(anchors.length, "this letter has a call to action").toBeGreaterThanOrEqual(1);
    for (const a of anchors) {
      const st = attr(a, "style") ?? "";
      expect(st, a).toMatch(/display\s*:\s*block/);
      const pad = st.match(/padding\s*:\s*(\d+)px(?:\s+(\d+)px)?/);
      const lh = st.match(/line-height\s*:\s*(\d+)px/);
      expect(pad, `no padding on the button: ${a}`).toBeTruthy();
      expect(lh, `no line-height on the button: ${a}`).toBeTruthy();
      expect(Number(pad![1]) * 2 + Number(lh![1]), "button height").toBeGreaterThanOrEqual(44);
      expect(attr(a, "href")).toMatch(/^https:\/\//);
    }
    const cells = tags(html, "td").filter((t) => /(^|\s)em-btn(\s|$)/.test(attr(t, "class") ?? ""));
    expect(cells).toHaveLength(anchors.length);
    for (const c of cells) expect(attr(c, "style"), c).toMatch(/mso-padding-alt/);
    // full width on a phone, so a long Estonian label stays on one line
    if (anchors.length) expect(styleBlock(html)).toMatch(/\.em-btn-wrap\{width:100% !important;\}/);
  });
});

/* ---------- what must stay on one line -------------------------------- */

describe("the order table and the prose at 360 px: prices, quantities and numbers never wrap", () => {
  forEvery(({ template, lang, html }) => {
    if (template === "order-confirmed" || template === "abandoned-cart") {
      // every price cell is nowrap; the last one is the bold totals row
      const priceCells = tags(html, "td").filter((t) => /white-space:nowrap/.test(attr(t, "style") ?? ""));
      expect(priceCells.length).toBeGreaterThanOrEqual(3);
      expect(html).toContain("border-top:2px solid");
      // "2 шт" / "2 tk" / "2 pcs" is one word
      const unit = { ru: "шт", et: "tk", en: "pcs" }[lang];
      expect(html).toContain(`2&nbsp;${unit}`);
      // the dots between title, variant and quantity are non-breaking too
      expect(html).toContain("&nbsp;·&nbsp;");
    }
    if (template === "order-shipped") {
      // the tracking code sits in its own panel, never inside a sentence
      expect(html).toMatch(/letter-spacing:4px; color:#[0-9a-f]{6};">CE123456789EE<\/p>/);
    }
    // a price never breaks between the number and the sign
    expect(html).not.toMatch(/\d €/);
  });
});
