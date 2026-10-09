/**
 * Node module-resolution hook for running the TypeScript under src/ directly
 * with Node's own type stripping (on by default since 22.18; the
 * `--experimental-strip-types` flag before that): the sources import
 * "./layout", "./types" and so on without an extension, which tsc and Next
 * resolve and plain Node does not. Registered by tools/render-emails.mjs and
 * tools/prerender-shop2.mjs via module.register(); every other tool here is
 * plain JavaScript and never sees it. Only relative, extensionless specifiers
 * imported from a file under src/ are touched — and only when the .ts file
 * actually exists — plus the `@/…` alias below.
 *
 * `@/…` is tsconfig's path alias for src/ (vitest.config.ts maps it the same
 * way). The prerender reads the Merchant Center feed's own offers and
 * delivery prices out of src/lib/merchant-feed.ts, which speaks only in that
 * alias, and a JSON module under it (`@/data/catalogue.min.json`) is loaded
 * with the `type: "json"` attribute Node requires and the source never
 * writes (Next and tsc do not need it).
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const candidates = /\.[a-z]+$/i.test(rel) ? [rel] : [rel + ".ts", rel + "/index.ts", rel];
    for (const c of candidates) {
      const file = SRC + c;
      if (!existsSync(file)) continue;
      const url = pathToFileURL(file).href;
      if (/\.json$/i.test(c)) return { url, format: "json", importAttributes: { type: "json" }, shortCircuit: true };
      return asModule({ url, shortCircuit: true });
    }
  }
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const bare = !/\.[a-z]+$/i.test(specifier);
  const fromSrc = /\/src\//.test(context.parentURL || "");
  if (relative && bare && fromSrc) {
    try {
      return asModule(await nextResolve(specifier + ".ts", context));
    } catch (err) {
      if (!err || err.code !== "ERR_MODULE_NOT_FOUND") throw err;
    }
  }
  return asModule(await nextResolve(specifier, context));
}

/* package.json has no "type": "module", so Node would sniff every .ts file
   for import/export syntax and warn about the reparse — say so up front.
   "module-typescript" is the format Node's own type stripping expects for
   an ES module written in TypeScript. */
function asModule(resolved) {
  return resolved && /\.ts$/.test(resolved.url || "") ? { ...resolved, format: "module-typescript" } : resolved;
}
