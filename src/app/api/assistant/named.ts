/**
 * The product and the page the owner means, with their words — what the
 * admin assistant reads before it writes a text (src/app/api/assistant/route.ts),
 * the way the Claude connector reads get_product and get_page_texts. Beside
 * the route because a Next.js route file may only export its handlers.
 */
import type { CatRow } from "@/lib/catalogue-slice";

/* ---- the product and the page the owner means, with their words ----------
   Dim, 26.10.2026: «Помощник needs to have same capabilities like Claude
   has». Claude reads a product (get_product) and a page (get_page_texts)
   before it writes; the assistant gets the very same answers, for the
   product open in the goods editor and for whatever the owner's words name —
   at most two products and two pages, and only when the words are about
   texts, names or prices (TEXT_TRIGGER), or a product is open. Without this
   it could write a new description but never translate or shorten the one
   that is there. */
export const TEXT_TRIGGER = /описан|текст|назван|переимен|перевед|перевод|google|гугл|seo|заголов|цен[аыуе]|объём|раздел|бренд|kirjeldus|tõlk|tõlgi|nimi|hind|pealkiri|describ|translat|rename|price|title|intro/i;
type NamedPage = { page: "section" | "brand"; key: string };
const WORD = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}.&]+/gu, " ").trim();

/** The products the owner's words name: the open one first, then the best name matches. */
export function namedProductIds(text: string, rows: CatRow[], openId: string): string[] {
  const said = " " + WORD(text) + " ";
  const scored: Array<[number, string]> = [];
  for (const p of rows) {
    const head = p.n.split(" — ")[0];
    const words = [...new Set(WORD(`${p.b} ${head}`).split(" ").filter((w) => w.length >= 3))];
    const hit = words.filter((w) => said.includes(" " + w + " ")).length;
    // the whole line, or two of its words with at least one from the name itself
    const nameHit = WORD(head).split(" ").some((w) => w.length >= 3 && said.includes(" " + w + " "));
    if (said.includes(" " + WORD(head) + " ") || (hit >= 2 && nameHit)) scored.push([hit, p.id]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const ids = openId ? [openId] : [];
  for (const [, id] of scored) if (!ids.includes(id) && ids.length < 2) ids.push(id);
  return ids;
}

/** The section and brand pages the owner's words name. */
export function namedPages(text: string, brands: string[]): NamedPage[] {
  const said = " " + WORD(text) + " ";
  const out: NamedPage[] = [];
  for (const [cat, names] of Object.entries(SECTION_WORDS)) {
    if (names.some((n) => said.includes(n))) out.push({ page: "section", key: cat });
  }
  for (const b of brands) if (said.includes(" " + WORD(b) + " ")) out.push({ page: "brand", key: b });
  return out.slice(0, 2);
}
/* the stems a section is called by, in the three languages the owner writes in */
const SECTION_WORDS: Record<string, string[]> = {
  all: [" все товары", " весь ассортимент", " kõik tooted", " all products"],
  hair: [" волос", " juukse", " juuksehooldus", " hair care"],
  styling: [" стайлинг", " укладк", " viimistl", " styling"],
  beard: [" бород", " habe", " beard"],
  face: [" лица", " лицо", " näo", " face care", " skincare"],
  body: [" тела", " тело", " keha", " body care"],
  perfume: [" парфюм", " ароматы", " parfüüm", " perfume", " fragrance"],
  merch: [" мерч", " футболк", " merch", " t-shirt"],
};

/** What the connector would answer for each of them — one block for the prompt, or "" when nothing is named. */
export async function namedForPrompt(text: string, rows: CatRow[], openId: string): Promise<string> {
  try {
    const { runTool } = await import("@/lib/mcp/tools");
    const ids = namedProductIds(text, rows, openId);
    const brands = [...new Set(rows.map((r) => r.b))];
    const pages = TEXT_TRIGGER.test(text) ? namedPages(text, brands) : [];
    const read = async (tool: string, args: Record<string, unknown>) => {
      const r = await runTool(tool, args);
      return r.isError ? null : r.text.replace(/\s+/g, " ").slice(0, 9000);
    };
    const products = await Promise.all(ids.map((id) => read("get_product", { id })));
    const pageTexts = (await Promise.all(pages.map((p) => read("get_page_texts", p)))).filter(Boolean);
    /* the product on his screen gets a block of its own, named for what it is:
       the live test of 26.10.2026 asked «для какого товара?» three times out
       of three when it was only the first line of a shared list */
    const open = openId && products[0] ? products[0] : "";
    const others = (open ? products.slice(1) : products).filter(Boolean);
    if (!open && !others.length && !pageTexts.length) return "";
    const what = "(names, sizes and prices, the page's description and the Google texts in RU/ET/EN; description_by_owner lists the languages he wrote himself)";
    return [
      open ? `THE PRODUCT OPEN ON THE OWNER'S SCREEN right now ${what}. «этот товар», «этого товара», «его», «описание», «название», «цена», «this product», «see toode» without another product's name mean THIS product — never ask which one:\n${open}` : "",
      others.length ? `PRODUCTS THE OWNER NAMES — as the shop has them now ${what}:\n${others.join("\n")}` : "",
      pageTexts.length ? "PAGES THE OWNER MEANS — a section's or brand's Google title, description and line under the heading as the page shows them now (by_owner = written by him; the rest is the shop's standard text):\n" + pageTexts.join("\n") : "",
    ].filter(Boolean).join("\n\n");
  } catch (err) {
    console.error("[assistant] named products/pages unavailable:", err);
    return "";
  }
}
