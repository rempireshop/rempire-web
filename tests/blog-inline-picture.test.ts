/**
 * A picture inside an article's text, all the way round: the box → the save
 * → the row → the editor again → the published page.
 *
 * Dim on /test («blog-new-post», «bad», 24.09.2026): «When I add an image to
 * the text, save a draft and then re-open the blog post, then the image
 * disappears and everything becomes html.»
 *
 * What happened: the save asked of the box's HTML the question the loader
 * asks of a STORED body — «is this HTML, or markdown from before the visual
 * editor?» — and answered it by whether the text OPENED with a block tag. The
 * box's own HTML often does not: the first line typed into an empty box is a
 * bare text node, and Enter makes a <div>. So «a line, then a picture» went
 * through the markdown renderer, which escapes every tag into text: the row
 * held `<p>Первая строка&lt;figure …&gt;&lt;img …&gt;…</p>`, and the editor,
 * the API and the shop all showed that — the HTML source, no picture.
 *
 * The panel's half runs here sliced out of public/shop2/app.js (the way
 * tests/blog-panel-shop.test.ts does it), over a small DOMParser stand-in —
 * the cleaner reads nodeType, tagName, nodeValue, childNodes and getAttribute
 * and nothing more. The server's half is the real module and PGlite.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPostById, getPublishedBySlug, looksLikeHtmlBody, pickLang, publishPost, renderPostBody, sanitizeHtml, upsertPost } from "@/lib/blog";
import { exec } from "@/lib/db";
import { renderPostBody as exportRenderPostBody } from "../tools/lib/blog-export.mjs";
import { setupDb, teardownDb } from "./helpers";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

/** `function <name>(…) { … }` out of app.js, by brace matching. */
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
/** `var <name> = …;` — a pattern, which is one line (a `;` inside `&lt;` would fool the table reader below). */
function sliceLine(name: string): string {
  const start = src.indexOf(`  var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  return src.slice(start, src.indexOf("\n", start));
}
/** `var <name> = { … };` — a table, over as many lines as it takes. */
function sliceVar(name: string): string {
  const start = src.indexOf(`  var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`no terminating ; for var ${name} in app.js`);
}

/* ---------- a DOMParser, as much of one as the cleaner reads -------------- */

type Node = {
  nodeType: number;
  tagName?: string;
  nodeValue?: string;
  childNodes: Node[];
  attrs?: Record<string, string>;
  getAttribute?: (k: string) => string | null;
};
const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "wbr", "source"]);
const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return NAMED[e.toLowerCase()] ?? whole;
  });
}
function element(tag: string, attrs: Record<string, string> = {}): Node {
  return { nodeType: 1, tagName: tag.toUpperCase(), childNodes: [], attrs, getAttribute: (k) => (k in attrs ? attrs[k] : null) };
}
function parseBody(html: string): Node {
  const body = element("body");
  const stack: Node[] = [body];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("<!--")) continue;
    if (m[2] === undefined) { top.childNodes.push({ nodeType: 3, nodeValue: decode(m[0]), childNodes: [] }); continue; }
    const tag = m[2].toLowerCase();
    if (tag === "body" || tag === "html") continue;
    if (m[1] === "/") {
      const at = stack.map((n) => n.tagName).lastIndexOf(tag.toUpperCase());
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
      let v = a[2] ?? "";
      if (/^["']/.test(v)) v = v.slice(1, -1);
      attrs[a[1].toLowerCase()] = decode(v);
    }
    const el = element(tag, attrs);
    top.childNodes.push(el);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(el);
  }
  return body;
}
class DOMParser {
  parseFromString(html: string): { body: Node } {
    return { body: parseBody(html) };
  }
}

/* ---------- the panel's half, out of app.js ------------------------------- */

