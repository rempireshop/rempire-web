/**
 * POST /api/admin/upload — one photo, from the owner's phone into the bucket.
 *
 *   multipart/form-data
 *     file        the picture (JPEG / PNG / WebP / AVIF, up to 12 MB)
 *                 or a product video (MP4 / MOV, up to 60 MB, kind=video)
 *     kind        product | hero | review | blog | video
 *     productId   required for kind=product and kind=video
 *     reviewId    required for kind=review
 *     alt         optional caption, echoed back
 *   → { ok, url, thumbUrl, key, width, height, bytes }
 *     video:  { ok, url, key, bytes, contentType }
 *
 * DELETE /api/admin/upload/?key=products/… — removes one object, and only
 * under the prefixes this shop writes.
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
import { MAX_VIDEO_BYTES, sniffVideo, VIDEO_EXT } from "@/lib/video";
import { cutoutEnabled } from "@/lib/photo-cutout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uploads an hour, per signed-in browser rather than per IP — one owner, one
 *  phone, and a shared salon connection must not lock him out of his own shop. */
const UPLOADS_PER_HOUR = 60;
const HOUR = 60 * 60 * 1000;

const KINDS: MediaKind[] = ["product", "hero", "review", "blog", "video"];

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
  const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
  if (upload.size > maxBytes) return bad("too_large", 413);

  /* media: a product video. Nothing is decoded, resized or re-encoded — a
     phone's own H.264 already plays everywhere, and ffmpeg is not a
     dependency this project is going to grow for one field. The one thing
     that IS checked is the same thing as for a photo: the type comes from the
     first bytes, never from the name or from the Content-Type the browser
     attached. See src/lib/video.ts and docs/media.md. */
  if (kind === "video") {
    try {
      const bytes = Buffer.from(await upload.arrayBuffer());
      if (bytes.length > MAX_VIDEO_BYTES) return bad("too_large", 413);
      if (!bytes.length) return bad("empty_file");
      const mime = sniffVideo(bytes);
      if (!mime) return bad("bad_video_type", 415);

      const key = mediaKey("video", upload.name || "video", ownerId, Date.now(), VIDEO_EXT[mime]);
      const put = await putObject({ key, body: bytes, contentType: mime });
      await writeAuditSafe("admin", "media.upload", { key, kind, id: ownerId, bytes: put.bytes, from: mime });

      return Response.json(
        { ok: true, key, url: put.url, bytes: put.bytes, contentType: mime },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (err) {
      return fail(err);
    }
  }

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
  /* isAllowedKey() is the coarse "one of ours" gate and it knows giftcards/ —
     the printable cards the shop writes for itself on the paid transition
     (src/lib/giftcard-pdf.ts), which are linked from letters already sent.
     Nothing in the panel ever names one, so this door stays shut for them:
     only what an upload can create can be deleted here. */
  if (!isAllowedKey(key) || key.startsWith("giftcards/")) return bad("bad_key");

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

/** Whether the admin can offer an upload button at all — and, beside it, the
 *  optional «Убрать фон» (src/lib/photo-cutout.ts, PHOTO_CUTOUT="openai"). */
export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return Response.json(
    { ok: true, configured: storageConfigured(), cutout: cutoutEnabled(), maxBytes: MAX_UPLOAD_BYTES, maxVideoBytes: MAX_VIDEO_BYTES },
    { headers: { "cache-control": "no-store" } },
  );
}
