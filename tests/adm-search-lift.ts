/**
 * The panel's one product search (public/shop2/app.js, «the panel's one
 * product search», 02.11.2026), as source text for a test that runs one of
 * its callers. All eight product boxes of the panel — «Товары», «Склад»,
 * «Салон», the scanner, heroFind's pickers, the blog's two, the promo's —
 * call admProdMatch(), so a test that cuts one of them out of app.js needs
 * these functions beside it.
 *
 * What the search borrows from the rest of the shop comes as stand-ins that
 * a test's own declarations win over (`var x = x || …` keeps a parameter or
 * a function the test declares itself): trName gives the name back, no
 * product has a subsection, no ET/EN dictionary is loaded, nothing is
 * hidden. scanFold and scanWordHas stay the test's own business — most cut
 * the real ones out, some stand them in. srchStem is always the shop's own.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/** The search itself, in the order app.js declares it. */
export const ADM_SEARCH_FNS = [
  "admFold", "admQueryWords", "admHay", "admProdHay", "admHayHas", "admProdMatch",
  "admStockRowMatch", "admProdIndex", "admPickMoreHTML",
];

/** `function <name>(…) {…}` out of app.js, by brace count. */
export function appFn(name: string): string {
  const start = APP.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = APP.indexOf("{", start); i < APP.length; i++) {
    if (APP[i] === "{") depth++;
    else if (APP[i] === "}" && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** A one-line `var <name> = …;` out of app.js. */
export function appLineVar(name: string): string {
  const at = APP.indexOf(`\n  var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  return APP.slice(at + 1, APP.indexOf("\n", at + 1)).trim();
}

/** The search's source, stand-ins first — paste it at the top of a lifted body. */
export function admSearchSrc(): string {
  return [
    'var trName = trName || function (s) { return String(s == null ? "" : s); };',
    'var subcatNow = subcatNow || function () { return ""; };',
    "var trText = trText || function (s) { return s; };",
    "var uiHas = uiHas || function () { return false; };",
    "var SUBCATS = SUBCATS || {};",
    "var FILE_PRODUCTS = FILE_PRODUCTS || [];",
    appLineVar("SRCH_SUFFIX_RU"),
    appLineVar("SRCH_SUFFIX_LAT"),
    appFn("srchStem"),
    "var ADM_HAY = {};",
    ...ADM_SEARCH_FNS.map(appFn),
  ].join("\n");
}
