/**
 * «Блог» was the one screen in the owner's panel whose WRITES had no 401
 * branch. Every other one answers an expired cookie by dropping back to the
 * sign-in card (`SRV.admin = false`); the blog editor turned a 401 into the
 * same sentence a server error gets — «Не получилось сохранить — попробуйте
 * ещё раз.» — and left `SRV.admin` true, so the editor stayed on screen and
 * every further press failed the same way, forever (audit).
 *
 * The storefront is a vanilla-JS IIFE with no DOM here, so the pieces are cut
 * out of app.js by source text and run against stubs — the technique
 * tests/admin-panel-truth.test.ts uses. Retyping them would test this file
 * instead of the shop.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
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

/** Cut `var <name> = { … };` out of app.js the same way. */
function sliceObject(name: string): string {
  const start = src.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name} = {…}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1) + ";";
  }
  throw new Error(`unbalanced braces around var ${name} in app.js`);
}

/** `var <name> = "…";` — one line, one string. */
function sliceString(name: string): string {
  const m = new RegExp(`var ${name} = "[^"]*";`).exec(src);
  if (!m) throw new Error(`public/shop2/app.js no longer has var ${name} = "…"`);
  return m[0];
}

type Res = { status: number; body: { ok?: boolean; post?: unknown; error?: string } };

const SRV = { admin: true };
const S: Record<string, unknown> = { adminBlogErr: "", adminBlogEdit: null };
const toasts: string[] = [];

/**
 * The real saveBlogDraft() path: saveBlogFields() against a stubbed apiSend,
 * and the catch the editor's «Сохранить» hangs on it. Everything that decides
 * what the owner reads — blogHttpErr, blogSaveErrText, BLOG_ERR_TEXT — comes
 * out of app.js, nothing is retyped here.
 */
function save(answer: Res): Promise<void> {
  SRV.admin = true;
  S.adminBlogErr = "";
  toasts.length = 0;
  const run = new Function(
    "SRV",
    "S",
    "toast",
    "apiSend",
    "blogFieldsPayload",
    /* r21-blog put a snapshot of the draft between the payload and the
       request — «Сохранено ✓» is now measured against what LEFT rather than
       against the draft as it is when the answer lands, so a word typed while
       the save was in the air is no longer folded into the yardstick. Plumbing
       from this file's point of view, and stubbed like its neighbours: what
       this test is about is what the owner READS when the write is refused,
       and on that path the snapshot is never looked at again. */
    "blogDraftSnap",
    "blogDraftSig",
    "blogMarkSaved",
    "blogForget",
    /* 1a: a save is queued per article and the request is its own function
       (blogSaveOnce); the list row it updates, the one-«Создать» key and the
       page-closing variant are plumbing here, stubbed like their neighbours. */
    "noop",
    "blogListUpsert",
    "idemNewKey",
    "blogSendKeepalive",
    [
      sliceString("BLOG_SAVE_ERR"),
      sliceObject("BLOG_ERR_TEXT"),
      slice("blogHttpErr"),
      slice("blogSaveErrText"),
      slice("blogFail"),
      slice("saveBlogFields"),
      slice("blogSaveOnce"),
      "return function () { return saveBlogFields().catch(blogFail); };",
    ].join("\n"),
  )(
    SRV,
    S,
    (t: string) => toasts.push(t),
    () => Promise.resolve(answer),
    () => ({}),
    (d: Record<string, unknown>) => ({ ...d }),
    () => "sig",
    () => {},
    () => {},
    () => {},
    () => {},
    () => "key",
    () => Promise.resolve(answer),
  ) as () => Promise<void>;
  S.adminBlogEdit = { id: "p1", title: { RU: "Статья" } };
  return run();
}

describe("a blog write refused by the server", () => {
  beforeEach(() => {
    SRV.admin = true;
    S.adminBlogErr = "";
    toasts.length = 0;
  });

  it("puts the sign-in card back on a 401 instead of offering «ещё раз»", async () => {
    await save({ status: 401, body: { ok: false, error: "unauthorized" } });
    expect(SRV.admin, "an expired cookie must drop the panel back to the login card").toBe(false);
    expect(S.adminBlogErr).toBe("Вы вышли из админки — войдите снова.");
    expect(toasts).toEqual(["Вы вышли из админки — войдите снова."]);
  });

  it("still calls a server error a server error, and stays signed in", async () => {
    await save({ status: 503, body: { ok: false, error: "db_unavailable" } });
    expect(SRV.admin).toBe(true);
    expect(S.adminBlogErr).toBe("Не получилось сохранить — попробуйте ещё раз.");
  });

  it("still names the one refusal the owner can act on", async () => {
    await save({ status: 400, body: { ok: false, error: "body_too_long" } });
    expect(SRV.admin).toBe(true);
    expect(S.adminBlogErr).toBe("Статья слишком длинная — сократите текст и сохраните ещё раз.");
  });

  it("does not reach Object.prototype through a made-up error code", async () => {
    await save({ status: 400, body: { ok: false, error: "constructor" } });
    expect(S.adminBlogErr).toBe("Не получилось сохранить — попробуйте ещё раз.");
  });

  /* «Опубликовать», «Снять с публикации» and «Удалить» answer their own
     responses rather than going through saveBlogFields, so each of them has to
     hand that response to blogHttpErr too. `else blogFail()` — the refused
     branch with the answer thrown away — is what could not see a 401.
     (A bare blogFail() in a `.catch` is a different thing: there is no
     response there at all, only a network that did not answer.) */
  it("leaves no refused branch that throws the server's answer away", () => {
    const from = src.indexOf("function publishBlogPost(");
    const to = src.indexOf("function deleteBlogPost(");
    const writers = src.slice(from, src.indexOf("}", src.indexOf("blogFail", to)) + 1);
    expect(from, "public/shop2/app.js no longer has publishBlogPost()").toBeGreaterThan(0);
    expect(writers.match(/else blogFail\(\)/g), "a blogFail() with no response cannot see a 401").toBeNull();
  });
});
