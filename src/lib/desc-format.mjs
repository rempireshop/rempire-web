/* A product description as the owner writes it — plain text with a light
   markup — and as the shop shows it: section headings in bold and real
   lists (Dim, 02.11.2026; design: canvas-banner/project/Desc.dc.html).

   The texts imported from Shopify are HTML and already look like that
   («ПРЕИМУЩЕСТВА:» in bold, a bullet list under it). Everything written
   since — in the panel by hand, by its AI buttons, by «Помощник», by
   Renat's Claude (save_product_description) — is stored as PLAIN TEXT and
   was drawn as flat paragraphs. Nothing is converted in the database: the
   text stays as it was typed, and this renderer reads the structure that is
   already in it.

   ---- the format ---------------------------------------------------------
   · Paragraphs are separated by an empty line; a line break inside one is a
     line break on the page.
   · A HEADING is a line of its own, at most DESC_HEAD_MAX characters, that
     ends with «:» — «Преимущества:», «Применение:», «Ключевые ингредиенты:»,
     «Состав (INCI):», «Eelised:», «Benefits:». Not one with text after the
     colon, not one with a sentence break or a second colon inside it, not
     one of more than DESC_HEAD_WORDS words. It is drawn in bold, colon kept
     — exactly the shape of the imported texts' <p><strong>ПРЕИМУЩЕСТВА:</strong></p>,
     so a page reads the same whichever kind of text it has, and the colon
     keeps the heading a heading in every plain-text copy (meta description,
     JSON-LD, the Merchant feed).
   · A LABEL — «Объём: 30 мл», «Аромат: свежий бергамот…», «Как использовать:
     нанесите…» — is NOT a heading: the colon has text after it on the same
     line. Decided 02.11.2026: the label is drawn in bold («**Объём:** 30 мл»),
     because it reads like the imported texts' «<strong>Масло для бороды</strong>:
     ухаживает…». Only a real label is: it starts with a capital letter, has
     at most DESC_LABEL_WORDS words and DESC_LABEL_MAX characters, and holds
     no sentence punctuation — so a sentence that happens to contain a colon
     («Подходит для: сухих волос» aside) is left as it is.
   · A BULLET is a line starting with «— », «- », «– » or «• » (a dash and a
     space; «•» is what «Написать черновик» wrote until 02.11.2026).
     Consecutive bullet lines are one list.
   · An IMPLICIT LIST — the rule this file was asked to decide. Real texts
     list their points under a heading as plain lines with no dash at all:
     proraso-beard-oil-azur-lime-30ml has «Преимущества:», an empty line, and
     nine lines «для длинной и густой бороды», «усмиряет и разглаживает
     бороду», … The lines right after a heading (in the heading's own
     paragraph, or — when the heading ends its paragraph — the next
     paragraph) are a list when ALL of these hold:
       – there are at least two of them;
       – none ends with a full stop (or «!», «?», «…») and none has a
         sentence break inside it — sentences are prose, points are not;
       – none is longer than DESC_ITEM_MAX characters (the longest real
         point, «без парабенов, фталатов, силиконов, минеральных масел,
         искусственных красителей и SLS», is 85; the Estonian one 90);
       – none is itself a heading.
     All or nothing: one sentence among them and the block stays lines of a
     paragraph, as it was drawn before. Lines without a heading above them
     are never guessed into a list.
   · **word** is bold inside a sentence. A heading wrapped in it
     («**Преимущества:**») is still a heading.
   · Everything is escaped. Nothing in the stored text ever reaches the page
     as markup: this is a renderer of the four marks above, not an HTML
     passthrough — «<script>» and «**<img onerror>**» are shown as text.

   ---- one block, every renderer -------------------------------------------
   The product page in the browser (public/shop2/app.js descOvHtml(), the
   panel's «Как в магазине» preview), the static product pages
   (tools/prerender-shop2.mjs) and the request-time page of a product the
   owner made (src/lib/product-page.ts) draw the same HTML from the same
   text, so taking over a static page moves nothing. app.js is a plain ES5
   script and cannot import, so everything between the two `desc-format`
   markers is copied into it byte for byte — written the way app.js is (var,
   function, two spaces of indent, no arrow, no template literal) and
   reading nothing from its surroundings. tests/desc-format.test.ts fails
   when the two copies differ, and so does the prerender.

   EDIT HERE, then copy the block into app.js (the Edit tool — app.js is
   CRLF in a Windows checkout; `node tools/sync-desc-format.mjs --check`
   says whether the copies agree).

   descPlain() is the other half: the text with the marks taken out — «**»
   gone, headings and bullets left as the words they are — for every place
   that is plain text (the Merchant feed, the search index, a Google-text
   prompt). It is the identity on a text with no «**», so nothing that was
   already plain changes by passing through it. */

