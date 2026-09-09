/**
 * tools/lib/js-strip.mjs — the comment-and-indentation pass that turns
 * public/shop2/app.js into public/shop2/app.min.js, the file every visitor
 * downloads and the only copy of the shop a browser ever runs.
 *
 * There is no type checker over app.js and no test that would notice a shop
 * that is one character short of parsing, so the invariants are pinned here:
 * the output is the same program, and the strings the shop prints and the
 * patterns it matches with come through untouched. The one thing a scanner
 * like this can get wrong is a `/` — regex or division — and getting it wrong
 * eats part of a pattern, which is why every literal is compared.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { literals, stripJs } from "../tools/lib/js-strip.mjs";

const parses = (src: string) => {
  new vm.Script(src, { filename: "under-test.js" });
  return true;
};

describe("stripJs", () => {
  it("takes line comments out and keeps the line break they sat on", () => {
    expect(stripJs("var a = 1; // why\nvar b = 2;\n")).toBe("var a = 1;\nvar b = 2;");
  });

  it("leaves a one-line block comment as one space, never a line break", () => {
    /* A newline here would be a line terminator ASI can act on: a `return`
       with a one-line comment behind it returns x today, and would return
       undefined the moment that comment became a line break. The spaces that
       were around the comment stay with it — a run of them costs nothing once
       the file is compressed, and taking them out would mean deciding where a
       token ends, which is a parser's job and not this one's. */
    expect(stripJs("return /* why */ x;\n")).toBe("return   x;");
  });

  it("leaves a block comment that spans lines as exactly one line break", () => {
    /* …and here the newline is the faithful answer, because such a comment IS
       a line terminator to the parser: the source already returns undefined,
       and a space would quietly turn it into `return x`. */
    const src = "function f() {\n  return /* one\n     two */ x;\n}\n";
    expect(stripJs(src)).toBe("function f() {\nreturn\nx;\n}");
  });

  it("drops indentation and blank lines, and never joins two lines", () => {
    const src = "var a = 1\n\n\n  var b = 2   \n";
    expect(stripJs(src)).toBe("var a = 1\nvar b = 2");
  });

  it("does not touch the inside of a template literal", () => {
    const src = "var s = `a\n   b // not a comment\n     c`;\n";
    expect(stripJs(src)).toBe(src.replace(/\r\n?/g, "\n").trimEnd());
  });

  it("does not read the inside of a regex as a comment", () => {
    const src = 'var re = /https?:\\/\\/x/; // real comment\nvar n = 4 / 2 / 1;\n';
    const out = stripJs(src);
    expect(out).toBe("var re = /https?:\\/\\/x/;\nvar n = 4 / 2 / 1;");
    expect(literals(out)).toEqual(literals(src));
  });

  it("normalises CRLF, so Windows and the Linux builder write the same bytes", () => {
    expect(stripJs("var a = 1;\r\nvar b = 2;\r\n")).toBe("var a = 1;\nvar b = 2;");
  });

  it("is idempotent — nothing is left for a second pass to remove", () => {
    const once = stripJs("/* head */\nvar a = 1; // tail\n  var b = `x\n  y`;\n");
    expect(stripJs(once)).toBe(once);
  });
});

describe("public/shop2/app.js stripped", () => {
  it("is the same program: it parses, and its literals are the source's literals", async () => {
    const src = (await readFile(path.join(process.cwd(), "public", "shop2", "app.js"), "utf8"))
      .replace(/\r\n?/g, "\n");
    const built = stripJs(src);

    expect(parses(built)).toBe(true);
    expect(literals(built)).toEqual(literals(src));

    /* And it is worth the build step it costs: a quarter of app.js is comment
       prose, and every byte of it is on the critical path of every page. */
    expect(Buffer.byteLength(built)).toBeLessThan(Buffer.byteLength(src) * 0.75);
  });
});
