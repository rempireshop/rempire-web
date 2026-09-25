/**
 * After «Вернуть», the same change made again is written again.
 *
 * Verification pass on staging, 25.09.2026 (goods-video): in the product
 * card «×» on the video → «Видео убрано» → «Вернуть», then «×» once more in
 * the same visit: the box emptied, no request left, and after a reload the
 * link was back — the shop still played the video. The field's autosave
 * record (admAutosave) still said "" was the value the server had taken, so
 * the second «×» was «typed back to what the server holds» and skipped. The
 * undo had put the link back on the server without telling the record.
 * The same held for any typed field: 12 → 13 saved, «Вернуть», 13 again —
 * nothing sent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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
const optional = (name: string) => (src.includes(`function ${name}(`) ? slice(name) : "");

type Entry = { t: string; txt: string; a: Record<string, unknown>; prev: Record<string, unknown>; asKey?: string };

function rig() {
  const sent: unknown[] = [];
  const pushed: unknown[] = [];
  const body = `
    var ADM_AS = {};
    var ADM_SAVE = { state: "idle", busy: 0, fade: 0, refused: false };
    ${src.match(/var ADM_SAVE_POLICY = [^;]+;/)![0]}
    var ADM_SAVE_IDLE_MS = 1000;
    var SRV = { admin: true };
    function admSaveBegin() {}
    function admSaveEnd() {}
    function admAutosaveMark() {}
    ${["admAutosavePolicy", "admAutosave", "admAutosaveSend", "admAutosaveOk", "admAutosaveDone"].map(slice).join("\n")}
    ${optional("admAutosaveReopen")}
    var ED = { j: {} };
    var DEMO = { log: [], video: { p1: "" }, price: { p1: 13 } };
    function demoSave() {}
    function applyDemoOverrides() {}
    function pushOverride(id, patch) { pushed.push(patch); }
    function srvPush(a) { pushed.push(a); }
    ${slice("edJournal")}
    ${slice("demoUndo")}
    return {
      autosave: admAutosave, journal: edJournal, undo: demoUndo, DEMO: DEMO,
      spec: function (kind) { return { kind: kind, send: function (v) { sent.push(v); return Promise.resolve(true); } }; }
    };
  `;
  const r = new Function("sent", "pushed", body)(sent, pushed) as {
    autosave: (key: string, value: unknown, ev: string, spec?: unknown) => boolean;
    journal: (key: string, entry: Entry, fresh: boolean) => Entry;
    undo: (i: number) => void;
    DEMO: { log: Entry[] };
    spec: (kind: string) => unknown;
  };
  return { ...r, sent, pushed };
}
const tick = () => new Promise((res) => setTimeout(res, 0));

describe("the product card after «Вернуть»", () => {
  it("«×» on the video, «Вернуть», «×» again: the second removal is sent too", async () => {
    const r = rig();
    const key = "ed:p1:video", spec = r.spec("code");
    // «×»: the box is emptied and sent at once (d.edvidclear)
    r.autosave(key, "", "input", spec); r.autosave(key, "", "enter", spec);
    await tick();
    expect(r.sent).toEqual([""]);
    // …it landed: the journal line with «Вернуть» (edCommit → demoApply → edJournal)
    const entry: Entry = { t: "", txt: "Видео убрано", a: { type: "set_video", id: "p1", value: "" }, prev: { type: "set_video", id: "p1", value: "https://youtu.be/abc" } };
    r.DEMO.log.unshift(entry);
    r.journal(key, entry, true);
    // «Вернуть» on the toast
    r.undo(r.DEMO.log.indexOf(entry));
    expect(r.pushed).toContainEqual({ video_url: "https://youtu.be/abc" });
    // «×» once more
    r.autosave(key, "", "input", spec); r.autosave(key, "", "enter", spec);
    await tick();
    expect(r.sent).toEqual(["", ""]);   // before: [""] — and the link came back after a reload
  });

  it("a typed price put back with «Вернуть» and typed again is sent again", async () => {
    const r = rig();
    const key = "ed:p1:price", spec = r.spec("money");
    r.autosave(key, "1", "input", spec); r.autosave(key, "13", "input", spec); r.autosave(key, "13", "blur", spec);
    await tick();
    expect(r.sent).toEqual(["13"]);
    const entry: Entry = { t: "", txt: "Цена", a: { type: "set_price", id: "p1", value: 13 }, prev: { type: "set_price", id: "p1", value: 12 } };
    r.DEMO.log.unshift(entry);
    r.journal(key, entry, false);
    r.undo(r.DEMO.log.indexOf(entry));
    r.autosave(key, "1", "input", spec); r.autosave(key, "13", "input", spec); r.autosave(key, "13", "blur", spec);
    await tick();
    expect(r.sent).toEqual(["13", "13"]);
  });

  it("a value still owed when «Вернуть» lands is not dropped", async () => {
    const r = rig();
    const key = "ed:p1:video", spec = r.spec("code");
    r.autosave(key, "", "input", spec); r.autosave(key, "", "enter", spec);
    await tick();
    const entry: Entry = { t: "", txt: "Видео убрано", a: { type: "set_video", id: "p1", value: "" }, prev: { type: "set_video", id: "p1", value: "https://youtu.be/abc" } };
    r.DEMO.log.unshift(entry);
    r.journal(key, entry, true);
    r.autosave(key, "https://youtu.be/new", "input", spec);   // typed, not left yet
    r.undo(r.DEMO.log.indexOf(entry));
    r.autosave(key, undefined, "blur", spec);
    await tick();
    expect(r.sent).toEqual(["", "https://youtu.be/new"]);
  });

  it("an undo from another device's journal row reopens the card's fields too", () => {
    const undo = slice("admJournalUndoServer");
    expect(undo).toContain('admAutosaveReopen("ed:" + u.id + ":", true)');
  });
});
