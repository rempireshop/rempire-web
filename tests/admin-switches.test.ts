/**
 * A switch that is not in the delegated click list does nothing at all.
 *
 * public/shop2/app.js listens for clicks once, on `document`, and the very
 * first thing that handler does is `e.target.closest("[data-a],[data-b],…")`.
 * An element whose attribute is missing from that string never becomes `t`,
 * so the `if (d.something !== undefined)` branch written for it below is
 * unreachable — the button looks right, presses, and silently does nothing.
 *
 * That is exactly what had happened to «Спрашивать перевозчика» in «Настройки
 * → Доставка и оплата»: the switch was rendered, the handler was written, the
 * e2e checked that it was *visible*, and nothing connected the two (found
 * 07.09.2026, docs/audit/2026-09-07-montonio.md). This test is the wire.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** The one `e.target.closest("[data-…],[data-…]")` the click handler opens with. */
function delegated(): Set<string> {
  const m = src.match(/e\.target\.closest\("(\[data-[^"]*)"\)/);
  if (!m) throw new Error("public/shop2/app.js no longer opens its click handler with one closest() list");
  return new Set(m[1].split(",").map((s) => s.trim()));
}

/** `d.admBank` → `[data-adm-bank]`, the way the DOM spells a dataset key. */
function attrFor(name: string): string {
  return "[data-" + name.replace(/([A-Z])/g, (c) => "-" + c.toLowerCase()) + "]";
}

/**
 * `d.ident` is read off whatever element another selector already matched
 * (`identLogo(t)` runs before every branch), so it is never a selector of its
 * own. It is the only such read, and naming it here keeps the sweep honest.
 */
const PIGGYBACK = new Set(["ident"]);

describe("the panel's delegated click list", () => {
  it("carries every attribute the click handler branches on", () => {
    const list = delegated();
    const missing: string[] = [];
    for (const m of src.matchAll(/\bd\.([A-Za-z0-9]+) !== undefined\b/g)) {
      const name = m[1];
      if (PIGGYBACK.has(name)) continue;
      if (!list.has(attrFor(name))) missing.push(`${name} → ${attrFor(name)}`);
    }
    expect(missing).toEqual([]);
  });

  it("carries the two switches on «Настройки → Доставка и оплата»", () => {
    const list = delegated();
    // «Какие банки показывать» — one switch per Montonio bank
    expect(list.has("[data-admbank]")).toBe(true);
    // «Спрашивать перевозчика» — the one that had been dead
    expect(list.has("[data-delivcarrier]")).toBe(true);
  });
});
