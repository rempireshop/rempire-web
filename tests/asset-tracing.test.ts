/**
 * A route that reads a file out of `public/` must be listed in
 * `outputFileTracingIncludes`, or it reads nothing on Vercel.
 *
 * Everything under `public/` goes to Vercel's static layer, which a serverless
 * function cannot open. Next.js traces a function's file dependencies from its
 * imports — and a path built at run time (`public/fonts/Oswald-Medium.ttf` as a
 * string) names no import, so the tracer never learns about it. The fix has
 * always been the same one line in `next.config.ts`; the trouble is that
 * nothing fails when it is missing.
 *
 * It cost the A4 shipping label. `drawSlip()` was added on 13.09.2026 to print
 * the order number and the drop-off code in figures big enough to read at the
 * counter, and `/api/admin/shipments/**` was never added to the list. On the
 * stand the band came out reserved and blank, because `readAsset()` threw
 * `asset_missing` and `drawSlipSafely()` swallowed it exactly as it is meant
 * to. Six days later the owner wrote: «no drop-off code for the locker is
 * shown. the address or any other information from order is not printed on the
 * PDF» (test plan `order-label`, 19.09.2026).
 *
 * Neither the suite nor the developer's disk can see this: there
 * `process.cwd()` is the repository and `public/fonts/` is simply there. So
 * this test does not read a PDF at all — it reads the import graph, and asks
 * of every route that can reach a disk-reading module whether the config knows
 * about it.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "src");
const APP = path.join(SRC, "app");

/** Every .ts/.tsx under src/, as absolute paths. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The modules that open a file under `public/` at run time.
 *
 * Found rather than listed, so a third one cannot be written next year and
 * quietly escape this test. The signature is a local `readAsset`-style reader
 * together with a `public/…` literal — which is what makes the path invisible
 * to the tracer in the first place.
 */
function diskReaders(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (/function\s+readAsset\s*\(/.test(src) && /["']public\/[^"']+["']/.test(src)) out.add(file);
  }
  return out;
}

/** `@/lib/x`, `./x`, `../x` → an absolute file, or null for a package. */
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Static `from "…"` and lazy `import("…")` alike — both pull the module in. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/\bfrom\s+["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

/** `src/app/api/admin/shipments/[id]/label/route.ts` → `/api/admin/shipments/[id]/label`. */
function routeUrl(file: string): string {
  const rel = path.relative(APP, file).replace(/\\/g, "/").replace(/\/route\.tsx?$/, "");
  /* Route groups «(name)» are folders Next.js does not put in the URL, and the
     tracing keys are URLs. */
  const parts = rel.split("/").filter((p) => p && !/^\(.*\)$/.test(p));
  return "/" + parts.join("/");
}

/** The keys of `outputFileTracingIncludes`, read out of the config's text. */
function tracingKeys(): string[] {
  const src = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  const block = src.slice(src.indexOf("outputFileTracingIncludes"));
  const end = block.indexOf("\n  },");
  const body = end > 0 ? block.slice(0, end) : block;
  return [...body.matchAll(/^\s*["']([^"']+)["']\s*:/gm)].map((m) => m[1]);
}

/** `/api/admin/shipments/**` covers `/api/admin/shipments/[id]/label`. */
function covers(pattern: string, url: string): boolean {
  if (pattern === url) return true;
  if (pattern.endsWith("/**")) return url === pattern.slice(0, -3) || url.startsWith(pattern.slice(0, -2));
  return false;
}

describe("every route that reads from public/ is traced into its function", () => {
  const files = sources(SRC);
  const readers = diskReaders(files);
  const keys = tracingKeys();

  it("finds the disk readers and the config at all — an empty sweep proves nothing", () => {
    expect([...readers].map((f) => path.relative(ROOT, f).replace(/\\/g, "/")).sort()).toEqual([
      "src/lib/giftcard-pdf.ts",
      "src/lib/og-card.ts",
    ]);
    expect(keys.length).toBeGreaterThan(3);
  });

  /* Who can reach a reader, following imports as far as they go. A lazy
     `await import()` counts: the file still has to be next to the function. */
  const cache = new Map<string, boolean>();
  function reachesReader(file: string, seen = new Set<string>()): boolean {
    if (readers.has(file)) return true;
    const hit = cache.get(file);
    if (hit !== undefined) return hit;
    if (seen.has(file)) return false;
    seen.add(file);
    let found = false;
    for (const spec of importsOf(file)) {
      const target = resolveImport(file, spec);
      if (target && reachesReader(target, seen)) {
        found = true;
        break;
      }
    }
    /* Only a completed walk may be cached: a `false` reached through a cycle
       is «not decided yet», not «no». */
    if (seen.size === 1 || found) cache.set(file, found);
    return found;
  }

  const routes = files.filter((f) => /[\\/]route\.tsx?$/.test(f) && f.startsWith(APP));
  const needy = routes.filter((f) => reachesReader(f));

  it("finds the routes that need the fonts", () => {
    expect(needy.length).toBeGreaterThan(0);
  });

  it.each(needy.map((f) => [routeUrl(f), f]))("%s", (url) => {
    const matched = keys.filter((k) => covers(k, url));
    expect(
      matched,
      `${url} can read a file out of public/ at run time, and next.config.ts does not trace one into it. ` +
        "Add a key to outputFileTracingIncludes covering this route " +
        '(e.g. "/api/…/**": ["./public/fonts/*.ttf", "./public/brand/rempire-tower.svg"]). ' +
        "Without it the function throws `asset_missing` on Vercel and nothing here or on your disk notices.",
    ).not.toEqual([]);
  });
});
