/* The blog article body, turned into the HTML a reader sees — one renderer,
   every caller.

   A stored `body` is either HTML from the visual editor or markdown from
   before that editor existed, and `renderPostBody()` is the one place that
   decides which. It sits at the bottom of the file because everything it
   picks between comes first: the small hand-written `markdownToHtml()`, the
   `sanitizeHtml()` allowlist the editor's output is measured against, and
   the `safeUrl()` they both lean on. Each of them keeps the block comment it
   was written with — the four-step safety argument for the markdown door,
   the allowlist and the five reasons it cannot leak a tag for the HTML one.
   Those comments are the audit; they are why this file reads long.

   Two callers, one file. src/lib/blog.ts re-exports the four public
   functions, so the blog API, the admin text route, the request-time page,
   the letters and the tests go on importing them from `@/lib/blog`;
   tools/prerender-shop2.mjs reaches this file through
   tools/lib/blog-export.mjs. The static page and the live one now agree by
   construction rather than by care.

   Plain ESM (.mjs), not TypeScript, on purpose, and for exactly the reason
   src/lib/seo-head.mjs is: the prerender runs as a bare `node` script with
   no loader, and tsconfig's allowJs lets the Next routes and the tests
   import this file unchanged. The parameter types the annotations used to
   carry sit on blog.ts's re-exports instead — that is the boundary where
   TypeScript callers actually need them.

   This was two files until 17.09.2026, kept in step by hand, and «by hand»
   failed twice in the same way: an attribute added to the real sanitiser
   and not to its twin. `data-price` was caught by the person who added it.
   `data-fig` was not — the build had been dropping the owner's chosen
   picture sizes out of every prerendered article since the presets were
   built, so three photos placed «слева», «маленькая» and «во всю ширину»
   came out as three identical full-width ones. Neither drift was a security
   hole (the live API always served the real renderer), which is precisely
   why nothing complained for a whole round. tests/blog-figure-r22.test.ts
   still runs its corpus of bodies through both import paths and demands the
   same bytes from each; it now compares a module with itself, which is the
   point — there is no longer a second copy to drift.

   The third copy is still out there and has to be. `blogCleanHtml()` in
   public/shop2/app.js is this same allowlist written over DOMParser,
   because the browser is where a real Word paste arrives and a script the
   page loads without a build step cannot import this file. That one is a
   deliberate twin; docs/blog.md holds the comparison. */

/* ---------- markdown → safe HTML ------------------------------------------
 *
 * A deliberately small subset, hand-written so there is no dependency to
 * audit: headings (#.. ######), paragraphs, bold (** or __), italic (* or _),
 * [links](url), images (![alt](url)), "- " / "1. " lists, "> " blockquotes.
 * Everything else is not markdown here — it is text, and
 * text is HTML-escaped, never parsed as a tag.
 *
 * Why this is safe against injection (including a prompt-injected assistant
 * reply, since drafts the assistant writes go through this exact renderer
 * the first time a customer opens them):
 *
 *  1. Block structure (heading / quote / list / paragraph) is read off the
 *     RAW line — never off HTML — so escaping never has to "undo" a marker.
 *  2. Every block's own text is HTML-escaped BEFORE any inline markdown
 *     (bold, italic, link, image) is applied. None of the escaped characters
 *     (& < > " ') are markdown syntax, so escaping first cannot break a link
 *     or an emphasis marker, and nothing past that point can introduce a raw
 *     `<`, so no tag other than the ones this function writes can ever
 *     appear.
 *  3. The only attribute values this function builds — `href` and `src` —
 *     are passed through `safeUrl()`, which accepts only `http://`,
 *     `https://`, `mailto:` and a same-site `/path`. `javascript:`, `data:`
 *     and anything else are rejected outright; the original (already
 *     escaped, inert) text is left in place instead.
 *  4. A final pass strips any `<script…>` tag and any `on…=` attribute. Given
 *     1–3 this should never find anything — it exists so a future bug in this
 *     function fails safe instead of failing open, and so this promise is
 *     something a test can assert directly rather than only infer.
 */
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/** http(s), mailto, or a same-site root-relative path. Nothing else. */
function safeUrl(raw) {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\/[^\s<>"']+$/i.test(v)) return v;
  if (/^mailto:[^\s<>"']+$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"']*$/.test(v)) return v; // "/x" but not "//x" (protocol-relative)
  return null;
}

/** Bold, italic, links and images — applied to text that is ALREADY escaped. */
function inline(escaped) {
  let s = escaped;
  // images before links: ![alt](url) would otherwise dangle a bare "!" once
  // the link regex below consumed the [alt](url) part on its own
  s = s.replace(/!\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g, (whole, alt, url) => {
    const u = safeUrl(url);
    return u ? `<img src="${u}" alt="${alt}" loading="lazy">` : whole;
  });
  s = s.replace(/\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g, (whole, text, url) => {
    const u = safeUrl(url);
    if (!u) return whole;
    const ext = /^https?:\/\//i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${u}"${ext}>${text || u}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  return s;
}
function para(text) {
  const t = text.trim();
  return t ? `<p>${inline(escapeHtml(t))}</p>` : "";
}

/* The five shapes parseBlocks() emits, and renderBlock() below reads:
   {kind:"h", level, text}, {kind:"quote", lines}, {kind:"ul", items},
   {kind:"ol", items}, {kind:"p", lines}. This was a union type while the
   renderer lived in blog.ts; it is a comment here for the same reason the
   file is .mjs at all. Nothing outside this file ever sees a block. */

function parseBlocks(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ kind: "h", level: h[1].length, text: h[2] }); i++; continue; }

    if (/^>\s?/.test(line)) {
      const qlines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { qlines.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push({ kind: "quote", lines: qlines });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, "")); i++; }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const plines = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+/.test(lines[i]) &&
           !/^>\s?/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      plines.push(lines[i]); i++;
    }
    blocks.push({ kind: "p", lines: plines });
  }
  return blocks;
}

