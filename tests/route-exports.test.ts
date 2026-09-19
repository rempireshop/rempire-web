/**
 * A route file may export the handlers and the config, and nothing else.
 *
 * Next.js App Router generates a type for every `route.ts` during `next build`
 * and checks the module against it. An extra export — a constant, a helper, a
 * type — fails that check:
 *
 *   Type error: Type 'OmitWithTag<typeof import(".../route"), "PATCH" | …>'
 *   does not satisfy the constraint '{ [x: string]: never; }'.
 *     Property 'MONTONIO_READINESS_SETTING' is incompatible with index signature.
 *       Type '"montonio_readiness"' is not assignable to type 'never'.
 *
 * It cost a day. `export const MONTONIO_READINESS_SETTING` landed on 18.09.2026
 * at 14:57 and EVERY Vercel deploy failed from that moment — forty in a row —
 * while `npx tsc --noEmit` stayed clean and all 4 366 tests passed, because the
 * check lives in types Next writes during its own build and nothing else ever
 * reads them. The stand went on serving the build from lunchtime that day, so a
 * whole night's work sat in `main` and reached nobody, and the owner's own
 * acceptance list showed 178 checks while the repository had 194.
 *
 * This is the cheap half of that lesson. The expensive half — actually running
 * `npm run build` in CI — is worth doing too, but this catches the specific
 * mistake in under a second, names the file, and says what to do instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = fileURLToPath(new URL("../src/app", import.meta.url));

/** Everything Next.js allows a route module to export. */
const ALLOWED = new Set([
  // the handlers
  "GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS",
  // the segment config
  "runtime", "dynamic", "revalidate", "fetchCache", "dynamicParams",
  "preferredRegion", "maxDuration", "generateStaticParams",
  // metadata routes (icon.tsx, opengraph-image.tsx and friends)
  "metadata", "generateMetadata", "alt", "size", "contentType",
]);

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts" || entry === "route.tsx") out.push(full);
  }
  return out;
}

describe("every App Router route exports only what Next.js allows", () => {
  const files = routeFiles(APP);

  it("finds the routes at all — a silent empty sweep proves nothing", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [path.relative(APP, f).replace(/\\/g, "/"), f]))("%s", (_name, file) => {
    const src = readFileSync(file, "utf8");
    const extra: string[] = [];

    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (!ALLOWED.has(m[1])) extra.push(m[1]);
    }
    /* A type is an export too as far as the generated check is concerned, and
       it is the easy one to add without thinking — «it is only a type». */
    for (const m of src.matchAll(/^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm)) {
      extra.push(`type ${m[1]}`);
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const piece of m[1].split(",")) {
        const name = piece.split(/\s+as\s+/).pop()!.trim();
        if (name && !ALLOWED.has(name)) extra.push(name);
      }
    }

    expect(
      extra,
      `${path.relative(APP, file)} exports ${extra.join(", ")} — a route may export only its handlers and config. ` +
        "Move it to src/lib/ (or drop the `export`: nothing outside a route can import from one anyway). " +
        "`next build` fails on this and `tsc --noEmit` does not.",
    ).toEqual([]);
  });
});
