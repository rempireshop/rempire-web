/**
 * The go-live list at `/golive/` — what is left before the shop opens, who
 * owns each line, and what is still holding the switch to the live domain.
 *
 * The server half of public/golive/index.html, built on the same three
 * decisions as src/lib/testplan.ts, for the same reasons:
 *
 *   · the list itself is a committed file (src/data/golive.json), written out
 *     of docs/go-live.md and replaced wholesale whenever that document moves.
 *     Nothing here may hardcode an item id or a count;
 *   · the marks people put on it are ONE row in `settings` (key
 *     `golive_states`). Thirty-odd rows of {status, note, at, by} are a single
 *     small document nothing joins onto — a table would buy per-row locking
 *     that does not matter here and cost a migration in a numbered range this
 *     work does not own (docs/build-contracts.md);
 *   · a save MERGES per item id and the newer `at` wins, so Claude ticking off
 *     a code item from a terminal cannot erase what the owner wrote on his
 *     phone two minutes earlier, and vice versa.
 *
 * WHAT IS DIFFERENT FROM THE CHECKLIST, and it is the whole point of this
 * file: `golive.json` carries a `status` of its own on every row — the state
 * that document was in on 18.09. So a stored state is an OVERLAY, not the
 * only source: the effective status of an item is what somebody last said
 * about it, and failing that what the committed file says. That is what lets
 * this page be correct the moment it is deployed, before anybody has touched
 * it, and it is why `statusOf()` — not `states[id]` — is the only honest way
 * to ask whether something is done.
 *
 * And the rule the owner stated in his own words — «before that switch to
 * live domain, we need to get all items done in the diipsolution environment»
 * — is `gate()`. It lives here rather than in the page so that the page, the
 * route and a unit test all compute the lock the same way.
 */
import { query } from "@/lib/db";
import { setSetting } from "@/lib/orders";
import planFile from "@/data/golive.json";

/* ---------- the list ----------------------------------------------------- */

/** Who owns a line. Three columns, exactly as docs/go-live.md marks them. */
export type Owner = "claude" | "dim" | "renat";

/**
 * Richer than a checkbox, and deliberately the same four words docs/go-live.md
 * uses. Flattening «blocked» into «not done» is how a list stops saying which
 * of its open items anybody can actually act on today.
 *
 *   · `todo`    — nobody has started, and nothing is in the way
 *   · `doing`   — in progress
 *   · `blocked` — waiting on something: another row, or a panel we do not own
 *   · `done`
 */
export type Status = "todo" | "doing" | "blocked" | "done";

export const STATUSES: readonly Status[] = ["todo", "doing", "blocked", "done"];
const STATUS_SET: ReadonlySet<string> = new Set(STATUSES);

/** The English half of a row, carried inside the row it translates — same
    reason as src/lib/testplan.ts: one list, one set of ids, one document. */
export type GoliveText = { title: string; detail: string };

export type GolivePhase = { id: string; name: string; note: string; en: GoliveText & { name: string; note: string } };

export type GoliveArea = {
  id: string;
  /** Which phase this whole area belongs to. An item never names a phase
      itself — it would be a second place for the answer to disagree. */
  phase: string;
  name: string;
  note: string;
  en: { name: string; note: string };
};

export type GoliveItem = {
  id: string;
  area: string;
  /** One or two owners, in the order docs/go-live.md writes them («D R»). */
  who: Owner[];
  /** The state this row was in when the document was written. */
  status: Status;
  /**
   * True when this row holds the gate. Every phase-A row is blocking except
   * the ones the document itself calls optional or explicitly not blocking —
   * see `gate()`. Meaningless on a phase-B row and ignored there.
   */
  blocking?: boolean;
  /** The document's own «optional» / «undecided, not blocking». */
  optional?: boolean;
  /** The panel this happens in when it does not happen in the repository —
      Montonio, DPD, Railway. Shown on the card so nobody looks for it here. */
  outside?: string;
  /** Item ids that must be done first. Real, and drawn as such. */
  needs?: string[];
  title: string;
  detail: string;
  en: GoliveText;
};

export type GolivePlan = {
  version: number;
  source: string;
  asOf: string;
  phases: GolivePhase[];
  areas: GoliveArea[];
  items: GoliveItem[];
};