type Tri = { RU: string; ET: string; EN: string };
type Panel = {
  boxToBody: (html: string) => string;
  bodyToHtml: (stored: string) => string;
  oldSave: (box: string) => string;
  payload: (d: Record<string, unknown>) => { body: Tri };
  draftFromPost: (p: Record<string, unknown>) => { body: Tri };
  newDraft: () => Record<string, unknown> & { body: Tri; title: Tri };
  HTML_TAG: RegExp;
};
const panel = new Function(
  "DOMParser",
  [
    slice("esc"),
    sliceVar("BLOG_TAGS"), sliceVar("BLOG_ALIAS"), sliceVar("BLOG_FIG"), sliceVar("BLOG_DROP_EMPTY"),
    sliceVar("BLOG_TAGS_DROP"), sliceLine("BLOG_PRODUCT_ID"), sliceVar("BLOG_MAX_DEPTH"), sliceVar("BLOG_EMPTY3"),
    slice("blogFigOf"), slice("blogLivePrice"), slice("blogImgUrl"), slice("blogSafeUrl"),
    "function blogProductHTML() { return ''; }",
    slice("blogCleanNodes"), slice("blogCleanNode"), slice("blogCleanHtml"),
    slice("blogInline"), slice("blogPara"), slice("blogMdToHtml"),
    sliceLine("BLOG_HTML_TAG"), sliceLine("BLOG_ESCAPED"), slice("blogUnescapeBody"), slice("blogBodyToHtml"),
    sliceVar("BLOG_TOP_BLOCKS"), sliceVar("BLOG_TOP_WRAPS"), slice("blogBlocksOf"), slice("blogBoxToBody"),
    slice("blogBody3ToHtml"), slice("blogNewDraft"), slice("blogDraftFromPost"), slice("blogFieldsPayload"),
    `return {
      boxToBody: blogBoxToBody, bodyToHtml: blogBodyToHtml,
      // what «Сохранить» stored until 24.09.2026 for a box that did not open with a block tag
      oldSave: function (box) { return blogCleanHtml(blogMdToHtml(box)); },
      payload: blogFieldsPayload, draftFromPost: blogDraftFromPost, newDraft: blogNewDraft,
      HTML_TAG: BLOG_HTML_TAG
    };`,
  ].join("\n"),
)(DOMParser) as Panel;

/* A photo from the phone, as uploadPhoto(…, "blog") answers it: the bucket's
   public https address (src/lib/storage.ts publicUrl). */
const R2 = "https://media.rempireshop.com/blog/1758700000000-9f3a2c.webp";
const FIG = `<figure data-fig="full"><img src="${R2}" alt="" loading="lazy"></figure>`;
/** What the box holds after «Первая строка», then «Картинка» → «Загрузить картинку». */
const BOX = `Первая строка${FIG}<p><br></p>`;

describe("the save: the box's HTML is laid out in blocks, never read as markdown", () => {
  it("a line typed into the empty box, then a picture: a paragraph and the picture", () => {
    expect(panel.boxToBody(BOX)).toBe(`<p>Первая строка</p>${FIG}`);
  });

  it("is what «Сохранить» sends", () => {
    const d = panel.newDraft();
    d.title.RU = "Статья с картинкой";
    d.body.RU = BOX;
    const sent = panel.payload(d).body.RU;
    expect(sent).toContain(`<img src="${R2}" alt="" loading="lazy">`);
    expect(sent, "the picture was saved as escaped text").not.toContain("&lt;");
    // …and what it sends opens with a block tag, so every reader after it agrees
    expect(sent.startsWith("<p>")).toBe(true);
  });

  it("Chrome's <div> per line becomes a paragraph per line — the lines are not glued together", () => {
    expect(panel.boxToBody("Первая<div>Вторая</div><div><br></div><div>Третья</div>"))
      .toBe("<p>Первая</p><p>Вторая</p><p>Третья</p>");
    expect(panel.boxToBody("<div>Одна<div>Вложенная</div></div>")).toBe("<p>Одна</p><p>Вложенная</p>");
  });

  it("words in the box are words: an ampersand and asterisks stay as typed", () => {
    expect(panel.boxToBody("Tom &amp; Jerry *не курсив*")).toBe("<p>Tom &amp; Jerry *не курсив*</p>");
  });

  it("a body that already is blocks comes out the same", () => {
    const body = `<h2>Раздел</h2><p>Абзац с <strong>важным</strong> словом.</p>${FIG}<ul><li>раз</li><li>два</li></ul>`;
    expect(panel.boxToBody(body)).toBe(body);
  });

  it("a picture or a product card standing loose is kept, in a paragraph of its own", () => {
    expect(panel.boxToBody(`<img src="${R2}" alt="">`)).toBe(`<p><img src="${R2}" alt="" loading="lazy"></p>`);
    expect(panel.boxToBody('Текст<a data-product="x-1" data-price="live" href="/shop2/p/x-1/"></a>'))
      .toBe('<p>Текст<a data-product="x-1" data-price="live" href="/shop2/p/x-1/"></a></p>');
  });

  it("still through the allowlist: a data: or http: picture and a script are not written", () => {
    const out = panel.boxToBody('Текст<img src="data:image/png;base64,AAAA"><img src="http://x.ee/a.jpg"><script>alert(1)</script>');
    expect(out).toBe("<p>Текст</p>");
  });
});

