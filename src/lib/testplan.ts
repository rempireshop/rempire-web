/**
 * The acceptance checklist Renat and Dim walk the shop through, and the
 * answers they leave — the server half of `/test/` (public/test/index.html).
 *
 * Two people, two phones, one shared result. That sentence is the whole
 * design:
 *
 *   · the checklist itself is a committed file (src/data/testplan.json),
 *     replaced wholesale whenever the plan changes — nothing here may hardcode
 *     an item id or count;
 *   · the answers are ONE row in `settings` (key `testplan_answers`), because
 *     they are a single small document nothing else joins onto. A table would
 *     buy per-row writes and per-row locking, and neither matters at eight
 *     answers per tester — while a table costs a migration in a numbered range
 *     this work does not own (docs/build-contracts.md) and a second place to
 *     look when an answer goes missing;
 *   · a save MERGES per item id instead of replacing the document, and the
 *     newer `at` wins. Renat's phone holds a copy of the map that was current
 *     when his page loaded; without the merge his next save would erase every
 *     answer Dim gave in the meantime. That is the one outcome this page may
 *     not have.
 *
 * Validation lives here rather than in the route so the same rules apply to
 * the browser's save, to a unit test and to anything written later.
 */
import { query } from "@/lib/db";
import { setSetting } from "@/lib/orders";
import planFile from "@/data/testplan.json";

/* ---------- the plan ----------------------------------------------------- */

export type TestArea = { id: string; name: string; note?: string };

export type TestItem = {
  id: string;
  area: string;
  who: "renat" | "dim" | "both";
  device: "phone" | "desktop" | "any";
  lang: "RU" | "ET" | "EN" | "any";
  title: string;
  steps: string[];
  expect: string;
  why: string;
  risk: "high" | "med" | "low";
  /** True when running the item creates real data — an order, a letter, stock
      movement. The page paints these red so nobody runs one by accident on a
      live shop; see public/test/index.html. */
  writes: boolean;
};

export type TestPlan = { version: number; areas: TestArea[]; items: TestItem[] };

/** The checklist as shipped. Read-only by convention — it is the imported
    JSON module object, which every request in the process shares. */
export const PLAN: TestPlan = planFile as TestPlan;

/** Every id the plan knows. An answer keyed by anything else is refused. */
export const ITEM_IDS: ReadonlySet<string> = new Set(PLAN.items.map((i) => i.id));

/* ---------- the answers -------------------------------------------------- */

export const ANSWERS_KEY = "testplan_answers";

export type AnswerStatus = "ok" | "bad" | "skip";
export type TestAnswer = { status: AnswerStatus; note: string; at: string; by: string };
export type AnswerMap = Record<string, TestAnswer>;

/** A comment, not an essay — «работает, но кнопка мелкая» is the shape of the
    feedback this page exists to collect. Long enough for a paragraph, short
    enough that the whole document stays a few tens of kilobytes. */
export const NOTE_MAX = 1_000;
/** «Ренат» / «Дима» / a browser id — a label, never prose. */
export const BY_MAX = 40;
/** Far above any plan we would write by hand, and a hard stop on a body that
    is trying to be a database. */
export const MAX_ANSWERS = 400;

const STATUSES: ReadonlySet<string> = new Set<AnswerStatus>(["ok", "bad", "skip"]);

/* Control characters other than a newline: stripped, because they cannot be
   typed on purpose and they are exactly what makes a stored string surprising
   later. Tabs become spaces. */
function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/\t/g, " ").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max).trim();
}

/**
 * An ISO instant we are willing to store.
 *
 * `at` comes from a phone, and a phone's clock can be wrong — which matters
 * because `at` is what decides a merge. A timestamp in the future would let a
 * misconfigured phone win every conflict forever, so anything ahead of the
 * server (past a minute of slack for a normal clock skew) is replaced with the
 * moment the server received it. A timestamp in the past is left alone: it is
 * either genuine or it loses conflicts, and both are harmless.
 */
function instant(value: unknown, now: number): string {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || ms > now + 60_000) return new Date(now).toISOString();
  return new Date(ms).toISOString();
}

