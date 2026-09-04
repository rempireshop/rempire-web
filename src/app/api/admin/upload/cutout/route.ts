/**
 * POST /api/admin/upload/cutout — «Убрать фон» for one uploaded product photo.
 *
 *   { "key": "products/<id>/<stamp>-<slug>.webp" }   or   { "url": "<its public URL>" }
 *   → { ok, key, url, thumbUrl, bytes }     the new PNG, stored next to the original
 *   → 503 cutout_disabled                   PHOTO_CUTOUT is not "openai" (or no key)
 *   → 400 bad_key                           not a product photo of ours
 *   → 502 cutout_failed / source_unavailable — the original stays, nothing changes
 *
 * Only ever ADDS an object: `<original>-cutout.png` and its `-cutout-thumb.webp`.
 * The original key is never overwritten or deleted here — the owner decides
 * which one the gallery keeps, and «Сохранить» is what makes it so.
 * See src/lib/photo-cutout.ts and docs/media.md.
 */
import { ADMIN_COOKIE, clientIp, rateLimit, readCookie, requireAdmin } from "@/lib/auth";
import { ImageError, MAX_UPLOAD_BYTES, processImage } from "@/lib/images";
import { writeAuditSafe } from "@/lib/orders";
import { cutoutEnabled, CutoutError, cutoutImage, cutoutKey } from "@/lib/photo-cutout";
import { isAllowedKey, keyFromUrl, publicUrl, putObject, StorageError, storageConfigured } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cut-outs an hour, per signed-in browser — each one is a paid model call. */
const CUTOUTS_PER_HOUR = 40;
const HOUR = 60 * 60 * 1000;

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });
}

function limiterKey(req: Request): string {
  const token = readCookie(req, ADMIN_COOKIE);
  return token ? `s:${token.slice(-24)}` : `ip:${clientIp(req)}`;
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (!storageConfigured()) return bad("storage_not_configured", 503);
  if (!cutoutEnabled()) return bad("cutout_disabled", 503);

  let body: { key?: unknown; url?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("bad_json");
  }
  if (!body || typeof body !== "object") return bad("bad_json");
  const key = isAllowedKey(body.key) ? body.key : typeof body.url === "string" ? keyFromUrl(body.url) : null;
  if (!key || !key.startsWith("products/") || !/\.(webp|png|jpe?g)$/.test(key)) return bad("bad_key");
  if (rateLimit("admin_cutout", limiterKey(req), CUTOUTS_PER_HOUR, HOUR)) return bad("rate_limited", 429);

  try {
    const src = await fetch(publicUrl(key));
    if (!src.ok) return bad("source_unavailable", 502);
    const original = Buffer.from(await src.arrayBuffer());
    if (!original.length || original.length > MAX_UPLOAD_BYTES) return bad("source_unavailable", 502);

    const png = await cutoutImage(original);
    // the thumbnail the grid shows — a WebP with alpha, like every other thumb
    const img = await processImage(png);

    const outKey = cutoutKey(key);
    const thumbOut = outKey.replace(/\.png$/, "-thumb.webp");
    const put = await putObject({ key: outKey, body: png, contentType: "image/png" });
    await putObject({ key: thumbOut, body: img.thumb, contentType: "image/webp" });
    await writeAuditSafe("admin", "media.cutout", { from: key, key: outKey, bytes: put.bytes });

    return Response.json(
      { ok: true, key: outKey, url: put.url, thumbUrl: publicUrl(thumbOut), bytes: put.bytes, width: img.width, height: img.height },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof CutoutError) return bad(err.code, err.status);
    if (err instanceof ImageError || err instanceof StorageError) return bad(err.code, err.status);
    console.error("[api/admin/upload/cutout] failed:", err);
    return bad("cutout_failed", 502);
  }
}
