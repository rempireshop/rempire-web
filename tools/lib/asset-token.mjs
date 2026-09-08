/* The `?v=` token on the asset tags in public/shop2/index.html — derived from
   the files it versions, never typed.

   ---- why the token exists at all ---------------------------------------

   Do not delete it. public/shop2/app.js, styles.css and the generated files
   beside them are served from a static layer that is allowed to cache them
   for as long as it likes, and a browser keys its own copy on the full URL.
   Without a token in the URL a shopper who has visited once keeps running
   the app.js he already has — for days — while the repository, the deploy
   and everybody looking at the deploy have moved on. That is not a theory:
   on 06.09.2026 the wallet fix («Apple Pay» opening the bank list) landed at
   22:06 and the token stayed at `i18n78` until 11:02 the next morning, so
   every returning browser executed the broken file for thirteen hours and
   Renat reported the bug as unfixed (docs/audit/2026-09-07-montonio.md § 1).
   A new token is a new URL, and a new URL is a guaranteed fresh download.

   ---- why it is derived rather than bumped ------------------------------

   The token used to be a counter — `i18n82`, `i18n83`, `i18n84` — moved by
   hand in a commit of its own, roughly once a day. Every window between "the
   file changed" and "the token changed" is the bug above, and a hand-moved
   number is nothing but windows. Dim's answer on 08.09.2026 was to move it
   automatically, so here it is a hash of the bytes the token versions:

     · it cannot go stale, because a changed file is a changed hash;
     · it cannot churn, because an unchanged build hashes to the same string
       and the shell is left byte-identical;
     · it cannot be forgotten, because nobody types it.

   ---- which files ---------------------------------------------------------

   The tags that share ONE token are the set: whatever `?v=` the app.js tag
   carries, every other tag carrying that same value is versioned with it
   (thirteen of them today — two stylesheets and eleven scripts). A tag with
   a token of its own — /shop/content.js?v=c2 — is deliberately not part of
   the set and is left exactly as it is. Add an asset tag with the shared
   token and it joins on its own; nothing here lists filenames.

   public/shop2/chat.js is hashed too even though it has no tag: mountChat()
   in app.js adds that tag itself, on wide screens only, and copies the token
   off the app.js tag — so a chat.js that changed alone would otherwise ship
   behind a token that had not moved, which is the original bug wearing a
   different hat.

   Line endings are normalised before hashing. This repository is developed on
   Windows with core.autocrlf=true, so the same committed file is CRLF in the
   working tree and LF on Vercel's Linux builder; hashing the raw bytes would
   make a local `npm run prerender` and the deploy disagree about the token
   for files nobody had touched. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** How long the derived token is. Twelve hex characters of SHA-256 — far more
    than enough to never collide across the handful of builds a day this shop
    sees, and short enough to read in a `view-source` over Renat's shoulder. */
const TOKEN_LEN = 12;

/** An asset tag with a `?v=`: `href="/shop2/styles.css?v=i18n84"`. */
const TAGGED = /(?:href|src)="(\/[^"?\s]+)\?v=([^"'\s]*)"/g;

/** Files that carry the shared token without wearing a tag of their own. */
const UNTAGGED = ["/shop2/chat.js"];

/** The token the shell is wearing now — read off the app.js tag, which is the
    one tag this file's whole reason for existing is about. */
export function currentToken(shell) {
  const m = /app\.js\?v=([^"'\s]*)/.exec(String(shell));
  return m ? m[1] : "";
}

/**
 * Every URL in the shell versioned with the shared token, in the order the
 * tags appear, plus the untagged riders. Duplicates are collapsed: a file
 * linked twice is still one file.
 */
export function versionedAssets(shell) {
  const token = currentToken(shell);
  if (!token) return [];
  const urls = [];
  for (const [, url, v] of String(shell).matchAll(TAGGED)) {
    if (v === token && !urls.includes(url)) urls.push(url);
  }
  for (const url of UNTAGGED) if (!urls.includes(url)) urls.push(url);
  return urls;
}

/**
 * The token those files hash to, given a way to fetch one of them.
 *
 * `read(url)` is handed each versioned URL — `/shop2/app.js` — and answers with
 * the file's text, or with null/undefined for a file that is not there. It may
 * be async.
 *
 * The URL goes into the hash beside the bytes, so renaming an asset moves the
 * token even when the content is identical; a file that is not on disk hashes
 * as a named absence rather than throwing, because public/shop/bundles.js is
 * genuinely optional (no file, no «Наборы») and a build must not die over it.
 *
 * The reader is a parameter rather than "read from public/" because the same
 * question is now asked of two different piles of bytes: `assetToken()` below
 * asks it of the working tree, and e2e/smoke.spec.ts asks it of the files a
 * deployment is actually serving over HTTP — which is the only version of the
 * question that could have caught the stale token of 06.09.2026, since a
 * working tree is always in agreement with itself. One algorithm, two readers:
 * the moment these were two functions they would start to disagree about
 * something small (the line endings, the missing file, the order) and the
 * deployed check would be measuring its own copy of the rule instead of the
 * rule the build uses.
 */
export async function assetTokenWith(shell, read) {
  const h = createHash("sha256");
  for (const url of versionedAssets(shell)) {
    h.update(url).update("\0");
    let body;
    try {
      const text = await read(url);
      body = text == null ? "\0missing\0" : String(text).replace(/\r\n?/g, "\n");
    } catch {
      body = "\0missing\0";
    }
    h.update(body).update("\0");
  }
  return h.digest("hex").slice(0, TOKEN_LEN);
}

/**
 * The token the files in a checkout hash to. `publicDir` is the repository's
 * public/ — the URLs are absolute paths inside it. This is what the prerender
 * and `prerender:check` use; see assetTokenWith() above for why the reading is
 * separable from the hashing.
 */
export async function assetToken(shell, publicDir) {
  return assetTokenWith(shell, (url) => readFile(path.join(publicDir, url.replace(/^\/+/, "")), "utf8"));
}

/**
 * The shell with every tag on the shared token moved to `token`. Only those
 * tags: a tag versioned with something else keeps what it has, and everything
 * else in the file — comments, markers, the prerendered home page — is
 * untouched, which is what lets the prerender go on patching this file rather
 * than rewriting it.
 */
export function retokenise(shell, token) {
  const from = currentToken(shell);
  if (!from || from === token) return shell;
  return String(shell).replace(TAGGED, (tag, url, v) => (v === from ? tag.replace("?v=" + v, "?v=" + token) : tag));
}