/** The list as shipped. Read-only by convention — the imported JSON module
    object, shared by every request in the process. */
export const PLAN: GolivePlan = planFile as GolivePlan;

/** Every id the list knows. A state keyed by anything else is refused. */
export const ITEM_IDS: ReadonlySet<string> = new Set(PLAN.items.map((i) => i.id));

const ITEM_BY_ID: ReadonlyMap<string, GoliveItem> = new Map(PLAN.items.map((i) => [i.id, i]));
const PHASE_OF_AREA: ReadonlyMap<string, string> = new Map(PLAN.areas.map((a) => [a.id, a.phase]));

/** The phase an item sits in, through its area. `""` for an area the file does
    not declare — which the plan test refuses, so it cannot ship. */
export function phaseOf(item: GoliveItem): string {
  return PHASE_OF_AREA.get(item.area) || "";
}

/* ---------- the marks ---------------------------------------------------- */

export const STATES_KEY = "golive_states";

export type GoliveState = { status: Status; note: string; at: string; by: string };
export type StateMap = Record<string, GoliveState>;

/** «ключи в воскресенье», «переписал legal.js» — a line, not an essay. */
export const NOTE_MAX = 1_000;
/** «Дима» / «Ренат» / «claude» — a label, never prose. */
export const BY_MAX = 40;
/** Far above any list we would write by hand, and a hard stop on a body that
    is trying to be a database. */
export const MAX_STATES = 400;

/* Control characters other than a newline: stripped, because they cannot be
   typed on purpose and they are exactly what makes a stored string surprising
   later. Tabs become spaces. */
function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/\t/g, " ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, max).trim();
}

/**
 * An ISO instant we are willing to store.
 *
 * `at` decides a merge, and it arrives from a phone whose clock can be wrong.
 * Anything ahead of the server past a minute of ordinary skew is replaced with
 * the moment the request landed — otherwise one misconfigured device wins
 * every future conflict forever. A timestamp in the past is left alone: it is
 * either genuine or it loses, and both are harmless.
 */
function instant(value: unknown, now: number): string {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || ms > now + 60_000) return new Date(now).toISOString();
  return new Date(ms).toISOString();
}

export type CleanResult = { states: StateMap; unknown: string[]; tooMany: boolean };

/**
 * Whatever arrived → states this module is prepared to store.
 *
 * Unknown ids are collected rather than dropped, and the route turns them into
 * a 400 that names them: the page filters its outgoing map against the list it
 * just loaded, so a body carrying one did not come from the page, and
 * answering «fine» to something we did not store is how a mark goes missing
 * without anybody noticing.
 *
 * A row with no usable status falls back to the list's own status for that
 * item rather than to a made-up one — «I am writing a note, I am not saying
 * anything about the state» has to survive the round trip intact.
 */
export function cleanStates(input: unknown, now: number = Date.now()): CleanResult {
  const states: StateMap = {};
  const unknown: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { states, unknown, tooMany: false };

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_STATES) return { states, unknown, tooMany: true };

  for (const [id, raw] of entries) {
    if (!ITEM_IDS.has(id)) {
      if (unknown.length < 10) unknown.push(id.slice(0, 80));
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const s = raw as Record<string, unknown>;
    const status = typeof s.status === "string" && STATUS_SET.has(s.status) ? (s.status as Status) : null;
    const note = text(s.note, NOTE_MAX);
    /* Neither a status nor a note is not a mark — it is what the page sends
       for a card somebody opened and left alone. */
    if (!status && !note) continue;
    states[id] = {
      status: status ?? (ITEM_BY_ID.get(id) as GoliveItem).status,
      note,
      at: instant(s.at, now),
      by: text(s.by, BY_MAX),
    };
  }
  return { states, unknown, tooMany: false };
}

/**
 * Stored + incoming, per item id, newer `at` wins.
 *
 * `>=` rather than `>`: re-sending the same mark (a retry, the page pushing
 * its local copy up) must be a no-op that still leaves the incoming copy in
 * place, not a coin toss decided by string comparison.
 */
export function mergeStates(stored: StateMap, incoming: StateMap): StateMap {
  const out: StateMap = { ...stored };
  for (const [id, next] of Object.entries(incoming)) {
    const prev = out[id];
    if (!prev || next.at >= prev.at) out[id] = next;
  }
  return out;
}

