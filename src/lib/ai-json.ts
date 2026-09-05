/**
 * The JSON a model writes, read tolerantly.
 *
 * Both AI routes (src/app/api/assistant/route.ts, src/app/api/admin/ai/text/
 * route.ts) ask for `response_format: json_object` — and still got, on a bad
 * day, a reply wrapped in a ```json fence, a sentence before the brace, or a
 * document cut mid-string by max_tokens. JSON.parse() throws on all three,
 * and the assistant used to fall back to printing the raw text: the owner
 * saw `{"reply":"Написал черновик…","action":{"type":"draft_post",…` in the
 * panel instead of a sentence.
 *
 * extractJsonObject() finds the object in whatever came back and, when the
 * document was cut, closes it: the open string is closed, an unfinished
 * member is dropped, the open brackets are closed — and if that still does
 * not parse, it backs up to the previous comma and tries again. What comes
 * back is flagged: `truncated` when the text was cut (or the completion
 * itself says finish_reason "length"), `repaired` when the object needed
 * any surgery at all. The caller decides what a cut object is worth — a
 * `reply` salvaged from a truncated answer is still a sentence, a
 * half-written article is not an article.
 *
 * Pure: no network, no database. Tested in tests/ai-json.test.ts.
 */

export interface ExtractedJson {
  /** The object, or null when there was no parseable object at all. */
  value: Record<string, unknown> | null;
  /** The text was cut off — by max_tokens, or the object never closed. */
  truncated: boolean;
  /** Fences/prefix stripped or brackets closed: the parse did not succeed as-is. */
  repaired: boolean;
}

const MAX_REPAIR_STEPS = 60;

/** ```json … ``` (closed or not) → what is inside; anything else unchanged. */
function unfence(text: string): { text: string; changed: boolean } {
  const closed = /```[a-zA-Z]*\s*([\s\S]*?)```/.exec(text);
  if (closed && closed[1].includes("{")) return { text: closed[1], changed: true };
  const open = /```[a-zA-Z]*\s*([\s\S]*)$/.exec(text);
  if (open && open[1].includes("{")) return { text: open[1], changed: true };
  return { text, changed: false };
}

function parseObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface Structural { pos: number; ch: string }

interface Scan {
  /** Where the top-level object closed, or -1 when it never did. */
  closedAt: number;
  /** The brackets still open at the end, outermost first. */
  stack: string[];
  /** The scanner ended inside a string literal. */
  inString: boolean;
  /** Every `{ [ , :` outside a string, in order (closers pop the stack and are not listed). */
  structurals: Structural[];
}

/** One pass over `s`: bracket depth, string state, the structural characters. */
function scan(s: string): Scan {
  const out: Scan = { closedAt: -1, stack: [], inString: false, structurals: [] };
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (out.inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') out.inString = false;
      continue;
    }
    if (ch === '"') { out.inString = true; continue; }
    if (ch === "{" || ch === "[") { out.stack.push(ch); out.structurals.push({ pos: i, ch }); continue; }
    if (ch === "}" || ch === "]") {
      out.stack.pop();
      if (!out.stack.length) { out.closedAt = i; return out; }
      continue;
    }
    if (ch === "," || ch === ":") out.structurals.push({ pos: i, ch });
  }
  return out;
}

/** A whole JSON scalar: a closed string, a number, true/false/null. */
function isCompleteScalar(tail: string): boolean {
  if (!tail) return false;
  if (/^"(?:[^"\\]|\\.)*"$/.test(tail)) return true;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(tail)) return true;
  return tail === "true" || tail === "false" || tail === "null";
}

/**
 * `s` closed: the open string first, then the unfinished member at the end
 * (a key with no value, a value cut mid-literal, a dangling comma), then every
 * open bracket. The result may still not parse — repair() backs up further.
 */
function closeOpen(s: string): string {
  let t = s;
  if (scan(t).inString) {
    // a cut string may end on a lone backslash — closing it there would escape the quote
    if (/(^|[^\\])(\\\\)*\\$/.test(t)) t = t.slice(0, -1);
    t += '"';
  }
  const sc = scan(t);
  const st = sc.structurals;
  const last = st[st.length - 1];
  if (last) {
    const tail = t.slice(last.pos + 1).trim();
    const inArray = sc.stack[sc.stack.length - 1] === "[";
    if (last.ch === ":") {
      // `"key": <value>` — the value must be whole, or the member goes
      if (!isCompleteScalar(tail)) {
        const before = st[st.length - 2];
        t = before ? t.slice(0, before.ch === "{" ? before.pos + 1 : before.pos) : t.slice(0, last.pos);
      }
    } else if (last.ch === "," || last.ch === "{") {
      // after a comma or an opening brace comes a key (in an object) or a value (in an array)
      if (inArray ? !isCompleteScalar(tail) : true) {
        if (tail || last.ch === ",") t = t.slice(0, last.ch === "," ? last.pos : last.pos + 1);
      }
    } else if (last.ch === "[") {
      if (tail && !isCompleteScalar(tail)) t = t.slice(0, last.pos + 1);
    }
  }
  t = t.replace(/,\s*$/, "");
  const closers = scan(t).stack.slice().reverse().map((b) => (b === "{" ? "}" : "]")).join("");
  return t + closers;
}

/** Close what is open; if that does not parse, back up to the previous comma and try again. */
function repair(s: string): Record<string, unknown> | null {
  let cur = s;
  for (let step = 0; step < MAX_REPAIR_STEPS; step++) {
    const v = parseObject(closeOpen(cur));
    if (v) return v;
    const st = scan(cur).structurals.filter((x) => x.ch === ",");
    if (!st.length) return null;
    cur = cur.slice(0, st[st.length - 1].pos);
  }
  return null;
}

/**
 * The object inside `raw`, however it was wrapped or cut.
 * `finishReason` is the completion's own word (OpenAI: "length" = cut by max_tokens).
 */
export function extractJsonObject(raw: unknown, opts: { finishReason?: string | null } = {}): ExtractedJson {
  const cut = opts.finishReason === "length";
  let text = typeof raw === "string" ? raw.replace(/^﻿/, "").trim() : "";
  if (!text) return { value: null, truncated: cut, repaired: false };

  // 1. as-is — the common case, nothing to do
  const direct = parseObject(text);
  if (direct) return { value: direct, truncated: cut, repaired: false };

  // 2. fences, and any prose before the first brace
  const unfenced = unfence(text);
  text = unfenced.text;
  const start = text.indexOf("{");
  if (start < 0) return { value: null, truncated: cut, repaired: unfenced.changed };
  text = text.slice(start);

  // 3. a closed object followed by trailing prose
  const sc = scan(text);
  if (sc.closedAt >= 0) {
    const whole = parseObject(text.slice(0, sc.closedAt + 1));
    if (whole) return { value: whole, truncated: cut, repaired: true };
  }

  // 4. the object never closed — it was cut; salvage what parses
  const fixed = repair(text);
  return { value: fixed, truncated: true, repaired: true };
}

/** True when a string looks like JSON rather than a sentence — never print such a thing to the owner. */
export function looksLikeJson(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (!t) return false;
  if (/^[{[]/.test(t) || /^```/.test(t)) return true;
  return /"(reply|action|product_ids|tab)"\s*:/.test(t);
}