export type CleanResult = { answers: AnswerMap; unknown: string[]; tooMany: boolean };

/**
 * Whatever arrived → answers this module is prepared to store.
 *
 * Unknown item ids are collected rather than dropped: the route turns them
 * into a 400 that names the id. Silently accepting half a body is how you end
 * up not knowing what was saved — and the page cannot send one anyway, because
 * it filters its outgoing map against the plan it just loaded (index.html,
 * `syncUp`). So a 400 here means the contract really did break.
 */
export function cleanAnswers(input: unknown, now: number = Date.now()): CleanResult {
  const out: AnswerMap = {};
  const unknown: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { answers: out, unknown, tooMany: false };

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_ANSWERS) return { answers: out, unknown, tooMany: true };

  for (const [id, raw] of entries) {
    if (!ITEM_IDS.has(id)) {
      if (unknown.length < 10) unknown.push(id.slice(0, 80));
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const a = raw as Record<string, unknown>;
    const status = typeof a.status === "string" && STATUSES.has(a.status) ? (a.status as AnswerStatus) : null;
    const note = text(a.note, NOTE_MAX);
    /* An answer with neither a verdict nor a comment is not an answer — it is
       what the page sends for a row the tester opened and left alone. Dropping
       it here keeps the stored document to things somebody actually said. */
    if (!status && !note) continue;
    out[id] = { status: status ?? "skip", note, at: instant(a.at, now), by: text(a.by, BY_MAX) };
  }
  return { answers: out, unknown, tooMany: false };
}

/**
 * Stored + incoming, per item id, newer `at` wins.
 *
 * `>=` rather than `>`: re-sending the same answer (a retry after a failed
 * save, the page syncing a local copy up) must be a no-op that still leaves
 * the incoming copy in place, not a coin toss decided by string comparison.
 */
export function mergeAnswers(stored: AnswerMap, incoming: AnswerMap): AnswerMap {
  const out: AnswerMap = { ...stored };
  for (const [id, next] of Object.entries(incoming)) {
    const prev = out[id];
    if (!prev || next.at >= prev.at) out[id] = next;
  }
  return out;
}

/* ---------- storage ------------------------------------------------------ */

/* The row holds `{v, answers}` rather than the bare map: the wire shape is
   fixed by the brief ({status, note, at, by} keyed by item id) and stays that
   way, but the row is ours, and a version marker is what makes the next change
   to this document a migration rather than a guess. */
type Row = { v: number; answers: AnswerMap };

/** Everything anybody has answered. `{}` when nothing has been saved yet. */
export async function getTestAnswers(): Promise<AnswerMap> {
  const rows = await query<{ value: unknown }>("select value from settings where key = $1", [ANSWERS_KEY]);
  const value = rows[0]?.value as Partial<Row> | undefined;
  const answers = value && typeof value === "object" ? (value.answers as AnswerMap | undefined) : undefined;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
  /* Read back through the same cleaner the writes go through: the row is one
     admin PUT /api/admin/settings away from holding anything at all, and the
     page must not have to defend against that on a phone. */
  return cleanAnswers(answers).answers;
}

/** Merges `incoming` into the stored document and returns the result. */
export async function saveTestAnswers(incoming: AnswerMap): Promise<AnswerMap> {
  const merged = mergeAnswers(await getTestAnswers(), incoming);
  await setSetting(ANSWERS_KEY, { v: 1, answers: merged } satisfies Row);
  return merged;
}

/* ---------- reporting ---------------------------------------------------- */

export type Progress = { total: number; answered: number; ok: number; bad: number; skip: number };

/** What the page's progress line counts, computed the same way on both sides. */
export function progress(answers: AnswerMap): Progress {
  const out: Progress = { total: PLAN.items.length, answered: 0, ok: 0, bad: 0, skip: 0 };
  for (const item of PLAN.items) {
    const a = answers[item.id];
    if (!a) continue;
    out.answered += 1;
    out[a.status] += 1;
  }
  return out;
}
