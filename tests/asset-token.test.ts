/**
 * The assets' `?v=` token — tools/lib/asset-token.mjs.
 *
 * The token used to be a number somebody raised by hand once a day, and the
 * window between "app.js changed" and "the token changed" is where the
 * 06.09.2026 wallet fix disappeared for thirteen hours
 * (docs/audit/2026-09-07-montonio.md § 1). It is now a hash of the files it
 * versions, so the two properties that make that impossible are the two
 * properties worth pinning here:
 *
 *   · it does not move when nothing moved — otherwise every build would
 *     invalidate every browser's cache for nothing;
 *   · it moves when any versioned file moves — otherwise we are back to the
 *     bug, quietly.
 *
 * Plus the rule that decides WHICH files those are (the tags sharing the
 * app.js tag's token, and chat.js, which has no tag of its own), and the
 * promise that retokenising leaves the rest of index.html byte for byte.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetToken, currentToken, retokenise, versionedAssets } from "../tools/lib/asset-token.mjs";
import { stripJs } from "../tools/lib/js-strip.mjs";

/* ---------- a shell of our own, with files we can edit -------------------- */

/** The shape index.html has: tags on one shared token, one tag on its own. */
function shell(token: string): string {
  return [
    "<!doctype html>",
    "<html lang=\"ru\"><head>",
    `<link rel="stylesheet" href="/shop2/styles.css?v=${token}">`,
    `<link rel="stylesheet" href="/shop2/admin.css?v=${token}" media="print" data-admin-css>`,
    "</head><body>",
    "<div id=\"app\"><!-- prerender:start --><div id=\"prerender\">home</div><!-- prerender:end --></div>",
    "<script src=\"/shop/content.js?v=c2\"></script>",
    `<script src="/shop/legal.js?v=${token}"></script>`,
    `<script src="/shop2/app.js?v=${token}"></script>`,
    "</body></html>",
    "",
  ].join("\n");
}

const FILES: Record<string, string> = {
  "shop2/styles.css": "body{color:#000}\n",
  "shop2/admin.css": ".adm2{color:#111}\n",
  "shop2/app.js": "(function(){ /* the shop */ })();\n",
  "shop2/chat.js": "(function(){ /* the assistant */ })();\n",
  "shop/legal.js": "var LEGAL = {};\n",
  "shop/content.js": "var CONTENT = {};\n",
};

let PUB = "";
const write = (rel: string, body: string) => writeFileSync(path.join(PUB, rel), body, "utf8");

beforeAll(() => {
  PUB = mkdtempSync(path.join(tmpdir(), "rempire-asset-token-"));
  for (const dir of ["shop", "shop2"]) mkdirSync(path.join(PUB, dir), { recursive: true });
  for (const [rel, body] of Object.entries(FILES)) write(rel, body);
});

afterAll(() => {
  if (PUB) rmSync(PUB, { force: true, recursive: true });
});

/* ---------- which files the token covers ---------------------------------- */

describe("the set of versioned assets", () => {
  it("is the tags sharing the app.js token, plus chat.js, and never a tag with its own", () => {
    const urls = versionedAssets(shell("i18n84"));
    expect(urls).toEqual([
      "/shop2/styles.css",
      "/shop2/admin.css",
      "/shop/legal.js",
      "/shop2/app.js",
      "/shop2/chat.js",
    ]);
    // /shop/content.js?v=c2 keeps a token of its own on purpose
    expect(urls).not.toContain("/shop/content.js");
  });

  it("reads the current token off the app.js tag", () => {
    expect(currentToken(shell("i18n84"))).toBe("i18n84");
    expect(currentToken("<html><body>no tags here</body></html>")).toBe("");
  });
});

/* ---------- stable, and only stable, when nothing changed ------------------ */

