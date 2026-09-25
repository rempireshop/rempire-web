/**
 * «Вернуть» from any device — the server half (1a, Dim 25.09.2026, q7;
 * db/migrations/207_audit_prev.sql, src/lib/audit-undo.ts).
 *
 * Before: admin_audit wrote what a setting BECAME and never what it had
 * been, so only the browser that made a change could take it back. Now every
 * settings PUT and every product override keeps the value it replaced, the
 * journal listing turns that into the paths that changed, and a PUT through
 * the same route with `undoOf` marks the old row «вернули» for everybody.
 *
 * Run for real against PGlite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { diffPaths, journalRows } from "@/lib/audit-undo";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
let admin = "";

type Row = {
  id: number; action: string; payload: Record<string, unknown>;
  undo?: { kind: string; key?: string; id?: string; changes?: Array<{ path: string[]; before?: unknown; gone?: true }>; patch?: Record<string, unknown> };
  undone?: true;
};

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});
afterAll(async () => {
  await teardownDb();
});
beforeEach(async () => {
  resetRateLimits();
  await truncateAll();
});

async function putSettings(body: unknown): Promise<Response> {
  const { PUT } = await import("@/app/api/admin/settings/route");
  return PUT(new Request(`${ORIGIN}/api/admin/settings/`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify(body),
  }));
}
async function putOverride(body: unknown): Promise<Response> {
  const { PUT } = await import("@/app/api/admin/overrides/route");
  return PUT(new Request(`${ORIGIN}/api/admin/overrides/`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify(body),
  }));
}
async function journal(): Promise<Row[]> {
  const { GET } = await import("@/app/api/admin/audit/route");
  const res = await GET(new Request(`${ORIGIN}/api/admin/audit/?limit=50`, { headers: { cookie: admin } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { audit: Row[] }).audit;
}

describe("diffPaths — what a change changed, and what it held before", () => {
  it("walks objects key by key and treats a list as one value", () => {
    const before = { company: { phone: "+372 1", email: "a@b.ee" }, announcement: { on: true, text: { RU: "x" } }, list: [1, 2] };
    const after = { company: { phone: "+372 2", email: "a@b.ee" }, announcement: { on: true, text: { RU: "x", ET: "y" } }, list: [1, 2, 3] };
    expect(diffPaths(before, after)).toEqual([
      { path: ["company", "phone"], before: "+372 1" },
      { path: ["announcement", "text", "ET"], gone: true },
      { path: ["list"], before: [1, 2] },
    ]);
  });
  it("a key that did not exist before is the whole value, before = null", () => {
    expect(diffPaths(null, { slides: [] })).toEqual([{ path: [], before: null }]);
  });
  it("nothing changed — nothing to put back", () => {
    expect(diffPaths({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe("PUT /api/admin/settings keeps what it replaced", () => {
  it("the audit row carries prev (null for a first write) beside the payload", async () => {
    expect((await putSettings({ chatbot: true })).status).toBe(200);
    expect((await putSettings({ chatbot: false })).status).toBe(200);
    const rows = await query<{ payload: { key: string; value: unknown }; prev: unknown; has: boolean }>(
      "select payload, prev, (prev is not null) as has from admin_audit where action = 'setting.set' order by id",
    );
    expect(rows.map((r) => [r.payload.key, r.payload.value, r.has, r.prev])).toEqual([
      ["chatbot", true, true, null],
      ["chatbot", false, true, true],
    ]);
  });

  it("the journal hands back only the fields a row changed, without the heavy value", async () => {
    const doc = { company: { phone: "+372 1111 1111", email: "info@x.ee" }, announcement: { on: true } };
    await putSettings({ content: doc });
    await putSettings({ content: { ...doc, company: { ...doc.company, phone: "+372 2222 2222" } } });
    const [newest] = (await journal()).filter((r) => r.action === "setting.set");
    expect(newest.payload).toEqual({ key: "content" });
    expect(newest.undo).toEqual({
      kind: "setting", key: "content",
      changes: [{ path: ["company", "phone"], before: "+372 1111 1111" }],
    });
  });

  it("«Вернуть» is the same route with undoOf — and that row reads undone everywhere", async () => {
    await putSettings({ bundles: true });
    await putSettings({ bundles: false });
    const target = (await journal()).find((r) => r.action === "setting.set" && r.undo)!;
    expect(target.undone).toBeUndefined();
    const res = await putSettings({ settings: { bundles: true }, undoOf: target.id, ref: "j-abc_1" });
    expect(res.status).toBe(200);
    const rows = await journal();
    expect(rows.find((r) => r.id === target.id)!.undone).toBe(true);
    expect(rows[0].payload).toMatchObject({ key: "bundles", undoOf: target.id, ref: "j-abc_1" });
  });

  it("undoOf and ref are never stored as settings, and junk in them is dropped", async () => {
    const res = await putSettings({ chatbot: true, undoOf: "7; drop table", ref: "<script>" });
    expect(res.status).toBe(200);
    const all = await query<{ key: string }>("select key from settings order by key");
    expect(all.map((r) => r.key)).toEqual(["chatbot"]);
    const [row] = await query<{ payload: Record<string, unknown> }>(
      "select payload from admin_audit where action = 'setting.set' order by id desc limit 1",
    );
    expect(row.payload).toEqual({ key: "chatbot", value: true });
  });

  it("a row written before the migration (no prev) offers no way back", async () => {
    await query("insert into admin_audit (actor, action, payload) values ('admin', 'setting.set', $1::jsonb)", [
      JSON.stringify({ key: "chatbot", value: true }),
    ]);
    const [row] = await journal();
    expect(row.undo).toBeUndefined();
  });
});

describe("PUT /api/admin/overrides keeps the product's old fields", () => {
  it("a price change records the price it replaced; a first change records null", async () => {
    expect((await putOverride({ id: "touchable", price: 25.5 })).status).toBe(200);
    expect((await putOverride({ id: "touchable", price: 19.9 })).status).toBe(200);
    const rows = (await journal()).filter((r) => r.action === "override.set");
    expect(rows[0].undo).toEqual({ kind: "override", id: "touchable", patch: { price: 25.5 } });
    expect(rows[1].undo).toEqual({ kind: "override", id: "touchable", patch: { price: null } });
  });
  it("undoOf on the override PUT marks that row too", async () => {
    await putOverride({ id: "touchable", price: 25.5 });
    const [row] = await journal();
    await putOverride({ id: "touchable", price: null, undoOf: row.id });
    expect((await journal()).find((r) => r.id === row.id)!.undone).toBe(true);
  });
});

describe("journalRows on its own", () => {
  it("a replacement of more than eighty fields is not an edit — no «Вернуть»", () => {
    const before: Record<string, number> = {}, after: Record<string, number> = {};
    for (let i = 0; i < 90; i++) { before["k" + i] = i; after["k" + i] = i + 1; }
    const [row] = journalRows([{ id: 1, at: "2026-09-25T10:00:00Z", actor: "admin", action: "setting.set", payload: { key: "x", value: after }, prev: before }]);
    expect(row.undo).toBeUndefined();
    expect(row).not.toHaveProperty("prev");
  });
});
