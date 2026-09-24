/**
 * «Загрузить видео» promises what the platform really takes.
 *
 * The button said «MP4 или MOV до 60 МБ» and the route's own ceiling is
 * 60 MB (src/lib/video.ts MAX_VIDEO_BYTES) — but the route runs as a Vercel
 * function, and the platform refuses a request body over 4.5 MB before a line
 * of ours runs (docs/HOSTING.md § 4). A clip between the two travelled over
 * mobile data for as long as it took and came back as a bare 413 (map of the
 * panel, 23.09.2026, #16). There is no direct-to-bucket upload to go around
 * the cap (it would need a presigned PUT and a CORS rule on the R2 bucket),
 * so the panel now says the real limit and refuses a bigger file at once,
 * in a sentence, before a byte is sent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function block(start: number, what: string, tail = ""): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1) + tail;
  }
  throw new Error(`unbalanced braces around ${what} in app.js`);
}
const fn = (name: string) => block(src.indexOf(`function ${name}(`), `function ${name}()`);
const obj = (name: string) => block(src.indexOf(`var ${name} = {`), `var ${name}`, ";");
/** A one-line `var NAME = …;` — "" while the file has none. */
function line(name: string): string {
  const at = src.indexOf(`var ${name} =`);
  return at < 0 ? "" : src.slice(at, src.indexOf(";", at) + 1);
}

const MB = 1024 * 1024;
/** The platform's body cap, docs/HOSTING.md § 4 — what a request must stay under. */
const PLATFORM_CAP = 4.5 * 1000 * 1000;

type Run = { sent: number; toasts: string[]; UP: { busy: number; total: number; err: string } };
function pick(size: number): Run {
  const out: Run = { sent: 0, toasts: [], UP: { busy: 0, total: 0, err: "" } };
  const upload = new Function(
    "UP", "toast", "render", "mediaErrText", "uploadVideo", "VID",
    `${line("VIDEO_SEND_MAX")}
     ${obj("VIDEO_ERR")}
     ${fn("vidFail")}
     ${fn("videoUpload")}
     return videoUpload;`,
  )(
    out.UP, (s: string) => { out.toasts.push(s); }, () => {}, () => "photo sentence",
    () => { out.sent++; return new Promise(() => {}); }, { id: "", url: null },
  ) as (files: Array<{ size: number; name: string }>, p: { id: string }) => void;
  upload([{ size, name: "clip.mp4" }], { id: "azur" });
  return out;
}

describe("a video over the platform's cap is refused in the panel", () => {
  it("does not send a 10 MB clip at all, and says why in one sentence", () => {
    const r = pick(10 * MB);
    expect(r.sent, "a clip the platform will refuse was sent anyway").toBe(0);
    expect(r.UP.busy, "the button was left spinning").toBe(0);
    expect(r.UP.err).toMatch(/4 МБ/);
    expect(r.toasts).toEqual([r.UP.err]);
  });

  it("sends a 3 MB clip as before", () => {
    const r = pick(3 * MB);
    expect(r.sent).toBe(1);
    expect(r.UP.err).toBe("");
  });

  it("keeps the ceiling under the platform's cap, with room for the form around the file", () => {
    const max = new Function(`${line("VIDEO_SEND_MAX")} return typeof VIDEO_SEND_MAX === "number" ? VIDEO_SEND_MAX : 0;`)() as number;
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(PLATFORM_CAP - 64 * 1024);
  });
});

describe("the words say the real limit", () => {
  it("the button no longer promises 60 MB", () => {
    const pane = fn("edPaneMedia");
    expect(pane).not.toMatch(/60 МБ/);
    expect(pane).toContain("Выбрать видео на телефоне · MP4 или MOV до 4 МБ");
  });

  it("the refusal names the same number", () => {
    const err = new Function(`${obj("VIDEO_ERR")} return VIDEO_ERR;`)() as Record<string, string>;
    expect(err.too_large).not.toMatch(/60 МБ/);
    expect(err.too_large).toMatch(/4 МБ/);
  });
});