describe("the token", () => {
  it("is the same string twice for the same files", async () => {
    const a = await assetToken(shell("i18n84"), PUB);
    const b = await assetToken(shell("i18n84"), PUB);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("does not depend on the token already in the shell — a re-run cannot churn it", async () => {
    const first = await assetToken(shell("i18n84"), PUB);
    expect(await assetToken(retokenise(shell("i18n84"), first), PUB)).toBe(first);
  });

  it("moves when a versioned file changes", async () => {
    const before = await assetToken(shell("i18n84"), PUB);
    write("shop2/app.js", FILES["shop2/app.js"] + "// the wallet fix\n");
    const after = await assetToken(shell("i18n84"), PUB);
    expect(after).not.toBe(before);
    write("shop2/app.js", FILES["shop2/app.js"]);
    expect(await assetToken(shell("i18n84"), PUB)).toBe(before);
  });

  it("moves when chat.js changes, even though chat.js has no tag", async () => {
    /* mountChat() copies the token off the app.js tag, so a chat.js that
       changed alone would otherwise ship behind an address browsers hold. */
    const before = await assetToken(shell("i18n84"), PUB);
    write("shop2/chat.js", FILES["shop2/chat.js"] + "// a new greeting\n");
    expect(await assetToken(shell("i18n84"), PUB)).not.toBe(before);
    write("shop2/chat.js", FILES["shop2/chat.js"]);
  });

  it("does not move when a file that is not versioned changes", async () => {
    const before = await assetToken(shell("i18n84"), PUB);
    write("shop/content.js", FILES["shop/content.js"] + "// its own ?v=c2\n");
    expect(await assetToken(shell("i18n84"), PUB)).toBe(before);
    write("shop/content.js", FILES["shop/content.js"]);
  });

  it("ignores the line endings the working tree happens to have", async () => {
    /* core.autocrlf=true on the Windows machine this repo is developed on and
       LF on Vercel's builder: hashing raw bytes would make the two disagree
       about a file nobody touched. */
    const lf = await assetToken(shell("i18n84"), PUB);
    write("shop2/app.js", FILES["shop2/app.js"].replace(/\n/g, "\r\n"));
    expect(await assetToken(shell("i18n84"), PUB)).toBe(lf);
    write("shop2/app.js", FILES["shop2/app.js"]);
  });

  it("moves when an asset is renamed, even to identical bytes", async () => {
    const before = await assetToken(shell("i18n84"), PUB);
    write("shop/legal2.js", FILES["shop/legal.js"]);
    const renamed = shell("i18n84").replace("/shop/legal.js", "/shop/legal2.js");
    expect(await assetToken(renamed, PUB)).not.toBe(before);
  });
});

/* ---------- what retokenising is allowed to touch -------------------------- */

describe("retokenise()", () => {
  it("moves every tag on the shared token and nothing else in the file", () => {
    const before = shell("i18n84");
    const after = retokenise(before, "abc123def456");
    expect(after).toContain('href="/shop2/styles.css?v=abc123def456"');
    expect(after).toContain('src="/shop2/app.js?v=abc123def456"');
    expect(after).toContain('src="/shop/content.js?v=c2"');
    expect(after).not.toContain("i18n84");
    // byte for byte apart from the token itself
    expect(after.split("abc123def456").join("i18n84")).toBe(before);
  });

  it("is a no-op when the shell already carries the token", () => {
    const s = shell("abc123def456");
    expect(retokenise(s, "abc123def456")).toBe(s);
  });
});

/* ---------- the real index.html ------------------------------------------- */

describe("public/shop2/index.html", () => {
  it("versions thirteen tags with one token, and the token covers chat.js too", async () => {
    const real = (await readFile(path.join(process.cwd(), "public", "shop2", "index.html"), "utf8"))
      .replace(/\r\n?/g, "\n");
    const token = currentToken(real);
    expect(token).not.toBe("");
    expect((real.match(new RegExp("\\?v=" + token, "g")) || []).length).toBe(13);
    const urls = versionedAssets(real);
    expect(urls).toHaveLength(14); // the thirteen tags + the untagged chat.js
    // the shell links the built file, not the source it is stripped from
    expect(urls).toContain("/shop2/app.min.js");
    expect(urls).not.toContain("/shop2/app.js");
    expect(urls).toContain("/shop2/chat.js");
  });

  it("carries the token its own assets hash to — the same check check-prerender.mjs makes", async () => {
    const pub = path.join(process.cwd(), "public");
    const real = (await readFile(path.join(pub, "shop2", "index.html"), "utf8")).replace(/\r\n?/g, "\n");
    expect(currentToken(real)).toBe(await assetToken(real, pub));
  });
});

/* ---------- a tag whose file no checkout holds ---------------------------- */

describe("the built app.min.js the shell links", () => {
  /* Same fixture shell, with the tag the real one now carries. */
  const builtShell = (token: string) => shell(token).replace("/shop2/app.js?v=", "/shop2/app.min.js?v=");

  it("is read off the tag like any other, .min and all", () => {
    expect(currentToken(builtShell("i18n84"))).toBe("i18n84");
    expect(versionedAssets(builtShell("i18n84"))).toContain("/shop2/app.min.js");
  });

  it("hashes through app.js, so a checkout that has never run a build agrees", async () => {
    /* app.min.js is gitignored (tools/minify-shop2.mjs): it exists after a
       build and not before. A token hashed off the file on disk would be one
       string in a fresh clone and another after `npm run build`, so the
       committed index.html would be wrong in whichever state it was not
       written in — the stale-token bug arriving through the front door. The
       answer must not depend on the built file being there at all. */
    const s = builtShell("i18n84");
    const withoutBuild = await assetToken(s, PUB);
    write("shop2/app.min.js", stripJs(FILES["shop2/app.js"]));
    try {
      expect(await assetToken(s, PUB)).toBe(withoutBuild);
    } finally {
      rmSync(path.join(PUB, "shop2/app.min.js"), { force: true });
    }
  });

  it("moves when app.js gains code and stands still when it gains a comment", async () => {
    /* Both halves matter. Code changes what the browser runs, so the address
       has to change with it; a comment does not survive the stripper at all,
       so moving the token for one would send every browser to fetch bytes it
       already has. */
    const s = builtShell("i18n84");
    const before = await assetToken(s, PUB);
    write("shop2/app.js", FILES["shop2/app.js"] + "var theWalletFix = 1;\n");
    expect(await assetToken(s, PUB)).not.toBe(before);
    write("shop2/app.js", FILES["shop2/app.js"] + "/* a note for a human */\n");
    expect(await assetToken(s, PUB)).toBe(before);
    write("shop2/app.js", FILES["shop2/app.js"]);
  });
});