function renderBlock(b) {
  if (b.kind === "h") {
    const lvl = Math.min(6, Math.max(1, b.level));
    return `<h${lvl}>${inline(escapeHtml(b.text.trim()))}</h${lvl}>`;
  }
  if (b.kind === "quote") return `<blockquote>${para(b.lines.join(" "))}</blockquote>`;
  if (b.kind === "ul" || b.kind === "ol") {
    const tag = b.kind;
    const items = b.items.map((it) => `<li>${inline(escapeHtml(it.trim()))}</li>`).join("");
    return `<${tag}>${items}</${tag}>`;
  }
  return para(b.lines.join(" "));
}

/** A defensive last pass — see the block comment above. Should be a no-op. */
function stripDangerous(html) {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export function markdownToHtml(md) {
  const html = parseBlocks(md).map(renderBlock).filter(Boolean).join("");
  return stripDangerous(html);
}

/* ---------- HTML → safe HTML ----------------------------------------------
 *
 * What the visual editor saves. The admin box is a `contenteditable`, so its
 * output is browser HTML — including whatever a paste from Word or Google
 * Docs dragged in with it. This is the allowlist, and it is the real one:
 * the editor cleans on paste and again on save, but `body` is a plain text
 * column that an old post, an assistant draft or a hand-written API call all
 * write into, so nothing may be trusted about its shape by the time it is
 * read back.
 *
 *   kept, with attributes:  a[href, data-product, data-price]   img[src, alt]
 *                           figure[data-fig]
 *   kept, bare:             p h2 h3 strong em ul ol li blockquote br
 *   unwrapped:              everything else — the tag goes, its text stays
 *                           (a Word paste is mostly <span> and <div>)
 *   dropped with contents:  script, style, iframe, object, embed, svg, …
 *
 * Why this cannot leak a tag or a handler:
 *
 *  1. Nothing is copied through. The output is rebuilt tag by tag from the
 *     table above — an attribute that is not named there (every `on…=`,
 *     `style`, `srcset`, `formaction`) has nowhere to be written.
 *  2. Text between tags is escaped (`<` `>` and a bare `&`; an existing
 *     `&amp;`/`&nbsp;` is left intact rather than doubled), so a `<` that was
 *     text stays text.
 *  3. `href`/`src` go through the same `safeUrl()` the markdown renderer
 *     uses — `http(s)`, `mailto:` or a same-site `/path`, nothing else, so
 *     `javascript:` and `data:` are rejected and the attribute is simply not
 *     written. An `<img>` with no usable src is not written at all.
 *  4. Tags are balanced by this function, not by the input: a close tag with
 *     no matching open is dropped, anything still open at the end is closed
 *     here, and nesting past MAX_DEPTH is unwrapped, so no input can hand the
 *     browser a half-open tag to guess about.
 *  5. `stripDangerous()` runs last, for the same reason it does on markdown.
 */
const HTML_ALLOWED = {
  p: true, h2: true, h3: true, strong: true, em: true, ul: true, ol: true, li: true,
  blockquote: true, figure: true, br: true, a: true, img: true,
};
const HTML_VOID = new Set(["br", "img"]);
/** Tags whose contents are not text — dropped together with what is inside. */
const HTML_DROP = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template",
  "svg", "math", "head", "title", "xml",
]);
/** What a paste means when it uses a tag next to one we allow. */
const HTML_ALIAS = {
  b: "strong", i: "em", h1: "h2", h4: "h3", h5: "h3", h6: "h3",
};
const MAX_DEPTH = 24;

