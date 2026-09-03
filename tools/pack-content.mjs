/* Writes src/data/content.default.json from DEFAULT_CONTENT in
   src/lib/content.ts, so plain-Node tools — tools/prerender-shop2.mjs above
   all — can read the shop's own identity, socials and contact copy without a
   TypeScript loader. Runs in `prebuild`, before the prerender; idempotent.

   Why a generated file and not a second copy typed by hand: the prerendered
   pages print the company details and the Organization `sameAs` links, and
   until now both were hard-coded in the tool. They had already drifted —
   the tool published instagram.com/rempireshop/ while the shop links
   instagram.com/rempire.shop/ (docs/seo.md, "Known gaps"). One source, and
   `npm run build` regenerates it before every deploy.

   The literal is evaluated, not parsed: it is a plain object apart from two
   helpers from the same file, `tri()` and `EMPTY`, which are mirrored below.
   If content.ts grows a third helper this script fails loudly rather than
   writing half a file. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "lib", "content.ts");
const OUT = path.join(HERE, "..", "src", "data", "content.default.json");

function die(msg) {
  console.error("pack-content: " + msg);
  process.exit(1);
}

const source = fs.readFileSync(SRC, "utf8");

/* The two helpers DEFAULT_CONTENT uses, mirrored. Checked against the source
   so a change there is a build failure here, not a silently wrong JSON. */
if (!/function tri\(/.test(source) || !/return \{ RU: ru, ET: et, EN: en \}/.test(source)) {
  die("tri() in src/lib/content.ts no longer looks like { RU, ET, EN } — teach this script the new shape.");
}
if (!/const EMPTY: Trilingual = \{ RU: "", ET: "", EN: "" \}/.test(source)) {
  die("EMPTY in src/lib/content.ts changed — teach this script the new shape.");
}
const tri = (ru, et, en) => ({ RU: ru, ET: et, EN: en });
const EMPTY = { RU: "", ET: "", EN: "" };

/* ---------- cut the object literal out of the TypeScript ----------------- */

const anchor = source.indexOf("export const DEFAULT_CONTENT");
if (anchor < 0) die("no `export const DEFAULT_CONTENT` in src/lib/content.ts");
const open = source.indexOf("{", anchor);
if (open < 0) die("DEFAULT_CONTENT has no object literal");

/* Brace matching that knows about strings and comments — the default
   announcement text contains {EE} and {LV} inside quotes. */
function matchBrace(s, from) {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < s.length && s[i] !== quote) i += s[i] === "\\" ? 2 : 1;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") { i = s.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i); if (i < 0) break; i++; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

const close = matchBrace(source, open);
if (close < 0) die("could not find the end of the DEFAULT_CONTENT literal");
const literal = source.slice(open, close + 1);

let content;
try {
  content = new Function("tri", "EMPTY", '"use strict"; return (' + literal + ");")(tri, EMPTY);
} catch (err) {
  die("could not evaluate the DEFAULT_CONTENT literal — it now uses something\n" +
    "  this script does not provide (" + err.message + ").\n" +
    "  Either keep the literal to plain values, tri() and EMPTY, or extend tools/pack-content.mjs.");
}

/* ---------- shape check -------------------------------------------------- */

for (const key of ["company", "hours", "social", "announcement", "contactPage"]) {
  if (!content[key] || typeof content[key] !== "object") die("DEFAULT_CONTENT." + key + " is missing");
}
for (const key of ["legalName", "regCode", "vatNumber", "address", "email", "phone"]) {
  if (typeof content.company[key] !== "string") die("DEFAULT_CONTENT.company." + key + " is not a string");
}

const body = JSON.stringify(content, null, 2) + "\n";
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
if (prev !== body) fs.writeFileSync(OUT, body, "utf8");
console.log(
  "pack-content: " + content.company.legalName + " · " +
  Object.values(content.social).filter(Boolean).length + " social link(s)" +
  (prev === body ? " (unchanged)" : ""),
);
