/**
 * Fill in the size of every blog cover the shop has no size for — once, after
 * 227_blog_magazine.sql has run.
 *
 * The magazine (Dim, 02.11.2026) draws each cover in its own shape, which it
 * reads from posts.cover_w / cover_h. A cover uploaded from now on brings its
 * size with it (the upload answers width and height), and the panel measures
 * an older one when the article is opened; this does the rest in one go, so
 * the six articles already published do not wait for that. Until it has run
 * nothing is broken: a cover with no size stands in the old 1200×630 frame.
 *
 * It only READS the pictures — fetched over https from R2, or read from
 * public/ for a /shop/img/… photo — and writes nothing but those two columns,
 * and only where they are empty. Without --yes it says what it would write.
 *
 *   DATABASE_URL=… node tools/blog-cover-dims.mjs          # what it WOULD write
 *   DATABASE_URL=… node tools/blog-cover-dims.mjs --yes    # write it
 *
 * PowerShell:  $env:DATABASE_URL = "…"; node tools/blog-cover-dims.mjs
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { sslFor } from "./migrate.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--yes");
const MAX_BYTES = 15 * 1024 * 1024;

/** The picture's bytes: a same-site path from public/, an https address over the network. */
async function bytesOf(url) {
  if (/^\/(?!\/)/.test(url)) {
    const rel = decodeURIComponent(url.split(/[?#]/)[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, "public", rel);
    if (!file.startsWith(path.join(ROOT, "public"))) throw new Error("outside public/");
    return readFile(file);
  }
  if (!/^https:\/\//i.test(url)) throw new Error("not https");
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("too large");
  return buf;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: sslFor(process.env.DATABASE_URL) });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select id, slug, cover_url from posts where deleted_at is null and cover_url is not null and (cover_w is null or cover_h is null) order by updated_at desc",
    );
    console.log(`${rows.length} cover(s) without a size${WRITE ? "" : " — dry run, add --yes to write"}`);
    let done = 0;
    for (const r of rows) {
      try {
        const meta = await sharp(await bytesOf(r.cover_url), { failOn: "none" }).metadata();
        // a photo turned by its EXIF tag is shown turned (the shop's <img> follows the tag)
        const turned = (meta.orientation || 1) >= 5;
        const w = turned ? meta.height : meta.width, h = turned ? meta.width : meta.height;
        if (!(w > 0 && h > 0)) throw new Error("no size in the file");
        console.log(`  ${r.slug}: ${w}×${h}`);
        if (WRITE) {
          // only where it is still empty: a size the panel stored meanwhile is not written over
          await client.query(
            "update posts set cover_w = $1, cover_h = $2 where id = $3 and cover_url = $4 and cover_w is null",
            [w, h, r.id, r.cover_url],
          );
        }
        done++;
      } catch (err) {
        console.warn(`  ! ${r.slug}: ${err && err.message ? err.message : err} — left as it is (the 1200×630 frame)`);
      }
    }
    console.log(WRITE ? `${done} written.` : `${done} would be written.`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
