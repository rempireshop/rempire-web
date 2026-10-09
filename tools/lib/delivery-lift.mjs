/* «Доставка и оплата» — the builder and the tables it reads, lifted out of
   public/shop2/app.js by source text, plus the one thing the build used to
   get wrong: which rules the page prints.

   deliveryPageHTML() and its tables live in app.js, next to the checkout
   that bills with them; tools/prerender-shop2.mjs writes the static
   /policies/shipping-policy pages with the very same function (see its
   comment in app.js). What the page prints is only as good as the RULES it is
   handed, and until 09.10.2026 the prerender built those with a merge of its
   own — the owner's stored row over SHIP_RULES, the table a shop with NO row
   bills from, whose courier column holds three home numbers of the shop's own
   (EE 10,84 €, LV and LT 9,90 €). The shop itself never does that once a row
   exists: adoptServer() hands the row to setShipRules(), which builds the
   live table with shipRulesFrom() over shipRulesBase() — the same table with
   the courier column at Montonio's own price — and parseShippingRules() on
   the server seeds the bill the same way. So the static page promised a
   10,84 € courier while the checkout and the bill charged 6,89–7,39 €.

   liveRules() below is that path, lifted: the same functions, in the order
   the shop runs them, so the page, the checkout and the bill read one table.
   tests/delivery-page-prices.test.ts holds the printed courier and locker
   prices to quoteFromRules() on the server, country by country.

   Plain ESM with no imports — the bare-`node` prerender and the tests both
   import it. Throws when a slice does not come out; the caller decides
   whether that is fatal. */

const DECL_END = /^ {2}[}\]];$/;
const FN_END = /^ {2}}$/;

/** The lifted builder: { rules, montonio, carrierNames, carriers, rows, page, liveRules }. */
export function liftDelivery(appSrc) {
  const lines = String(appSrc).replace(/\r\n?/g, "\n").split("\n");
  const sliceFrom = (startRx, endRx) => {
    const i = lines.findIndex(l => startRx.test(l));
    if (i < 0) return null;
    for (let j = i + 1; j < lines.length; j++) if (endRx.test(lines[j])) return lines.slice(i, j + 1).join("\n");
    return null;
  };
  const line = rx => lines.find(l => rx.test(l)) || null;
  const pieces = {
    SHIP_RULES: sliceFrom(/^ {2}var SHIP_RULES = \{$/, DECL_END),
    MONTONIO_PRICE: sliceFrom(/^ {2}var MONTONIO_PRICE = \{$/, DECL_END),
    cloneRules: line(/^ {2}function cloneRules\(r\) \{ return JSON\.parse\(JSON\.stringify\(r\)\); \}$/),
    SHIP_RULES_DEFAULT: line(/^ {2}var SHIP_RULES_DEFAULT = cloneRules\(SHIP_RULES\);$/),
    SHIP_STORED_DEFAULT: sliceFrom(/^ {2}var SHIP_STORED_DEFAULT = \{$/, DECL_END),
    CARRIER_NAMES: sliceFrom(/^ {2}var CARRIER_NAMES = \{$/, DECL_END),
    CARRIERS_BY_COUNTRY: sliceFrom(/^ {2}var CARRIERS_BY_COUNTRY = \{$/, DECL_END),
    DELIVERY_ROWS: sliceFrom(/^ {2}var DELIVERY_ROWS = \[$/, DECL_END),
    deliveryPageHTML: sliceFrom(/^ {2}function deliveryPageHTML\(ctx\) \{$/, FN_END),
    shipRulesBase: sliceFrom(/^ {2}function shipRulesBase\(\) \{$/, FN_END),
    shipStoredMerge: sliceFrom(/^ {2}function shipStoredMerge\(base, raw\) \{$/, FN_END),
    shipRulesFrom: line(/^ {2}function shipRulesFrom\(raw\) \{ return shipStoredMerge\(shipRulesBase\(\), raw\); \}$/),
    feedShipRules: sliceFrom(/^ {2}function feedShipRules\(s\) \{$/, FN_END),
  };
  const missing = Object.keys(pieces).filter(k => !pieces[k]);
  if (missing.length) throw new Error("could not lift " + missing.join(", ") + " out of app.js");
  const D = new Function(Object.values(pieces).join("\n") + "\nreturn {" +
    " rules: SHIP_RULES, montonio: MONTONIO_PRICE, carrierNames: CARRIER_NAMES, carriers: CARRIERS_BY_COUNTRY," +
    " rows: DELIVERY_ROWS, page: deliveryPageHTML," +
    " defaults: function () { return cloneRules(SHIP_RULES_DEFAULT); }," +
    " fromStored: function (raw) {" +
    /* adoptServer(): no row (or `{}`) leaves the shop on its own defaults … */
    "   var row = feedShipRules({ shipping_rules: raw });" +
    "   if (!row) return cloneRules(SHIP_RULES_DEFAULT);" +
    /* … a row goes through setShipRules(): cleaned into the stored shape, then
       laid over the Montonio-priced base */
    "   return shipRulesFrom(shipStoredMerge(SHIP_STORED_DEFAULT, row));" +
    " } };")();
  if (typeof D.page !== "function" || !D.rules || !D.rules.methods) throw new Error("the lifted delivery page has the wrong shape");
  return {
    rules: D.rules, montonio: D.montonio, carrierNames: D.carrierNames, carriers: D.carriers, rows: D.rows, page: D.page,
    /** The table the shop bills from for settings.shipping_rules = `raw` (undefined/null = no row). */
    liveRules: raw => D.fromStored(raw),
  };
}
