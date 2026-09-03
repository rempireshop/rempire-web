/**
 * POST /api/admin/upload — one photo, from the owner's phone into the bucket.
 *
 *   multipart/form-data
 *     file        the picture (JPEG / PNG / WebP / AVIF, up to 12 MB)
 *     kind        product | hero | review
 *     productId   required for kind=product
 *     reviewId    required for kind=review
 *     alt         optional caption, echoed back
 *   → { ok, url, thumbUrl, key, width, height, bytes }
 *
 * DELETE /api/admin/upload/?key=products/… — removes one object, and only
 * under the three prefixes this shop writes.
 *
 * Both are behind requireAdmin. Without the R2 variables the answer is a clean
 * 503 `storage_not_configured`, which is what the admin turns into «Загрузка
 * фото пока не настроена» — nothing else in the shop notices. See
 * docs/media.md.
 */
import { ADMIN_COOKIE, clientIp, rateLimit, readCookie, requireAdmin } from "@/lib/auth";
import { ImageError, MAX_UPLOAD_BYTES, processImage } from "@/lib/images";
import { writeAuditSafe } from "@/lib/orders";
import {
  deleteObject,
  isAllowedKey,
  mediaKey,
  publicUrl,
  putObject,
  StorageError,
  storageConfigured,
  thumbKey,
  type MediaKind,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uploads an hour, per signed-in browser rather than per IP — one owner, one
 *  phone, and a shared salon connection must not lock him out of his own shop. */
const UPLOADS_PER_HOUR = 60;
const HOUR = 60 * 60 * 1000;

const KINDS: MediaKind[] = ["product", "hero", "review", "blog"];

function bad(error: string, status = 400, detail?: string) {
  return Response.json({ ok: false, error, ...(detail ? { detail } : {}) }, { status });
}

/** The session cookie is the bucket key; it never leaves this process. */
function limiterKey(req: Request): string {
  const token = readCookie(req, ADMIN_COOKIE);
  return token ? `s:${token.slice(-24)}` : `ip:${clientIp(req)}`;
}

function fail(err: unknown) {
  if (err instanceof ImageError || err instanceof StorageError) return bad(err.code, err.status);
  console.error("[api/admin/upload] failed:", err);
  return bad("upload_failed", 502);
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (!storageConfigured()) return bad("storage_not_configured", 503);
  if (rateLimit("admin_upload", limiterKey(req), UPLOADS_PER_HOUR, HOUR)) return bad("rate_limited", 429);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("bad_body");
  }

  const kindRaw = String(form.get("kind") || "product");
  if (!(KINDS as string[]).includes(kindRaw)) return bad("bad_kind");
  const kind = kindRaw as MediaKind;

  const ownerId = String(form.get(kind === "review" ? "reviewId" : "productId") || "").trim();
  // hero and blog covers are uploaded before there is any row to attach them
  // to — the URL rides along in the slide/post draft and is saved with it
  if (kind !== "hero" && kind !== "blog" && !ownerId) return bad(kind === "review" ? "bad_review" : "bad_product");

  const file = form.get("file");
  if (!file || typeof file === "string" || typeof (file as File).arrayBuffer !== "function") return bad("no_file");
  const upload = file as File;
  // The length is checked twice on purpose: once before the body is read into
  // memory, once after, because a browser may lie about size.
  if (upload.size > MAX_UPLOAD_BYTES) return bad("too_large", 413);

  try {
    const bytes = Buffer.from(await upload.arrayBuffer());
    const img = await processImage(bytes);

    const key = mediaKey(kind, upload.name || "photo", ownerId || null);
    const tKey = thumbKey(key);
    const put = await putObject({ key, body: img.main, contentType: "image/webp" });
    await putObject({ key: tKey, body: img.thumb, contentType: "image/webp" });

    await writeAuditSafe("admin", "media.upload", {
      key,
      kind,
      id: ownerId || null,
      bytes: put.bytes,
      width: img.width,
      height: img.height,
      from: img.sourceMime,
    });

    return Response.json(
      {
        ok: true,
        key,
        url: put.url,
        thumbUrl: publicUrl(tKey),
        width: img.width,
        height: img.height,
        bytes: put.bytes,
        alt: String(form.get("alt") || "").slice(0, 120),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (!storageConfigured()) return bad("storage_not_configured", 503);

  const key = new URL(req.url).searchParams.get("key") || "";
  if (!isAllowedKey(key)) return bad("bad_key");

  try {
    await deleteObject(key);
    // The thumbnail is an implementation detail of the upload, so it goes with
    // it; a key that never had one simply 404s, which deleteObject ignores.
    const tKey = thumbKey(key);
    if (tKey !== key) await deleteObject(tKey).catch(() => {});
    await writeAuditSafe("admin", "media.delete", { key });
    return Response.json({ ok: true, key }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return fail(err);
  }
}

/** Whether the admin can offer an upload button at all. */
export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return Response.json(
    { ok: true, configured: storageConfigured(), maxBytes: MAX_UPLOAD_BYTES },
    { headers: { "cache-control": "no-store" } },
  );
}