/* ---------- what an item's state actually is ----------------------------- */

/**
 * The status to believe: what somebody last said, and failing that what
 * docs/go-live.md said on `asOf`.
 *
 * Every question this file answers — the lock, the counts, whether a
 * dependency is satisfied — goes through here. Reading `states[id]` directly
 * would make a freshly deployed page claim that nothing at all has been done,
 * including the two rows the document already marks done.
 */
export function statusOf(item: GoliveItem, states: StateMap): Status {
  return states[item.id]?.status ?? item.status;
}

export function statusOfId(id: string, states: StateMap): Status | null {
  const item = ITEM_BY_ID.get(id);
  return item ? statusOf(item, states) : null;
}

/** The phase an id sits in, `""` for an id the list does not know. The route
    needs this to hold the phase-B lock against a caller that is not the page. */
export function phaseOfId(id: string): string {
  const item = ITEM_BY_ID.get(id);
  return item ? phaseOf(item) : "";
}

/** The ids in `item.needs` that are not done yet — what is holding this row,
    named. Empty for a row nothing is waiting on. */
export function holdUps(item: GoliveItem, states: StateMap): string[] {
  const needs = item.needs || [];
  return needs.filter((id) => {
    const st = statusOfId(id, states);
    return st !== null && st !== "done";
  });
}

export type Gate = { locked: boolean; blockers: string[] };

/**
 * The owner's rule, as a function: «before that switch to live domain, we need
 * to get all items done in the diipsolution environment».
 *
 * Locked while any blocking phase-A row is not done, and `blockers` names
 * every one of them so the page can say what is holding it rather than only
 * that something is. Optional rows — the ones docs/go-live.md itself calls
 * optional or «undecided, not blocking» — carry `blocking: false` and are
 * counted nowhere near this.
 *
 * Phase B's rows are not consulted at all: this asks whether the door may be
 * opened, not what is behind it.
 */
export function gate(states: StateMap): Gate {
  const blockers: string[] = [];
  for (const item of PLAN.items) {
    if (phaseOf(item) !== "a" || !item.blocking) continue;
    if (statusOf(item, states) !== "done") blockers.push(item.id);
  }
  return { locked: blockers.length > 0, blockers };
}

export type Counts = { total: number; done: number; doing: number; blocked: number; todo: number };

/** What a phase's progress line counts, computed the same way on both sides.
    `phase` omitted counts the whole list. */
export function progress(states: StateMap, phase?: string): Counts {
  const out: Counts = { total: 0, done: 0, doing: 0, blocked: 0, todo: 0 };
  for (const item of PLAN.items) {
    if (phase && phaseOf(item) !== phase) continue;
    out.total += 1;
    out[statusOf(item, states)] += 1;
  }
  return out;
}

/* ---------- storage ------------------------------------------------------ */

/* The row holds `{v, states}` rather than the bare map, for the same reason
   testplan_answers does: the wire shape is fixed, the row is ours, and a
   version marker is what makes the next change to this document a migration
   rather than a guess. */
type Row = { v: number; states: StateMap };

/** Everything anybody has marked. `{}` when nothing has been saved yet — which
    is not the same as «nothing is done»; see `statusOf()`. */
export async function getGoliveStates(): Promise<StateMap> {
  const rows = await query<{ value: unknown }>("select value from settings where key = $1", [STATES_KEY]);
  const value = rows[0]?.value as Partial<Row> | undefined;
  const states = value && typeof value === "object" ? (value.states as StateMap | undefined) : undefined;
  if (!states || typeof states !== "object" || Array.isArray(states)) return {};
  /* Read back through the same cleaner the writes go through: the row is one
     admin PUT /api/admin/settings away from holding anything at all, and a
     page on a phone must not have to defend against that. */
  return cleanStates(states).states;
}

/** Merges `incoming` into the stored document and returns the result. */
export async function saveGoliveStates(incoming: StateMap): Promise<StateMap> {
  const merged = mergeStates(await getGoliveStates(), incoming);
  await setSetting(STATES_KEY, { v: 1, states: merged } satisfies Row);
  return merged;
}
