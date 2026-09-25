/**
 * «Вернуть» from any device — the journal's half of db/migrations/207_audit_prev.sql.
 *
 * Dim, 25.09.2026 (1a decisions, q7). A row of admin_audit now keeps what the
 * change replaced (`prev`). This turns that into what the panel's journal needs
 * to put a change back through the route that made it — no new endpoint:
 *
 *   setting.set    `undo = { kind: "setting", key, changes }` — the paths the
 *                  PUT changed and what each held before. The panel reads the
 *                  setting as it is NOW, puts back those paths only and PUTs
 *                  the row (PUT /api/admin/settings with `undoOf`). A whole-
 *                  value undo would also revert every later edit of the same
 *                  row — the phone number typed after the strip text — and
 *                  that is the bug the journal had (map of the panel, 23.09).
 *   override.set   `undo = { kind: "override", id, patch }` — the product's
 *                  fields as they were; PUT /api/admin/overrides takes it as is.
 *
 * `undone` marks a row a later row names in its `undoOf` — the journal draws it
 * struck through with «возвращено» on every device, not only on the one that
 * pressed the button.
 *
 * The listing also drops the heavy half of a setting.set payload (`value` —
 * the whole content document, tens of kilobytes, a hundred rows of it): the
 * journal prints the key and nothing else of it, and the changes carry what an
 * undo needs.
 */
import type { AuditRow } from "@/lib/orders";

export type AuditChange = { path: string[]; before?: unknown; gone?: true };
export type AuditUndo =
  | { kind: "setting"; key: string; changes: AuditChange[] }
  | { kind: "override"; id: string; patch: Record<string, unknown> };
export type JournalRow = Omit<AuditRow, "prev"> & { undo?: AuditUndo; undone?: true };

/** More paths than this and the row is a replacement, not an edit — no «Вернуть». */
const MAX_CHANGES = 80;

function plain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The leaves that differ between two JSON values, with what each held BEFORE.
 * Objects are walked key by key; an array is one leaf (a slide list, a bank
 * list, `countriesOff` — putting back one element of an ordered list is not
 * a thing anybody means). A key the old value did not have is `gone`: undo
 * deletes it.
 */
export function diffPaths(before: unknown, after: unknown, path: string[] = [], out: AuditChange[] = []): AuditChange[] {
  if (plain(before) && plain(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      const p = [...path, k];
      if (!(k in before)) out.push({ path: p, gone: true });
      else if (!(k in after)) out.push({ path: p, before: before[k] });
      else diffPaths(before[k], after[k], p, out);
    }
    return out;
  }
  if (!same(before, after)) out.push({ path, before: before === undefined ? null : before });
  return out;
}

function numberOr0(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** The rows as GET /api/admin/audit hands them to the journal. */
export function journalRows(rows: AuditRow[]): JournalRow[] {
  const undoneIds = new Set<number>();
  for (const r of rows) {
    const p = plain(r.payload) ? r.payload : {};
    const of = numberOr0(p.undoOf);
    if (of) undoneIds.add(of);
  }
  return rows.map((r) => {
    const { prev, ...row } = r;
    const out: JournalRow = { ...row };
    const p = plain(r.payload) ? { ...r.payload } : null;
    if (r.action === "setting.set" && p && typeof p.key === "string") {
      if ("prev" in r) {
        const changes = diffPaths(prev, p.value);
        if (changes.length && changes.length <= MAX_CHANGES) out.undo = { kind: "setting", key: p.key, changes };
      }
      delete p.value;
      out.payload = p;
    }
    if (r.action === "override.set" && p && typeof p.id === "string" && "prev" in r && plain(prev) && Object.keys(prev).length) {
      out.undo = { kind: "override", id: p.id, patch: prev };
    }
    if (undoneIds.has(r.id)) out.undone = true;
    return out;
  });
}
