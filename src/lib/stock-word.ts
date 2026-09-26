/**
 * «Заканчивается» — ONE rule, for the number on «Обзор» and for the list that
 * number opens.
 *
 * Dim, 26.09.2026 (panel-overview): «Hidden product count in overview is 1 —
 * but when I open it's 2. Same for "products running out" shows in overview
 * 12, not sure if that is also correct.» It was not. The row counted by one
 * rule on the server (qOverviewLowStock in src/lib/analytics.ts) and the list
 * it opened filtered by another in the panel (goodsStockWord / goodsRunsLow in
 * public/shop2/app.js):
 *   · the server read only products with an override row or a counted shelf,
 *     so the catalogue file's own «мало» (69 products on staging, shown as
 *     «мало» on their shop cards) never reached the number — 12 on the row,
 *     ~78 under «Каталог → Кончаются»;
 *   · a product whose 500 мл was counted to zero while its 75 мл was full read
 *     «в наличии» on the server and «кончается» in the list;
 *   · a hand-set «Нет в наличии» over a counted shelf was dropped by the
 *     server and kept by the list;
 *   · the hidden row opened «Скрытые» — every hidden product, running low or
 *     not.
 *
 * These two functions are the panel's two, line for line, and
 * tests/overview-low-parity.test.ts runs the app.js originals and these over
 * the same cases and the same database, so the two copies cannot drift apart
 * without a red test. Change one, change the other.
 *
 * `word` is the product's own word as the shop has it — the feed's stock
 * (getOverrides: the counted shelf where it has a word, the owner's hand-set
 * one otherwise, a hand-set «нет» always) and, with no override at all, the
 * catalogue file's `s`. `rows` are that product's rows of the «Склад» table
 * (getLevels in src/lib/inventory.ts): every size, counted or not.
 */
export type ShelfState = "in" | "low" | "out";
export type ShelfRow = { tracked: boolean; state: ShelfState };

/** goodsStockWord(): the product's badge — «В наличии» / «Мало» / «Нет». */
export function shelfWord(word: string | null | undefined, rows: readonly ShelfRow[]): ShelfState {
  if (word === "out") return "out";
  let all = 0;
  let counted = 0;
  let out = 0;
  let low = 0;
  for (const r of rows) {
    all++;
    if (!r.tracked) continue;
    counted++;
    if (r.state === "out") out++;
    else if (r.state === "low") low++;
  }
  if (counted && out < counted) return low ? "low" : "in";
  if (counted && counted === all) return "out";
  return word === "low" ? "low" : "in";
}

/** goodsRunsLow(): on the «Кончаются» list — the badge says «Мало» or «Нет»,
    or any counted size is low or out. One product, however many sizes. */
export function runsLow(word: string | null | undefined, rows: readonly ShelfRow[]): boolean {
  if (shelfWord(word, rows) !== "in") return true;
  return rows.some((r) => r.tracked && (r.state === "low" || r.state === "out"));
}
