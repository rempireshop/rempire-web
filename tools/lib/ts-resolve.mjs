/**
 * Node module-resolution hook for running the TypeScript under src/ directly
 * with Node's own type stripping (on by default since 22.18; the
 * `--experimental-strip-types` flag before that): the sources import
 * "./layout", "./types" and so on without an extension, which tsc and Next
 * resolve and plain Node does not. Registered by tools/render-emails.mjs via
 * module.register(); every other tool here is plain JavaScript and never
 * sees it. Only relative, extensionless specifiers imported from a file
 * under src/ are touched — and only when the .ts file actually exists.
 */
export async function resolve(specifier, context, nextResolve) {
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
