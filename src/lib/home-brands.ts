/* settings.home_brands — the brands the home page's brand row leaves out
   (Renat, 31.10.2026: «Удали из строки CBD DAILY и LUMIN» — and nothing in
   the panel could). The row is every brand the catalogue has, logo brands
   first (screenHome in public/shop2/app.js); only the exceptions are stored,
   so a brand added later is in the row without anyone switching it on.

     { hidden: ["CBD Daily", "Lumin Skin"] }

   Written by «Настройки → Главная страница → Строка брендов», the panel's
   «Помощник» (set_home_brands) and Renat's Claude (save_brand_strip in
   src/lib/mcp/tools.ts) — cleaned here on the way in. The brand keeps its
   page, its place in the menu and its products: only the row changes. */

export type HomeBrands = { hidden: string[] };

const MAX_BRANDS = 300;
const MAX_NAME = 60;

function name(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();
}

/** The row as it may be stored — names one line each, no repeats (case aside), anything else dropped. */
export function cleanHomeBrands(raw: unknown): HomeBrands {
  const list = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { hidden?: unknown }).hidden : undefined;
  const hidden: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(list)) {
    for (const v of list) {
      const n = name(v);
      if (!n || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      hidden.push(n);
      if (hidden.length >= MAX_BRANDS) break;
    }
  }
  return { hidden };
}

/** `cur` with `hide` taken out of the row and `show` put back — names compared without case. */
export function patchHomeBrands(cur: HomeBrands, hide: string[], show: string[]): HomeBrands {
  const back = new Set(show.map((s) => s.toLowerCase()));
  const kept = cur.hidden.filter((h) => !back.has(h.toLowerCase()));
  return cleanHomeBrands({ hidden: [...kept, ...hide.filter((h) => !back.has(h.toLowerCase()))] });
}

/** The names in `raw` (a name or a list of them) that are brands of `brands`, spelt the shop's way; and the ones that are not. */
export function matchBrands(raw: unknown, brands: Iterable<string>): { found: string[]; unknown: string[] } {
  const byLower = new Map<string, string>();
  for (const b of brands) byLower.set(b.toLowerCase(), b);
  const found: string[] = [];
  const unknown: string[] = [];
  for (const v of Array.isArray(raw) ? raw : raw == null ? [] : [raw]) {
    const n = name(v);
    if (!n) continue;
    const hit = byLower.get(n.toLowerCase());
    if (hit) { if (!found.includes(hit)) found.push(hit); }
    else unknown.push(n);
  }
  return { found, unknown };
}
