/*
 * The Renat-proof build test's loader (tools/chaos-build.mjs): the six
 * database readers tools/prerender-shop2.mjs calls answer from a JSON file
 * instead of Postgres — a snapshot of the live shop with one panel edit
 * applied. Everything else in each module is the real one (`export *`; the
 * local re-declaration wins, and the `?real=1` URL misses the endsWith test).
 * Pattern from the 18.09.2026 hidden-product leak, where it first proved a fix.
 */
const SHIMS = {
  "/tools/lib/overrides-export.mjs": ["fetchProductOverrides", "fetchOwnProducts", "fetchStockEans"],
  "/tools/lib/bundles-export.mjs": ["fetchBundlePrices"],
  "/tools/lib/blog-export.mjs": ["fetchPublishedPosts"],
  "/tools/lib/settings-export.mjs": ["fetchSettings"],
};

export async function load(url, context, nextLoad) {
  const hit = Object.keys(SHIMS).find((tail) => url.endsWith(tail));
  if (!hit) return nextLoad(url, context);
  const fns = SHIMS[hit]
    .map((name) =>
      name === "fetchSettings"
        ? `export async function fetchSettings(keys) {
             const all = __data().fetchSettings || {};
             const out = {};
             for (const k of keys || []) if (Object.prototype.hasOwnProperty.call(all, k)) out[k] = all[k];
             return out;
           }`
        : `export async function ${name}() { return __data().${name} ?? null; }`)
    .join("\n");
  return {
    format: "module",
    shortCircuit: true,
    source: `
      import { readFileSync as __read } from "node:fs";
      export * from ${JSON.stringify(url + "?real=1")};
      let __cache = null;
      function __data() {
        if (!__cache) __cache = JSON.parse(__read(process.env.CHAOS_DATA, "utf8"));
        return __cache;
      }
      ${fns}
    `,
  };
}
