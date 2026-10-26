/**
 * src/lib/subsections.ts — the server's copy of the subsection chips, and the
 * one rule for which chip a product is under (26.10.2026: the product's own,
 * never its name's). The chips themselves are SUBCATS in public/shop2/app.js;
 * this holds the two to each other, and «Помощник»'s set_subcat to the rule.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { sanitizeAction, sanitizeCreateProduct } from "@/app/api/assistant/actions";
import { SUBCATS as OWN_SUBCATS } from "@/lib/custom-products";
import { NO_SUBSECTION, readSubsection, SUBSECTIONS, subsectionName, subsectionOf } from "@/lib/subsections";

const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
const LINES = APP.split("\n");
const start = LINES.findIndex((l) => /^ {2}var SUBCATS = \{$/.test(l));
const end = LINES.findIndex((l, i) => i > start && /^ {2}\};$/.test(l));
const ctx: { SUBCATS?: Record<string, Array<{ id: string; name: string }>> } = {};
runInNewContext(LINES.slice(start, end + 1).join("\n") + "\nthis.SUBCATS = SUBCATS;", ctx);

describe("the server's chips are the shop's", () => {
  it("has every section's chips, in order, with their labels", () => {
    const shop = Object.fromEntries(Object.entries(ctx.SUBCATS!).map(([c, l]) => [c, l.map((d) => ({ id: d.id, name: d.name }))]));
    expect(SUBSECTIONS).toEqual(shop);
    expect(OWN_SUBCATS).toEqual(Object.fromEntries(Object.entries(shop).map(([c, l]) => [c, l.map((d) => d.id)])));
  });
});

describe("subsectionOf — the owner's choice, then the catalogue's, never the name", () => {
  const gel = { id: "davines-softening-shaving-gel", cat: "beard" };
  it("reads the catalogue's own (catalogue.min.json `sb`)", () => {
    expect(subsectionOf(gel, null)).toBe("ge");
    expect(subsectionOf({ id: "proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml", cat: "beard" }, null)).toBe("af");
  });
  it("lets the owner's choice win, «-» meaning none", () => {
    expect(subsectionOf(gel, "af")).toBe("af");
    expect(subsectionOf(gel, NO_SUBSECTION)).toBe("");
    expect(subsectionOf(gel, "zz")).toBe("");
  });
  it("gives a product moved to another section none of its old one", () => {
    expect(subsectionOf({ ...gel, cat: "styling" }, null)).toBe("");
  });
  it("gives an own product with nothing chosen none", () => {
    expect(subsectionOf({ id: "c-captain-fawcett-maharajah-beard-balm", cat: "beard" }, "")).toBe("");
  });
});

describe("readSubsection — what Claude or «Помощник» may send", () => {
  it("takes an id or a label of the section's own chips, or none", () => {
    expect(readSubsection("beard", "af")).toEqual({ id: "af" });
    expect(readSubsection("beard", "После бритья")).toEqual({ id: "af" });
    expect(readSubsection("beard", "")).toEqual({ id: "" });
    expect(readSubsection("beard", "-")).toEqual({ id: "" });
    expect(readSubsection("beard", undefined)).toBeUndefined();
  });
  it("refuses another section's chip, naming the ones there are", () => {
    const r = readSubsection("beard", "sh");
    expect(r && "error" in r ? r.error : "").toContain("af (После бритья)");
    expect(readSubsection("perfume", "af")).toMatchObject({ error: expect.stringContaining("no subsections") });
  });
  it("names a chip", () => {
    expect(subsectionName("hair", "co")).toBe("Кондиционеры");
  });
});

describe("«Помощник»: set_subcat and create_product's subcat", () => {
  const known = new Set(["davines-softening-shaving-gel", "c-own-balm"]);
  const products = new Map([["davines-softening-shaving-gel", { name: "Softening Shaving Gel — гель для бритья", brand: "Davines", cat: "beard" }]]);
  it("sets a chip of the product's own section, or none", () => {
    expect(sanitizeAction({ type: "set_subcat", id: "davines-softening-shaving-gel", value: "af" }, known, true, { products }))
      .toEqual({ type: "set_subcat", id: "davines-softening-shaving-gel", value: "af" });
    expect(sanitizeAction({ type: "set_subcat", id: "davines-softening-shaving-gel", value: "-" }, known, true, { products }))
      .toEqual({ type: "set_subcat", id: "davines-softening-shaving-gel", value: "-" });
  });
  it("refuses another section's chip, an own product (update_product does that) and a guest", () => {
    expect(sanitizeAction({ type: "set_subcat", id: "davines-softening-shaving-gel", value: "sh" }, known, true, { products })).toBeNull();
    expect(sanitizeAction({ type: "set_subcat", id: "c-own-balm", value: "ba" }, known, true, { products })).toBeNull();
    expect(sanitizeAction({ type: "set_subcat", id: "davines-softening-shaving-gel", value: "af" }, known, false, { products })).toBeNull();
  });
  it("creates a new product under the chip it was given — none for a wrong one", () => {
    expect(sanitizeCreateProduct({ brand: "Proraso", name: "Beard Balm — бальзам для бороды", cat: "beard", subcat: "ba", price: 14.9 }))
      .toMatchObject({ subcat: "ba" });
    expect(sanitizeCreateProduct({ brand: "Proraso", name: "Beard Balm — бальзам для бороды", cat: "beard", subcat: "sh", price: 14.9 }))
      .toMatchObject({ subcat: "" });
  });
});