describe("the open: a stored body goes into the box as the article, not as its source", () => {
  it("a body some writer left starting with bare words is still HTML", () => {
    const html = panel.bodyToHtml(BOX);
    expect(html).toBe(`<p>Первая строка</p>${FIG}`);
  });

  it("an article the old save already broke opens repaired — the picture is back", () => {
    const broken = panel.oldSave(BOX);
    // the shape Dim's draft is in: its own markup, escaped into one paragraph
    expect(broken).toMatch(/^<p>Первая строка&lt;figure data-fig=&quot;full&quot;&gt;&lt;img src=&quot;https:/);
    expect(panel.bodyToHtml(broken)).toBe(`<p>Первая строка</p>${FIG}`);
    expect(panel.draftFromPost({ id: "p", body: { RU: broken } }).body.RU).toContain(`<img src="${R2}"`);
  });

  it("a paragraph that only talks about tags next to real markup is left as words", () => {
    const body = "<p>Тег &lt;p&gt; делает абзац.</p><p>Второй.</p>";
    expect(panel.bodyToHtml(body)).toBe(body);
  });

  it("an article written in markdown before the editor still opens as markdown", () => {
    expect(panel.bodyToHtml(`## Раздел\n\nАбзац с ![фото](${R2})`))
      .toBe(`<h2>Раздел</h2><p>Абзац с <img src="${R2}" alt="фото" loading="lazy"></p>`);
  });
});

describe("the server reads a body by the same rule", () => {
  it("renderPostBody keeps the picture of a body that starts with bare words", () => {
    expect(looksLikeHtmlBody(BOX)).toBe(true);
    const html = renderPostBody(BOX);
    expect(html).toContain(`<figure data-fig="full"><img src="${R2}" alt="" loading="lazy"></figure>`);
    expect(html).not.toContain("&lt;");
  });

  it("the sanitiser keeps an inline picture from the bucket, with its size, and nothing but https or the shop's own", () => {
    for (const fig of ["full", "half-left", "half-right", "small"]) {
      const body = `<p>Текст</p><figure data-fig="${fig}"><img src="${R2}" alt="Паста"></figure>`;
      expect(sanitizeHtml(body)).toBe(`<p>Текст</p><figure data-fig="${fig}"><img src="${R2}" alt="Паста" loading="lazy"></figure>`);
    }
    expect(sanitizeHtml('<p><img src="/shop/img/night-rider-0.webp" alt=""></p>')).toContain('src="/shop/img/night-rider-0.webp"');
    for (const bad of ["http://x.ee/a.jpg", "data:image/png;base64,AAAA", "blob:https://x/1", "javascript:alert(1)", "//evil/x.jpg"]) {
      expect(sanitizeHtml(`<p><img src="${bad}"></p>`), bad).not.toContain("<img");
    }
  });

  it("markdown, and markdown that merely holds a pasted <script>, are still markdown", () => {
    expect(looksLikeHtmlBody("## Раздел\n\nАбзац.")).toBe(false);
    expect(looksLikeHtmlBody("<script>alert(1)</script>\n\nОбычный абзац.")).toBe(false);
    expect(looksLikeHtmlBody("Строка <strong>жирным</strong>")).toBe(false);
  });

  it("the panel and the server share one pattern", () => {
    const server = readFileSync(fileURLToPath(new URL("../src/lib/blog-html.mjs", import.meta.url)), "utf8");
    const re = server.match(/const HTML_BODY_RE = (\/.+\/[a-z]*);/);
    expect(re, "HTML_BODY_RE is no longer one literal in blog-html.mjs").not.toBeNull();
    expect(String(panel.HTML_TAG)).toBe(re![1]);
  });
});

/* ---------- the whole trip, through the row ------------------------------- */

describe("save → reopen → publish keeps the picture", () => {
  beforeAll(async () => { await setupDb(); });
  afterAll(teardownDb);
  beforeEach(async () => { await exec("truncate posts restart identity"); });

  it("in the row, in the editor again, in the API the shop reads and in the prerender", async () => {
    const d = panel.newDraft();
    d.title.RU = "Статья с картинкой";
    d.body.RU = BOX;
    const saved = await upsertPost(panel.payload(d) as never);

    const row = await getPostById(saved.id);
    expect(row!.body.RU).toContain(`<img src="${R2}"`);

    // «re-open»: the editor's own reading of what GET /api/admin/blog/?id= answers
    const reopened = panel.draftFromPost(JSON.parse(JSON.stringify(row)));
    expect(reopened.body.RU).toBe(`<p>Первая строка</p>${FIG}`);
    // …and saved again untouched, it is the same article
    expect(panel.payload({ ...d, body: reopened.body }).body.RU).toBe(reopened.body.RU);

    await publishPost(saved.id);
    const live = await getPublishedBySlug(saved.slug);
    const shown = renderPostBody(pickLang(live!.body, "RU"));
    expect(shown).toContain(`<img src="${R2}" alt="" loading="lazy">`);
    expect(shown).not.toContain("&lt;");
    expect(exportRenderPostBody(pickLang(live!.body, "RU")), "the prerender reads it differently").toBe(shown);

    const { GET } = await import("@/app/api/blog/[slug]/route");
    const res = await GET(new Request(`https://rempireshop.com/api/blog/${saved.slug}/`), { params: Promise.resolve({ slug: saved.slug }) });
    const body = (await res.json()) as { post: { bodyHtml: string } };
    expect(body.post.bodyHtml).toContain(`<img src="${R2}"`);
  });
});
