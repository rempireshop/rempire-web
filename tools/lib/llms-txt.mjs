/* /llms.txt — the shop described for AI assistants, in Markdown
   (llmstxt.org): what REMPIRE is, its languages and addresses, the sections
   and the brands with their links in all three languages, delivery and its
   prices, pickup, returns, contact, the policies and the guides.

   Written by tools/prerender-shop2.mjs into public/llms.txt on every build,
   from the data the same run writes the pages from — the catalogue it
   publishes, the section and brand descriptions of src/lib/seo-copy.mjs, the
   delivery table the shipping page prints (deliveryPageHTML() over the rules
   the checkout bills with), the policy titles, the shop's own details, the
   published posts. Nothing in here is typed twice, so it cannot go stale the
   way a hand-written file would. Gitignored, like robots.txt and the sitemap.

   Pure and import-light, so tests/llms-txt.test.ts runs it over the real
   catalogue. English throughout, with the Russian and Estonian addresses
   beside each English one. */

import { CAT_HANDLES, publicPath } from "../../src/lib/shop-paths.mjs";
import { CAT_NAMES_I18N, slugify, T, unentity } from "../../src/lib/seo-head.mjs";
import { seoHead } from "../../src/lib/seo-copy.mjs";

const SECTION_ORDER = ["all", "hair", "styling", "beard", "face", "body", "perfume", "merch"];
const sectionName = (cat, code) => (cat === "all" ? T[code].all : (CAT_NAMES_I18N[cat] || {})[code] || cat);
/* Markdown link text and table cells: no brackets or pipes from the data */
const md = s => String(s == null ? "" : s).replace(/[[\]|]/g, m => "\\" + m).replace(/\s+/g, " ").trim();

/**
 * @param {object} o
 * @param {string} o.base                 absolute origin, no trailing slash
 * @param {Array<{id:string,brand:string,cat:string}>} o.products   what the shop publishes (on sale)
 * @param {{legalName?:string,regCode?:string,vatNumber?:string,address?:string,email?:string,phone?:string}} o.identity
 * @param {string[]} [o.social]           profile URLs
 * @param {string[]} [o.hours]            opening hours, one line a day, English
 * @param {Array<{slug:string,title:string}>} o.policies   English titles
 * @param {{rows:Array<{country:string,carriers:string,locker:string,courier:string,free:string,days:string}>,pickup:string,notes:string[]}|null} o.delivery
 * @param {string} [o.returns]            the returns summary, English
 * @param {Array<{title:string,slug:string}>} [o.posts]
 * @param {{rules:object}|null} [o.ctx]   seoHead()'s context — the rules the checkout bills with
 */
