/* Comments and indentation out of a hand-written script, nothing else.
   Used by tools/minify-shop2.mjs to build public/shop2/app.min.js — the file
   the shop actually downloads — out of public/shop2/app.js, the file people
   read and edit.

   ---- why this exists rather than a minifier off npm ---------------------

   public/shop2/app.js is 1.92 MB of source, a quarter of it comment prose,
   and it is one plain <script src> at the bottom of the shell: nothing in the
   storefront and nothing in the admin panel exists until the browser has
   pulled, parsed and run the whole of it. Measured on 09.09.2026, brotli -q11:

     as committed                        398 951 B
     comments and indentation out        246 306 B   −38 %
     a full minifier (names mangled)     223 010 B   −44 %

   The last six points cost name mangling and AST rewriting over 28 000 lines
   of hand-written code that no type checker covers, plus a build dependency.
   This tool buys 87 % of that win with a transform whose worst failure mode
   is a file that will not parse — which the build refuses to write.

   ---- why the newlines stay ----------------------------------------------

   Nothing here joins two lines. Automatic semicolon insertion means a line
   break can be a statement terminator, and this file is full of places where
   it is one; a whitespace pass that removes line breaks has to understand
   every one of them, and that is a parser's job, not a stripper's. Keeping
   the breaks makes the transform provably behaviour-preserving:

     · a line comment goes, up to but not including its newline;
     · a block comment spanning lines becomes ONE newline, because such a
       comment is itself a line terminator for ASI — a `return` with a
       two-line comment behind it already returns undefined — and anything
       else would change what the parser sees;
     · a block comment on one line becomes one space, because it is NOT a line
       terminator and a newline there would insert a semicolon that was not in
       the source;
     · leading and trailing blank space goes, and a line left empty goes with
       it — the neighbours keep the newline between them either way.

   Lines inside a template literal are left exactly as they are: their spaces
   are text the shop prints.

   ---- the scanner --------------------------------------------------------

   Strings, template literals, regex literals and comments, verbatim. Same
   shape as the tokeniser in tools/i18n-gaps.mjs, which has read this very
   file for months — the difference is that this one hands back the source
   slice untouched, because it is going to be written back out. */

/** Tokens, in source order, each holding its verbatim slice. Concatenating
    every `v` reproduces the input byte for byte. */
export function scan(src) {
  const out = [];
  let i = 0;
  let from = 0;
  const flush = (end) => { if (end > from) out.push({ t: "code", v: src.slice(from, end) }); };

  /* Can a `/` here open a regex literal, or is it division? Decided on the
     last significant character before it — the same test i18n-gaps.mjs makes.
     Getting it wrong on a regex whose body holds `//` or `/*` would strip
     part of the pattern, so minify-shop2.mjs re-reads its own output and
     refuses to write a file whose literals are not the source's literals. */
  const regexAllowed = (upto) => {
    let c = src.slice(from, upto).replace(/\s+$/, "");
    if (!c) {
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k].t === "comment") continue;
        if (out[k].t !== "code") return false;   // a string cannot precede a regex
        const prev = out[k].v.replace(/\s+$/, "");
        if (!prev) continue;
        c = prev;
        break;
      }
      if (!c) return true;
    }
    const last = c[c.length - 1];
    if ("(,=:[!&|?{};+-*%~^<>".includes(last)) return true;
    return /\b(return|typeof|instanceof|in|of|new|delete|void|throw|do|else|case|yield|await)$/.test(c);
  };

  while (i < src.length) {
    const c = src[i];

    if (c === "/" && src[i + 1] === "/") {
      flush(i);
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      out.push({ t: "comment", v: src.slice(i, j) });
      i = from = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      flush(i);
      let j = i + 2;
      while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, src.length);
      out.push({ t: "comment", v: src.slice(i, j) });
      i = from = j;
      continue;
    }
    if (c === '"' || c === "'") {
      flush(i);
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, src.length);
      out.push({ t: "str", v: src.slice(i, j) });
      i = from = j;
      continue;
    }
    if (c === "`") {
      flush(i);
      let j = i + 1;
      while (j < src.length && src[j] !== "`") { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, src.length);
      out.push({ t: "tpl", v: src.slice(i, j) });
      i = from = j;
      continue;
    }
    if (c === "/" && regexAllowed(i)) {
      let j = i + 1, cls = false, ok = false;
      for (; j < src.length; j++) {
        const d = src[j];
        if (d === "\\") { j++; continue; }
        if (d === "\n") break;
        if (d === "[") cls = true;
        else if (d === "]") cls = false;
        else if (d === "/" && !cls) { ok = true; break; }
      }
      if (ok) {
        flush(i);
        j++;
        while (j < src.length && /[a-z]/.test(src[j])) j++;
        out.push({ t: "rx", v: src.slice(i, j) });
        i = from = j;
        continue;
      }
    }
    i++;
  }
  flush(src.length);
  return out;
}

/** Every literal the scanner found, in order — a string, template or regex
    slice, verbatim. Two sources with the same list run on the same data; it
    is what minify-shop2.mjs compares source against output. */
export function literals(src) {
  return scan(src).filter((t) => t.t !== "code" && t.t !== "comment").map((t) => t.v);
}

/**
 * The script with its comments and its indentation gone. CRLF in, LF out:
 * the working tree of this repository is CRLF (core.autocrlf=true) and
 * Vercel's builder is LF, and the two have to write the same bytes or the
 * asset token disagrees with itself across machines — see the line-ending
 * note in tools/lib/asset-token.mjs.
 */
export function stripJs(source) {
  const src = String(source).replace(/\r\n?/g, "\n");

  let out = "";
  for (const t of scan(src)) {
    if (t.t !== "comment") { out += t.v; continue; }
    if (t.v.startsWith("//")) continue;
    out += t.v.includes("\n") ? "\n" : " ";
  }

  /* Which lines a template literal runs through — counted on the stripped
     text, not on the source, because dropping the comments has already moved
     every line number. Their leading spaces are text the shop prints. */
  const keep = new Set();
  let line = 1;
  for (const t of scan(out)) {
    const breaks = (t.v.match(/\n/g) || []).length;
    if (t.t === "tpl" && breaks) for (let k = 0; k <= breaks; k++) keep.add(line + k);
    line += breaks;
  }

  return out
    .split("\n")
    .map((l, k) => (keep.has(k + 1) ? l : l.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "")))
    .filter((l, k) => l !== "" || keep.has(k + 1))
    .join("\n");
}