/* A tag, with quoted attribute values allowed to contain ">" — a naive
   /<[^>]*>/ would end `<img alt="a > b">` in the middle of the alt text. */
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
/** A catalogue id, as `<a data-product>` carries it. */
const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
/**
 * How wide a picture inside the text stands, and which side the words run
 * down — the four buttons the editor shows when a picture is tapped
 * (`data-fig` on its `<figure>`; see FIG_PRESETS in public/shop2/app.js and
 * the `.blog__body figure[data-fig]` rules in public/shop2/styles.css).
 *
 * A closed list of four words, not a free string: the value is written into
 * an attribute, so anything outside this set is simply not written and the
 * figure falls back to what every figure did before these presets existed —
 * which is also what an article written before this change carries, since it
 * has no `data-fig` at all. That is the whole backwards-compatibility story:
 * absent means "as it always was", and "full" renders identically to absent.
 */
const FIG_VALUES = new Set(["full", "half-left", "half-right", "small"]);
/** `&` that does not already start an entity — the only one worth escaping. */
const BARE_AMP = /&(?!#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{1,31};)/g;

function escapeText(s) {
  return s.replace(BARE_AMP, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** A URL that already passed safeUrl(): it cannot hold `<`, `>`, a quote or a space. */
function escapeUrlAttr(u) {
  return u.replace(BARE_AMP, "&amp;");
}
/** https, or a picture this shop already serves. Not http: — the shop is https. */
function safeImageUrl(raw) {
  const v = String(raw || "").trim();
  if (/^https:\/\/[^\s<>"']+$/i.test(v)) return v;
  if (/^\/(?!\/)[^\s<>"']*$/.test(v)) return v;
  return null;
}

function parseAttrs(raw) {
  const out = {};
  const s = raw.replace(/\/\s*$/, ""); // the slash of a self-closing <br/>
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) {
    const key = m[1].toLowerCase();
    let v = m[2] || "";
    if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = v;
  }
  return out;
}

/** The open tag to write, or null when there is nothing safe left to write. */
function openTag(name, attrsRaw) {
  if (name !== "a" && name !== "img" && name !== "figure") return `<${name}>`;
  const attrs = parseAttrs(attrsRaw);

  /* The one attribute a figure may carry: which of the four presets the
     owner chose. Checked against the closed list above, so the attribute is
     either one of four known words or not written at all — a bare <figure>
     is exactly what every article before this change holds. */
  if (name === "figure") {
    const fig = String(attrs["data-fig"] || "").trim().toLowerCase();
    return FIG_VALUES.has(fig) ? `<figure data-fig="${fig}">` : "<figure>";
  }

  if (name === "img") {
    const src = safeImageUrl(attrs.src || "");
    if (!src) return null;
    const alt = escapeHtml(String(attrs.alt || "").replace(/\s+/g, " ").trim().slice(0, 160));
    return `<img src="${escapeUrlAttr(src)}" alt="${alt}" loading="lazy">`;
  }

  /* An <a> is two different things here: an ordinary link, and the product
     card the «Товар» button inserts — a marker the storefront swaps for a
     real card, with a plain link to the product as what it degrades to in
     the prerendered page and in a feed reader. */
  let out = "<a";
  const pid = String(attrs["data-product"] || "").trim();
  if (PRODUCT_ID_RE.test(pid)) {
    out += ` data-product="${pid}"`;
    /* …and, since 17.09.2026, whether the price belongs to the marker or to
       the moment it is read. One word, `live`, and nothing else is written —
       the same discipline data-fig is held to. Absent means the old shape:
       the price is literal text inside the <a>, frozen on the day the
       article was written. Both are permanent; see the long note beside
       fillBlogCardPrices() in src/lib/seo-head.mjs for why. */
    if (String(attrs["data-price"] || "").trim().toLowerCase() === "live") out += ' data-price="live"';
  }
  const href = attrs.href ? safeUrl(attrs.href) : null;
  if (href) {
    out += ` href="${escapeUrlAttr(href)}"`;
    if (/^https?:\/\//i.test(href)) out += ' target="_blank" rel="noopener noreferrer"';
  }
  return out === "<a" ? null : `${out}>`;
}

/** Everything up to (and including) `</name>`, or the end of the input. */
function skipElement(src, from, name) {
  const close = new RegExp(`</${name}\\s*>`, "i");
  const rest = src.slice(from);
  const m = close.exec(rest);
  return m ? from + m.index + m[0].length : src.length;
}

export function sanitizeHtml(input) {
  const src = String(input || "");
  const out = [];
  const stack = [];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { out.push(escapeText(src.slice(i))); break; }
    if (lt > i) out.push(escapeText(src.slice(i, lt)));

    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith("<!", lt) || src.startsWith("<?", lt)) { const e = src.indexOf(">", lt); i = e < 0 ? src.length : e + 1; continue; }

    const m = TAG_RE.exec(src.slice(lt));
    if (!m) { out.push("&lt;"); i = lt + 1; continue; } // a bare "<" in the text
    i = lt + m[0].length;

    const closing = m[1] === "/";
    const raw = m[2].toLowerCase();
    const name = HTML_ALIAS[raw] || raw;

    if (HTML_DROP.has(raw)) {
      if (!closing) i = skipElement(src, i, raw);
      continue;
    }
    if (!HTML_ALLOWED[name]) continue; // unwrapped: the tag goes, its text stays

    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at < 0) continue; // a close with no open — nothing to close
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (HTML_VOID.has(name)) {
      const tag = openTag(name, m[3]);
      if (tag) out.push(tag);
      continue;
    }
    if (stack.length >= MAX_DEPTH) continue;
    const tag = openTag(name, m[3]);
    if (!tag) continue;
    out.push(tag);
    stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return stripDangerous(out.join(""));
}

/**
 * Is this body HTML from the visual editor, or markdown from before it?
 *
 * HTML as soon as it holds one tag of the kind the editor's box itself
 * writes — a paragraph, a line break, a <div>, a heading, a list, a quote,
 * a picture or its <figure> — anywhere in it. Until 24.09.2026 only a body
 * that OPENED with a block tag counted, and the box's own HTML often does
 * not: the first line typed into an empty box is a bare text node, Enter
 * makes a <div>. «A line of text, then a picture» was read as markdown and
 * escaped, and the article showed its own HTML source with the picture gone
 * into it (Dim on /test, «blog-new-post»). The panel now lays the box out in
 * paragraphs before it saves (blogBoxToBody() in public/shop2/app.js), and
 * this is the same rule, so a body some other writer left starting with bare
 * words is still read as what it is. `BLOG_HTML_TAG` in app.js is this very
 * pattern — tests/blog-inline-picture.test.ts holds the two together.
 *
 * Still narrow where it matters: a markdown body that merely contains a
 * pasted `<script>` (or any tag the editor never writes) is not mistaken for
 * HTML — it belongs in `markdownToHtml()`, which escapes it as the text it
 * is. Getting this wrong either way is a wrong-looking article, never an
 * unsafe one: both branches end in an allowlist.
 */
const HTML_BODY_RE = /<(?:p|div|figure|img|br|h[1-6]|ul|ol|li|blockquote)(?:\s[^>]*)?\/?>/i;
export function looksLikeHtmlBody(body) {
  return HTML_BODY_RE.test(String(body || ""));
}

/** The one place a stored body becomes the HTML a reader sees. */
export function renderPostBody(body) {
  const src = String(body || "");
  return looksLikeHtmlBody(src) ? sanitizeHtml(src) : markdownToHtml(src);
}
