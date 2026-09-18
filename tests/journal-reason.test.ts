/**
 * «Журнал заказа» must say WHY, not only that something failed — audit F16/F37.
 *
 * The shop spends real effort composing a trilingual explanation when Montonio
 * refuses a refund or a carrier refuses a parcel: `src/lib/montonio-problems.ts`
 * turns the provider's answer into a sentence the owner can act on, and quotes
 * the provider verbatim when it cannot. All of it was shown in a `toast()` —
 * 2 600 ms, no undo — and then existed only inside the audit row's JSON.
 *
 * The fallback sentence for a refusal says «Причина — в журнале заказа». The
 * journal printed `AUDIT_WORDS[action] + ": " + number` and nothing else, so
 * the owner followed that instruction and found «Возврат не прошёл: R-100042».
 * Every word of the explanation was in the database and no screen showed it.
 *
 * Two fixes, tested here against the real lines out of `public/shop2/app.js`:
 * the reason now travels into the row, and seven actions the server writes got
 * the Russian word they were missing — until 19.09.2026 the journal printed
 * «order.refund: R-100042», a dotted English code in a panel whose whole rule
 * is plain Russian, for an event that is money leaving.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* CRLF: this repository is checked out with core.autocrlf on Windows, so the
   file on disk has \r\n and any anchor with a bare \n never matches. */
const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(
  /\r\n?/g,
  "\n",
);

/** The body of one `function <name>(…) {…}`, brace-matched rather than sliced
    to the next `;\n` — this one contains both braces and semicolons. */
function fn(name: string): string {
  const head = app.indexOf(`function ${name}(`);
  if (head < 0) throw new Error(`public/shop2/app.js no longer has function ${name}`);
  const open = app.indexOf("{", head);
  let depth = 0;
  for (let i = open; i < app.length; i++) {
    const c = app[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return app.slice(head, i + 1);
  }
  throw new Error(`unterminated function ${name} in public/shop2/app.js`);
}

/** `var AUDIT_WORDS = { … };` — an object literal, brace-matched the same way. */
function objectLiteral(decl: string): string {
  const head = app.indexOf(decl);
  if (head < 0) throw new Error(`public/shop2/app.js no longer has ${decl}`);
  const open = app.indexOf("{", head);
  let depth = 0;
  for (let i = open; i < app.length; i++) {
    const c = app[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return app.slice(open, i + 1);
  }
  throw new Error(`unterminated ${decl} in public/shop2/app.js`);
}

type Row = { action: string; payload?: Record<string, unknown> };

const WORDS = new Function(`return (${objectLiteral("var AUDIT_WORDS = {")});`)() as Record<string, string>;

/* The real function, over stubs of the two helpers it calls. `esc` is the
   shop's own escaper and `admPiecesHTML` the path a server-composed line takes;
   neither is what this file is about, and both are marked so a test reading the
   output can tell whose branch produced it. */
const auditTextHTML = new Function(
  "AUDIT_WORDS",
  "esc",
  "admPiecesHTML",
  `${fn("auditTextHTML")}; return auditTextHTML;`,
)(
  WORDS,
  (s: unknown) => String(s),
  (s: unknown) => `[pieces]${String(s)}`,
) as (row: Row) => string;

describe("AUDIT_WORDS — every action the server writes has a Russian word", () => {
  /* The seven that were missing. Two of them are money and one is the go-live
     list; all seven printed as their raw dotted code. */
  it.each([
    ["order.refund", "Возврат денег"],
    ["giftcards.voided", "Подарочные карты аннулированы"],
    ["invoice.cancelled", "Счёт отменён"],
    ["invoice.reminded", "Напоминание по счёту"],
    ["return.handled", "Возврат обработан"],
    ["golive.save", "Отметка в списке запуска"],
    ["testplan.save", "Отметка в плане проверки"],
  ])("names %s", (action, word) => {
    expect(WORDS[action]).toBe(word);
  });

  it("still names the three it already knew about refunds and parcels", () => {
    expect(WORDS["order.refund_failed"]).toBe("Возврат не прошёл");
    expect(WORDS["order.refund_stuck"]).toBe("Возврат не дошёл до покупателя");
    expect(WORDS["shipment.registration_failed"]).toBe("Перевозчик не принял посылку");
  });

  it("holds no word that is itself a dotted code — the panel is in Russian", () => {
    for (const [action, word] of Object.entries(WORDS)) {
      expect(word, `${action} is not translated`).not.toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});

describe("auditTextHTML — the row the owner reads when something failed", () => {
  it("prints Montonio's own sentence under the label and the number", () => {
    const html = auditTextHTML({
      action: "order.refund_failed",
      payload: {
        number: "R-100042",
        reason: "provider_rejected",
        detail: "Refund amount exceeds the total amount refundable [0]",
      },
    });
    expect(html).toContain("Возврат не прошёл");
    expect(html).toContain("R-100042");
    expect(html).toContain("Refund amount exceeds the total amount refundable [0]");
  });

  it("falls back to our own token when the provider said nothing", () => {
    const html = auditTextHTML({
      action: "shipment.registration_failed",
      payload: { number: "100042", reason: "bad_point" },
    });
    expect(html).toContain("Перевозчик не принял посылку");
    expect(html).toContain("bad_point");
  });

  it("says nothing extra when the reason is «unknown» — that is not a reason", () => {
    const html = auditTextHTML({
      action: "shipment.registration_failed",
      payload: { number: "100042", reason: "unknown" },
    });
    expect(html).not.toContain("unknown");
  });

  it("does not print the same string twice when the reason IS the value", () => {
    const html = auditTextHTML({ action: "promo.set", payload: { code: "СКИДКА20", detail: "СКИДКА20" } });
    expect(html.match(/СКИДКА20/g)).toHaveLength(1);
  });

  it("leaves a line the server composed to the path that already existed", () => {
    const html = auditTextHTML({ action: "order.note", payload: { line: "Заметка изменена" } });
    expect(html).toBe("[pieces]Заметка изменена");
  });

  it("keeps the word in a node of its own, so an English panel can translate it", () => {
    /* translateTree() rewrites a text node only when it recognises the WHOLE
       of it. Gluing the word to the number is what left an English panel
       reading Russian in r16, and the reason must not re-introduce it. */
    const html = auditTextHTML({ action: "order.refund", payload: { number: "100042", detail: "Paid back" } });
    expect(html).toContain("<span>Возврат денег</span>");
    expect(html).toContain('<span class="aud__why">Paid back</span>');
  });
});