export function buildLlmsTxt(o) {
  const base = String(o.base).replace(/\/+$/, "");
  const url = (code, rest) => base + publicPath(code, rest);
  const id = o.identity || {};
  const out = [];
  const products = o.products || [];

  out.push("# REMPIRE");
  out.push("");
  out.push("> REMPIRE (rempireshop.com) is the online shop of REMPIRE, a barbershop and tattoo studio at " +
    md(id.address || "Mardi 1, Tallinn") + ", Estonia. It sells the professional hair care, styling, beard care, " +
    "skin care and perfume its salon team works with, Korean skincare, tattoo aftercare and REMPIRE's own handmade " +
    "soap and artist T-shirts, with pickup at the salon and delivery across the EU.");
  out.push("");
  out.push("- Shop: " + base + " (" + products.length + " products, " +
    new Set(products.map(p => p.brand)).size + " brands, prices in EUR including VAT)");
  out.push("- The barbershop and tattoo studio at the same address has its own website: https://rempire.ee");
  if (id.legalName) {
    out.push("- Seller: " + md(id.legalName) + (id.regCode ? ", registry code " + md(id.regCode) : "") +
      (id.vatNumber ? ", VAT " + md(id.vatNumber) : ""));
  }
  out.push("- Languages: English (" + base + "/), Russian (" + base + "/ru), Estonian (" + base + "/et). " +
    "Every page exists in all three; the Russian and Estonian addresses carry the /ru or /et prefix.");
  out.push("- Addresses: products /products/<handle>, sections /collections/<handle> (the handle is translated " +
    "per language), brands /collections/<brand> (the same in every language), policies /policies/<name>, " +
    "contact /pages/contact, guides /blogs/news/<slug>. No trailing slash.");
  out.push("");

  out.push("## Sections");
  out.push("");
  const cats = SECTION_ORDER.filter(c => c === "all" || products.some(p => p.cat === c) || CAT_HANDLES[c]);
  for (const c of cats) {
    const rest = "/c/" + c + "/";
    const n = c === "all" ? products.length : products.filter(p => p.cat === c).length;
    out.push("- [" + md(sectionName(c, "EN")) + "](" + url("EN", rest) + "): " + md(seoHead("cat", c, "EN", o.ctx || null).d) +
      " " + n + " products. Russian: [" + md(sectionName(c, "RU")) + "](" + url("RU", rest) + "); Estonian: [" +
      md(sectionName(c, "ET")) + "](" + url("ET", rest) + ")");
  }
  out.push("");

  out.push("## Brands");
  out.push("");
  const brands = [...new Set(products.map(p => p.brand))].sort((a, b) => a.localeCompare(b, "en"));
  for (const b of brands) {
    const mine = products.filter(p => p.brand === b);
    const inCats = [...new Set(mine.map(p => p.cat))].map(c => sectionName(c, "EN").toLowerCase());
    const rest = "/b/" + slugify(b) + "/";
    out.push("- [" + md(b) + "](" + url("EN", rest) + "): " + mine.length + " product" + (mine.length === 1 ? "" : "s") +
      " (" + md(inCats.join(", ")) + "). " + md(seoHead("brand", b, "EN", o.ctx || null).d) +
      " Russian: " + url("RU", rest) + "; Estonian: " + url("ET", rest));
  }
  out.push("");

  out.push("## Delivery and pickup");
  out.push("");
  if (o.delivery && o.delivery.rows.length) {
    out.push("Prices in EUR, VAT included, as the checkout charges them. Details: [Shipping policy](" + url("EN", "/info/shipping/") + ").");
    out.push("");
    out.push("| Destination | Carriers | Parcel locker / pickup point | Courier to the door | Free delivery from | Delivery time |");
    out.push("|---|---|---|---|---|---|");
    for (const r of o.delivery.rows) {
      out.push("| " + [r.country, r.carriers || "—", r.locker, r.courier, r.free, r.days].map(md).join(" | ") + " |");
    }
    out.push("");
    if (o.delivery.pickup) out.push("- " + md(o.delivery.pickup));
    for (const n of o.delivery.notes || []) out.push("- " + md(n));
  } else {
    out.push("- Delivery to Estonia, Latvia, Lithuania, Finland and the rest of the EU; pickup at the salon in Tallinn. Prices: [Shipping policy](" + url("EN", "/info/shipping/") + ").");
  }
  out.push("");

  out.push("## Returns");
  out.push("");
  if (o.returns) out.push(md(o.returns));
  out.push("- [Refund policy](" + url("EN", "/info/returns/") + ") · Russian: " + url("RU", "/info/returns/") + " · Estonian: " + url("ET", "/info/returns/"));
  out.push("");

  out.push("## Contact");
  out.push("");
  if (id.address) out.push("- Address: " + md(id.address) + ", Estonia (pickup counter in the salon)");
  if (id.phone) out.push("- Phone: " + md(id.phone));
  if (id.email) out.push("- Email: " + md(id.email));
  for (const h of o.hours || []) out.push("- " + md(h));
  out.push("- [Contact page](" + url("EN", "/info/contact/") + ")");
  for (const s of o.social || []) out.push("- " + s);
  out.push("");

  out.push("## Policies");
  out.push("");
  for (const p of o.policies || []) {
    const rest = "/info/" + p.slug + "/";
    out.push("- [" + md(p.title) + "](" + url("EN", rest) + ") · Russian: " + url("RU", rest) + " · Estonian: " + url("ET", rest));
  }
  out.push("");

  out.push("## Guides");
  out.push("");
  for (const p of o.posts || []) {
    const rest = "/blog/" + encodeURIComponent(p.slug) + "/";
    out.push("- [" + md(p.title) + "](" + url("EN", rest) + ") · Russian: " + url("RU", rest) + " · Estonian: " + url("ET", rest));
  }
  out.push("- [All guides](" + url("EN", "/blog/") + ")");
  out.push("");

  out.push("## Optional");
  out.push("");
  out.push("- [Sitemap](" + base + "/sitemap.xml)");
  out.push("- [All products](" + url("EN", "/c/all/") + ")");
  out.push("- [Brands](" + url("EN", "/brands/") + ")");
  return out.join("\n") + "\n";
}

const text = h => unentity(String(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\s+([.,;:)])/g, "$1").trim();

/**
 * The delivery facts for llms.txt, read off the shipping page itself —
 * deliveryPageHTML(ctx), rendered in English by the prerender over the rules
 * the checkout bills with — so every price, time and sentence here is the one
 * that page prints: the price table, the delivery times, the pickup line, the
 * notes under the table and the returns summary (the paragraph under the
 * heading `returnsHeading`, the page's own word for «Возврат товара»).
 */
export function deliveryFromPage(pageHtml, { returnsHeading } = {}) {
  const html = String(pageHtml);
  const days = {};
  for (const m of html.matchAll(/<div><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)) days[text(m[1])] = text(m[2]);
  const table = (/<table class="dlv__table">([\s\S]*?)<\/table>/.exec(html) || [])[1] || "";
  const rows = [];
  for (const tr of (table.split("<tbody>")[1] || "").split("</tr>")) {
    const th = /<th scope="row">([\s\S]*?)<\/th>/.exec(tr);
    if (!th) continue;
    const country = text(th[1].replace(/<small[\s\S]*?<\/small>/, ""));
    const carriers = text((/<small[^>]*>([\s\S]*?)<\/small>/.exec(th[1]) || [])[1] || "");
    const cells = [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => text(m[1]));
    rows.push({ country, carriers, locker: cells[0] || "", courier: cells[1] || "", free: cells[2] || "", days: days[country] || "" });
  }
  const pickup = text((/<div class="dlv__pickup">([\s\S]*?)<\/div>/.exec(html) || [])[1] || "");
  const notes = [...html.matchAll(/<p class="dlv__note">([\s\S]*?)<\/p>/g)].map(m => text(m[1])).filter(Boolean);
  let returns = "";
  if (returnsHeading) {
    const at = html.indexOf(">" + returnsHeading + "</h2>");
    if (at >= 0) returns = text((/<p>([\s\S]*?)<\/p>/.exec(html.slice(at)) || [])[1] || "");
  }
  return { rows, pickup, notes, returns };
}
