/* The block of src/lib/seo-copy.mjs that public/shop2/app.js carries byte for
   byte — everything between the two marker lines below, which both files
   hold at the start of a line. See the header of src/lib/seo-copy.mjs for why
   there are two copies at all.

   Used by tools/sync-seo-copy.mjs (which writes app.js's copy), by
   tools/prerender-shop2.mjs (which refuses to write pages while the two
   differ) and by tests/seo-copy.test.ts. Line endings are not part of the
   comparison: app.js is CRLF in a Windows checkout and LF in git. */

export const SEO_COPY_START = "/* seo-copy:start */";
export const SEO_COPY_END = "/* seo-copy:end */";

/** The lines between the markers, joined with "\n" — or null when a marker is missing. */
export function seoCopyBlock(text) {
  const lines = String(text).split(/\r?\n/);
  const a = lines.indexOf(SEO_COPY_START);
  const b = lines.indexOf(SEO_COPY_END, a + 1);
  if (a < 0 || b < 0) return null;
  return lines.slice(a + 1, b).join("\n");
}

/**
 * `target` with the block between its markers replaced by `block`, written
 * with the target's own line ending throughout — one CR too many or too few
 * and git stores the whole of app.js the other way (docs: «lone CR»).
 */
export function spliceSeoCopyBlock(target, block) {
  const src = String(target);
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const a = lines.indexOf(SEO_COPY_START);
  const b = lines.indexOf(SEO_COPY_END, a + 1);
  if (a < 0 || b < 0) throw new Error("the target has no " + SEO_COPY_START + " … " + SEO_COPY_END + " block");
  const body = String(block).split(/\r?\n/);
  return [...lines.slice(0, a + 1), ...body, ...lines.slice(b)].join(eol);
}
