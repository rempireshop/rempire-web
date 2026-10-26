/**
 * A product's subsection — the chip under its section («Шампуни», «После
 * бритья»), and for six of them an SEO page of its own (SUB_HANDLES in
 * src/lib/shop-paths.mjs, /collections/aftershave …).
 *
 * Since 26.10.2026 it is the product's OWN, one per product (Dim: «they are
 * there for SEO and should not use some kind of keywords»), never read off its
 * name: a rename that dropped the type word had taken an aftershave balm off
 * its page and failed the build. Where it lives:
 *
 *   - a catalogue product: `sub` in public/shop/catalogue2.js («beard/af», the
 *     section included, so a product moved to another section takes nothing
 *     with it) and `sb` in src/data/catalogue.min.json, the same value;
 *   - over it, the owner's «Подраздел» — product_overrides.subcat: a chip id,
 *     or «-» for «Без подраздела»;
 *   - an own product («c-…»): its row's subcat, "" for none.
 *
 * The chips and their labels are SUBCATS in public/shop2/app.js;
 * tests/subsections.test.ts holds this table to it.
 */
import catalogueMin from "@/data/catalogue.min.json";

export type Subsection = { id: string; name: string };

/** Per section, in the order the shop shows the chips. */
export const SUBSECTIONS: Readonly<Record<string, readonly Subsection[]>> = Object.freeze({
  hair: [
    { id: "sh", name: "Шампуни" },
    { id: "co", name: "Кондиционеры" },
    { id: "ca", name: "Маски и уход" },
    { id: "sp", name: "Спреи" },
  ],
  styling: [
    { id: "pw", name: "Пасты и воски" },
    { id: "sp", name: "Спреи" },
    { id: "ge", name: "Гели" },
    { id: "pu", name: "Пудры" },
    { id: "cu", name: "Для локонов" },
    { id: "cr", name: "Кремы и лосьоны" },
  ],
  beard: [
    { id: "oi", name: "Масла" },
    { id: "ba", name: "Бальзамы" },
    { id: "af", name: "После бритья" },
    { id: "ge", name: "Гели" },
    { id: "mw", name: "Воск для усов" },
  ],
  face: [
    { id: "to", name: "Тонеры" },
    { id: "cl", name: "Очищение" },
    { id: "cs", name: "Кремы и сыворотки" },
    { id: "oi", name: "Масла" },
    { id: "ma", name: "Маски" },
    { id: "ey", name: "Для глаз" },
  ],
});

/** «Без подраздела» as product_overrides.subcat stores it. */
export const NO_SUBSECTION = "-";

const FILE_SUB = new Map(
  (catalogueMin as Array<{ id: string; sb?: string }>).filter((p) => p.sb).map((p) => [p.id, p.sb as string]),
);

export function isSubsection(cat: string, id: string): boolean {
  return (SUBSECTIONS[cat] || []).some((s) => s.id === id);
}

export function subsectionName(cat: string, id: string): string {
  return (SUBSECTIONS[cat] || []).find((s) => s.id === id)?.name ?? "";
}

/**
 * The chip a product is under, "" for none. `own` is the owner's choice — the
 * override's subcat for a catalogue product, the row's for an own one.
 */
export function subsectionOf(p: { id: string; cat: string }, own: string | null | undefined): string {
  const o = String(own ?? "").trim();
  if (o === NO_SUBSECTION) return "";
  if (o) return isSubsection(p.cat, o) ? o : "";
  const f = FILE_SUB.get(p.id) || "";
  const cut = f.indexOf("/");
  if (cut < 0 || f.slice(0, cut) !== p.cat) return "";
  const id = f.slice(cut + 1);
  return isSubsection(p.cat, id) ? id : "";
}

/**
 * A subsection asked for by Claude or «Помощник»: a chip id («af») or its
 * Russian label («После бритья»), or ""/«none»/«-» for none. `undefined` when
 * nothing was asked; `{ error }` when the section has no such chip.
 */
export function readSubsection(cat: string, raw: unknown): { id: string } | { error: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim();
  if (!v || v === NO_SUBSECTION || /^(none|нет|без подраздела)$/i.test(v)) return { id: "" };
  const list = SUBSECTIONS[cat] || [];
  const hit = list.find((s) => s.id === v.toLowerCase() || s.name.toLowerCase() === v.toLowerCase());
  if (hit) return { id: hit.id };
  return {
    error: list.length
      ? `subsection: one of ${list.map((s) => `${s.id} (${s.name})`).join(", ")}, or "" for none.`
      : `this section has no subsections — send subsection "" or leave it out.`,
  };
}
