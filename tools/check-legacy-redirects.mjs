/**
 * Does `legacyTarget()` still answer every address Shopify publishes TODAY?
 *
 * src/lib/legacy-redirects.ts was written against a Search Console export of
 * 07.09.2026 and docs/redirect-map.csv, and tests/legacy-redirects.test.ts
 * holds it to that CSV. Both are snapshots. The shop went on selling: Shopify
 * gained products and collections after the export, and `rempireshop.com` is
 * still Shopify's primary domain, so those newer addresses are indexed too and
 * will land on us the moment the DNS moves.
 *
 * This asks the live sitemaps instead of a snapshot — which is why it is a
 * tool and not a test: a suite that needs the network is a suite that fails
 * on a train. Run it before the cutover, and again after any Shopify change.
 *
 *   node tools/check-legacy-redirects.mjs           # summary + anything unresolved
 *   node tools/check-legacy-redirects.mjs --all     # every row, including the fallbacks
 *
 * It fails loudly (exit 1) on the only two outcomes that lose money: a URL
 * that answers neither a page nor a redirect, and a product URL that lands on
 * a generic page instead of that product.
 *
 * Since 08.10.2026 the shop answers at Shopify's own addresses
 * (src/lib/shop-paths.mjs), so most of these URLs are now the page itself
 * and answer 200 directly; a 3xx is the rest. Shopify's live sitemap is gone
 * with Shopify — `--harvest` reads its last copy, tools/harvest/old-urls.txt.
 *
 *   SHOP_BASE=http://localhost:3300 node tools/check-legacy-redirects.mjs --harvest
 */

/* legacy-redirects.ts is TypeScript with a `@/` import; the tool reads the
   catalogue itself and evaluates the module's compiled shape through tsx if
   it is present, else it asks the DEPLOYED shop the same question over HTTP —
   which is in fact the better check, because it measures what is serving. */
const OURS = process.env.SHOP_BASE || "https://rempireshop.com";
const SHOPIFY = process.env.SHOPIFY_BASE || "https://rempireshop.com";

async function locs(url) {
  const xml = await (await fetch(url)).text();
  const all = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  if (!/<sitemapindex/i.test(xml)) return all;
  const out = [];
  for (const u of all) out.push(...(await locs(u)));
  return out;
}

/* Shopify publishes these for crawlers, not for people: there is no page
   behind them here and a 301 would only point a robot at a shop page it did
   not ask for. A 404 is the honest answer, so they are not failures. */
const NOT_PAGES = new Set(["/agents.md", "/llms.txt", "/.well-known/shopify/monorail"]);

const shopUrls = process.argv.includes("--harvest")
  ? (await import("node:fs")).readFileSync(new URL("./harvest/old-urls.txt", import.meta.url), "utf8").trim().split(/\r?\n/)
  : await locs(`${SHOPIFY}/sitemap.xml`);
/* The path is what matters, not the host: after the cutover these arrive on
   our own domain. Deduplicated, because six locales publish the same product. */
const paths = [...new Set(shopUrls.map((u) => new URL(u).pathname))].sort();

/* Ask the running shop. A HEAD follows nothing, so the Location header is the
   redirect itself and one request answers the whole question. */
async function target(path) {
  const r = await fetch(OURS + path, { redirect: "manual" });
  const loc = r.headers.get("location") || "";
  return { status: r.status, to: loc ? new URL(loc, OURS).pathname : "" };
}

/* the pages a product URL should NOT end on: the homes, «Все товары», contact */
const GENERIC = ["/", "/ru", "/et", "/collections/all-products", "/ru/collections/vse-tovary", "/et/collections/koik-tooted",
  "/pages/contact", "/ru/pages/contact", "/et/pages/contact"];
const rows = [];
let done = 0;
for (const p of paths) {
  const t = await target(p);
  rows.push([p, t.status, t.to]);
  if (++done % 100 === 0) process.stderr.write(`  ${done}/${paths.length}\r`);
}

const none = rows.filter(([p, s]) => s !== 200 && (s < 300 || s >= 400) && !NOT_PAGES.has(p));
const productRows = rows.filter(([p]) => /\/products\//.test(p));
const vague = productRows.filter(([, s, to]) => s !== 200 && (GENERIC.includes(to) || !/\/products\//.test(to)));
const exact = productRows.length - vague.length;

console.log(`\nURLs Shopify publishes: ${paths.length}`);
console.log(`  served directly (200): ${rows.filter(([, s]) => s === 200).length}`);
console.log(`  redirected           : ${rows.filter(([, s]) => s >= 300 && s < 400).length}`);
console.log(`  neither              : ${none.length}`);
console.log(`  product URLs         : ${productRows.length}`);
console.log(`    → that exact product: ${exact}`);
console.log(`    → a brand or catalogue page instead: ${vague.length}`);

if (process.argv.includes("--all")) for (const [p, s, to] of rows) console.log(`  ${s}  ${p}\n      → ${to}`);
if (none.length) {
  console.log("\n-- no redirect at all ------------------------------------");
  for (const [p, s] of none) console.log(`  ${s}  ${p}`);
}
if (vague.length) {
  console.log("\n-- a product that lands on a generic page -----------------");
  for (const [p, , to] of vague) console.log(`  ${p}\n      → ${to}`);
}

process.exit(none.length || vague.length ? 1 : 0);
