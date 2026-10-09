/**
 * The disease and treatment words no shop text may use, in the three
 * languages — a product text, a hand-written meta description, a chooser
 * line. Cosmetic effects are fine («против перхоти», «успокаивает кожу
 * головы», «for fine, weakened hair»); a claim to treat, heal or stop
 * anything is not. Shared by tests/product-names-claims-r2.test.ts (the
 * catalogue's own texts) and tests/product-meta.test.ts (the words the shop
 * writes about them in src/lib/seo-copy.mjs).
 */
export const CLAIMS: RegExp[] = [
  /\bacne\b|acne-prone|\beczema|dermatitis|psoria/i, /anti-?inflammat|\binflammation\b/i, /\bheal(s|ing|ed)?\b|\bcures?\b/i,
  /therapeut|\bhair loss\b|prone to falling out|antisept|antimicrob|anti-?bacter|breakouts?/i,
  /акне|экзем|дерматит|псориаз|противовоспал|воспален|заживл|лечеб|лечит|терапевт|выпаден|антисепт|антимикроб|антибактер|высыпан/i,
  /\bakne|ekseem|dermatiit|psoriaas|põletik|ravitoime|terapeut|väljalangemi|antisept|antimikroob|antibakter|vistrik|paranemis|paraneb/i,
];

/** «Vital Cure» / «Oil Cure» are the maker's product names, not a claim. */
export const withoutMakerNames = (s: string): string =>
  String(s || "").replace(/<[^>]+>/g, " ").replace(/\b(?:Vital|Oil) Cure\b/gi, "").replace(/\s+/g, " ");

/** The first claim word in `s`, with forty characters either side — or null. */
export function claimIn(s: string): string | null {
  const t = withoutMakerNames(s);
  for (const rx of CLAIMS) {
    const m = rx.exec(t);
    if (m) return t.slice(Math.max(0, m.index - 40), m.index + 40);
  }
  return null;
}
