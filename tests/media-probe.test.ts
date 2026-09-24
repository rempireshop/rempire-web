/**
 * «Can this server take a photo?» — ensureMedia() in public/shop2/app.js, the
 * one question every picture control in the panel asks (the letter, the
 * article, the banner, the goods editor, the assistant's paperclip).
 *
 * Dim on /test («mail-newsletter-send», 24.09.2026) saw «Загрузка картинок пока
 * не настроена — вставьте ссылку на картинку» on staging, where
 * GET /api/admin/upload/ answers {ok:true, configured:true}. «Not configured»
 * may come from exactly one place: the server saying so. Until this change a
 * probe that got no answer at all — no connection, a cold function that timed
 * out, a 401, a page that was not JSON — wrote MEDIA.on = false for the rest
 * of the session, and a second screen asking while the first question was in
 * the air had its callback dropped.
 *
 * Sliced out of app.js and run against a stub apiJson and a clock this file
 * turns by hand.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

function sliceFn(name: string): string {
  const at = src.indexOf(`  function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  const end = src.indexOf("\n  }\n", at);
  return src.slice(at, end + 4);
}
function sliceLine(name: string): string {
  const at = src.indexOf(`  var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  return src.slice(at, src.indexOf("\n", at));
}

type Answer = { status: number; body: Record<string, unknown> } | "network" | "no-api";
type Rig = {
  MEDIA: { on: boolean | null; busy: boolean; cutout: boolean; maxBytes: number };
  ask: (then?: () => void) => void;
  calls: () => number;
  renders: () => number;
  /** Settles the oldest request still in the air. */
  answer: (a: Answer) => Promise<void>;
  later: (ms: number) => void;
  refusal: (code: string) => void;
};

function rig(): Rig {
  const pending: Array<(a: Answer) => void> = [];
  let calls = 0;
  let renders = 0;
  let now = 1_000_000;
  const ctx = {
    Date: { now: () => now },
    apiJson: () => {
      calls += 1;
      return new Promise((resolve, reject) => {
        pending.push((a) => {
          if (a === "network") reject(new Error("Failed to fetch"));
          else if (a === "no-api") reject(new Error("no-api"));
          else resolve(a);
        });
      });
    },
    render: () => { renders += 1; },
  };
  const api = runInNewContext(`
    ${sliceLine("MEDIA")}
    ${sliceLine("MEDIA_RETRY_MS")}
    ${sliceFn("ensureMedia")}
    ${sliceFn("mediaNoteRefusal")}
    ({ MEDIA: MEDIA, ask: ensureMedia, refusal: function (c) { mediaNoteRefusal(new Error(c)); } })
  `, ctx) as Pick<Rig, "MEDIA" | "ask" | "refusal">;
  return {
    ...api,
    calls: () => calls,
    renders: () => renders,
    answer: async (a) => {
      const settle = pending.shift();
      if (!settle) throw new Error("no request in the air");
      settle(a);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
    later: (ms) => { now += ms; },
  };
}

const YES = { status: 200, body: { ok: true, configured: true, cutout: true, maxBytes: 5_000_000 } };
const NO = { status: 200, body: { ok: true, configured: false, cutout: false, maxBytes: 12_582_912 } };

describe("the server's own answer is the only one that sticks", () => {
  it("configured:true — uploads are on, with the server's own ceiling and «Убрать фон»", async () => {
    const r = rig();
    let told = 0;
    r.ask(() => { told += 1; });
    await r.answer(YES);
    expect(r.MEDIA.on).toBe(true);
    expect(r.MEDIA.cutout).toBe(true);
    expect(r.MEDIA.maxBytes).toBe(5_000_000);
    expect(told).toBe(1);
    // asked once per panel: every later picture control reads the answer
    r.ask(); r.ask(() => { told += 1; });
    expect(r.calls()).toBe(1);
  });

  it("configured:false — the one «not set up» there is", async () => {
    const r = rig();
    r.ask();
    await r.answer(NO);
    expect(r.MEDIA.on).toBe(false);
    expect(r.renders(), "no callback given: the screen is repainted with the answer").toBe(1);
  });

  it("an upload refused for having no bucket is the same answer", () => {
    const r = rig();
    r.refusal("storage_not_configured");
    expect(r.MEDIA.on).toBe(false);
    r.refusal("network");
    expect(r.MEDIA.on).toBe(false);
  });
});

describe("no answer is not «no»", () => {
  const silent: Array<[string, Answer]> = [
    ["no connection", "network"],
    ["a page that is not JSON (no API behind it)", "no-api"],
    ["a signed-out cookie", { status: 401, body: { ok: false, error: "unauthorized" } }],
    ["a function that fell over", { status: 500, body: { ok: false } }],
    ["a timeout at the edge", { status: 504, body: {} }],
  ];
  for (const [name, a] of silent) {
    it(`${name}: still unknown, nothing repainted, asked again later`, async () => {
      const r = rig();
      let told = 0;
      r.ask(() => { told += 1; });
      await r.answer(a);
      expect(r.MEDIA.on, "an unanswered question was written down as «not configured»").toBeNull();
      expect(told).toBe(0);
      expect(r.renders()).toBe(0);
      // not on every repaint of a screen while the server is down…
      r.ask();
      expect(r.calls()).toBe(1);
      // …but the next picture control a little later asks again, and gets its answer
      r.later(20_000);
      r.ask(() => { told += 1; });
      expect(r.calls()).toBe(2);
      await r.answer(YES);
      expect(r.MEDIA.on).toBe(true);
      expect(told).toBe(1);
    });
  }
});

describe("two screens asking at once", () => {
  it("one request, and both are told", async () => {
    const r = rig();
    const told: string[] = [];
    r.ask(() => told.push("letter"));
    r.ask(() => told.push("article"));
    r.ask();   // the goods editor: a plain repaint
    expect(r.calls()).toBe(1);
    await r.answer(YES);
    expect(told).toEqual(["letter", "article"]);
    expect(r.renders()).toBe(1);
  });
});
