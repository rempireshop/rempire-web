#!/usr/bin/env node
/**
 * Renders every customer letter × RU/ET/EN with realistic sample data
 * (src/emails/samples.ts) to disk — the HTML part, the plain-text part and
 * the subject — and, with --png, screenshots each one the way a phone and a
 * desktop mail client show it.
 *
 *   node tools/render-emails.mjs                 → <tmpdir>/rempire-emails/
 *   node tools/render-emails.mjs --out <dir>     → there
 *   node tools/render-emails.mjs --png           → + PNGs at 600 px, 360 px and 360 px dark
 *
 * The PNGs are taken with web fonts and every other network request blocked
 * — only the logo is served, from public/brand/ — so they show the Arial
 * fallback a client without web fonts renders: the look the letters have to
 * be right in, not the best case. tests/emails-compat.test.ts checks the
 * same renders (same samples, same renderers) for the rules that can be
 * checked without eyes; this script is for the ones that cannot.
 *
 * The templates are TypeScript. Node strips the types itself (22.18+) and
 * tools/lib/ts-resolve.mjs resolves their extensionless imports, so there is
 * no build step and no bundler here.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* Older 22.x needs the flag; re-run once with it rather than ask every caller
   to remember. */
if (!process.features.typescript) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", ...process.argv.slice(1)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(path.join(ROOT, "tools", "lib", "ts-resolve.mjs")).href);

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const OUT =
  outFlag >= 0 && args[outFlag + 1] ? path.resolve(args[outFlag + 1]) : path.join(tmpdir(), "rempire-emails");
const PNG = args.includes("--png");
// Absolute links and the logo URL come from here (src/emails/layout.ts).
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://rempireshop.com";

const { renderSample, SAMPLE_LANGS, SAMPLE_TEMPLATES } = await import(
  pathToFileURL(path.join(ROOT, "src", "emails", "samples.ts")).href
);

mkdirSync(OUT, { recursive: true });
const index = [];
for (const template of SAMPLE_TEMPLATES) {
  for (const lang of SAMPLE_LANGS) {
    const mail = renderSample(template, lang);
    const base = `${template}.${lang}`;
    writeFileSync(path.join(OUT, `${base}.html`), mail.html);
    writeFileSync(path.join(OUT, `${base}.txt`), mail.text);
    const htmlBytes = Buffer.byteLength(mail.html);
    index.push({ template, lang, subject: mail.subject, htmlBytes, textBytes: Buffer.byteLength(mail.text) });
    console.log(`${base.padEnd(22)} ${String(htmlBytes).padStart(6)} B  ${mail.subject}`);
  }
}
writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log(`\n${index.length} letters → ${OUT}`);

if (PNG) {
  const { chromium } = await import("playwright");
  const logo = readFileSync(path.join(ROOT, "public", "brand", "tower-email.png"));
  const browser = await chromium.launch();
  const shots = [
    { width: 600, scheme: "light", tag: "600" },
    { width: 360, scheme: "light", tag: "360" },
    { width: 360, scheme: "dark", tag: "360-dark" },
  ];
  for (const shot of shots) {
    const ctx = await browser.newContext({
      viewport: { width: shot.width, height: 800 },
      deviceScaleFactor: 2,
      colorScheme: shot.scheme,
    });
    await ctx.route("**/*", (route) => {
      const url = route.request().url();
      if (url.endsWith("/brand/tower-email.png")) return route.fulfill({ body: logo, contentType: "image/png" });
      return route.abort();
    });
    const page = await ctx.newPage();
    for (const { template, lang } of index) {
      const html = readFileSync(path.join(OUT, `${template}.${lang}.html`), "utf8");
      await page.setContent(html, { waitUntil: "load" });
      await page.screenshot({ path: path.join(OUT, `${template}.${lang}.${shot.tag}.png`), fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`${index.length * shots.length} PNGs → ${OUT}`);
}