/* desc-format:start */
  var DESC_HEAD_MAX = 60;
  var DESC_HEAD_WORDS = 8;
  var DESC_LABEL_MAX = 32;
  var DESC_LABEL_WORDS = 4;
  var DESC_ITEM_MAX = 120;
  var DESC_UPPER = "A-ZÀ-ÖØ-ÞŠŽА-ЯЁ";
  var DESC_LETTER = /[A-Za-zÀ-ÖØ-öø-ɏЀ-ӿ]/;
  var DESC_BULLET = /^[-–—•]\s+/;
  var DESC_BOLD = /\*\*(?=\S)([^\n]*?\S)\*\*/g;
  var DESC_LABEL = new RegExp("^([" + DESC_UPPER + "][^.!?;,:«»\"*]{0," + (DESC_LABEL_MAX - 1) + "}):[ \\t]+(\\S.*)$");

  function descEsc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function descWords(s) { return String(s).trim().split(/\s+/).length; }
  /** «Преимущества:» → "Преимущества" — the heading's words without the colon — or null for a line that is not one. */
  function descHeading(line) {
    var t = String(line).trim();
    var wrapped = /^\*\*([^*]+)\*\*(:?)$/.exec(t);
    if (wrapped) t = wrapped[1].trim() + wrapped[2];
    if (t.length > DESC_HEAD_MAX || t.charAt(t.length - 1) !== ":") return null;
    var w = t.slice(0, -1).replace(/\*\*/g, "").trim();
    if (!w || !DESC_LETTER.test(w) || w.indexOf(":") >= 0 || DESC_BULLET.test(w)) return null;
    if (/[.!?…]\s/.test(w) || descWords(w) > DESC_HEAD_WORDS) return null;
    return w;
  }
  /** A line that reads as a point of a list, not as a sentence (the implicit-list rule above). */
  function descItemLike(line) {
    var t = String(line).trim();
    return !!t && t.length <= DESC_ITEM_MAX && !/[.!?…]$/.test(t) && !/[.!?…]\s+\S/.test(t) && descHeading(t) === null;
  }
  /** One line's words: escaped, **bold** made bold, a leading label («Объём: 30 мл») in bold. */
  function descInline(s) { return descEsc(s).replace(DESC_BOLD, "<strong>$1</strong>"); }
  function descLineHtml(line) {
    var m = DESC_LABEL.exec(line);
    if (m && descWords(m[1]) <= DESC_LABEL_WORDS) return "<strong>" + descEsc(m[1]) + ":</strong> " + descInline(m[2]);
    return descInline(line);
  }
  /** The text as blocks: { k: "p", lines }, { k: "h", text }, { k: "ul", items } — in order. */
  function descBlocks(text) {
    var paras = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
    var out = [], afterHead = false;
    for (var i = 0; i < paras.length; i++) {
      var lines = paras[i].split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) continue;
      var k = 0, p = [], ul = [];
      var plainRun = function (from) {
        var run = [];
        for (var r = from; r < lines.length && !DESC_BULLET.test(lines[r]) && descHeading(lines[r]) === null; r++) run.push(lines[r]);
        return run.length >= 2 && run.every(descItemLike) ? run : null;
      };
      var flush = function () {
        if (p.length) out.push({ k: "p", lines: p });
        if (ul.length) out.push({ k: "ul", items: ul });
        p = []; ul = [];
      };
      if (afterHead) {
        var first = plainRun(0);
        if (first) { out.push({ k: "ul", items: first }); k = first.length; }
      }
      afterHead = false;
      for (; k < lines.length; k++) {
        var line = lines[k], h = descHeading(line);
        if (DESC_BULLET.test(line)) {
          if (p.length) { out.push({ k: "p", lines: p }); p = []; }
          ul.push(line.replace(DESC_BULLET, ""));
        } else if (h !== null) {
          flush();
          out.push({ k: "h", text: h });
          var run = plainRun(k + 1);
          if (run) { out.push({ k: "ul", items: run }); k += run.length; }
          else if (k === lines.length - 1) afterHead = true;
        } else {
          if (ul.length) { out.push({ k: "ul", items: ul }); ul = []; }
          p.push(line);
        }
      }
      flush();
    }
    return out;
  }
  /** The owner's text as the page shows it — <p>, <p class="desc-h"><strong>…:</strong></p>, <ul><li>. */
  function descHtml(text) {
    return descBlocks(text).map(function (b) {
      if (b.k === "h") return '<p class="desc-h"><strong>' + descEsc(b.text) + ":</strong></p>";
      if (b.k === "ul") return "<ul>" + b.items.map(function (x) { return "<li>" + descLineHtml(x) + "</li>"; }).join("") + "</ul>";
      return "<p>" + b.lines.map(descLineHtml).join("<br>") + "</p>";
    }).join("");
  }
  /** The text with its marks taken out — «**» gone, headings and bullets left as words — for plain-text copies. */
  function descPlain(text) {
    return String(text == null ? "" : text).replace(DESC_BOLD, "$1").replace(/\*\*/g, "");
  }
/* desc-format:end */

export {
  DESC_HEAD_MAX, DESC_HEAD_WORDS, DESC_LABEL_MAX, DESC_LABEL_WORDS, DESC_ITEM_MAX,
  descEsc, descHeading, descItemLike, descLineHtml, descBlocks, descHtml, descPlain,
};
