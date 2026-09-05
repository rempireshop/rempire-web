/**
 * «Убрать фон» — background removal for one uploaded product photo.
 *
 * Optional, and off unless the deployment says otherwise: PHOTO_CUTOUT="openai"
 * plus the OPENAI_API_KEY the assistant already uses. With it on, the admin's
 * media tab offers a per-photo button (GET /api/admin/upload reports
 * `cutout: true`), and POST /api/admin/upload/cutout sends the picture to
 * OpenAI's image edit endpoint (model gpt-image-1, background "transparent")
 * with a prompt that asks for the product exactly as photographed, minus the
 * background. The answer is a PNG with alpha, stored NEXT TO the original —
 * the original is never touched, so a bad cut costs one click, not a photo.
 *
 * Nothing in this file writes anywhere; it is the one network call, kept
 * apart from the route so the tests can exercise it with fetch stubbed.
 */
import { sniffImage } from "@/lib/images";

export const CUTOUT_MODEL = "gpt-image-1";
export const CUTOUT_ENDPOINT = "https://api.openai.com/v1/images/edits";
export const CUTOUT_PROMPT =
  "Keep the product exactly as it is photographed — the same object, angle, colours, labels, lighting and " +
  "proportions — and remove the background completely so that only the product remains on a fully " +
  "transparent background. Do not add, move, restyle or retouch anything.";

export class CutoutError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 502, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.status = status;
  }
}

/** True only when the deployment opted in AND there is a key to pay with. */
export function cutoutEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.PHOTO_CUTOUT || "").trim().toLowerCase() === "openai" && Boolean((env.OPENAI_API_KEY || "").trim());
}

/**
 * How long one model call may take. The image edit endpoint answers in
 * seconds; a hung socket would otherwise hold the function open until the
 * platform killed it, with the owner looking at a spinner. Past this the
 * call is given up as `cutout_failed` — the original is untouched, a second
 * click asks again. The same deadline covers fetching the original from the
 * bucket (the route). PHOTO_CUTOUT_TIMEOUT_MS overrides, in milliseconds,
 * up to five minutes (the tests set it to a few).
 */
export const CUTOUT_TIMEOUT_MS = 90_000;
export function cutoutTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PHOTO_CUTOUT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 && n <= 300_000 ? Math.round(n) : CUTOUT_TIMEOUT_MS;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** `products/<id>/<stamp>-<slug>.webp` → `products/<id>/<stamp>-<slug>-cutout.png`
 *  (a second cut of a cut-out does not grow a `-cutout-cutout` tail). */
export function cutoutKey(key: string): string {
  return key.replace(/\.(webp|png|jpe?g)$/, "").replace(/-cutout$/, "") + "-cutout.png";
}

/**
 * The photo in, a PNG with a transparent background out. Throws CutoutError
 * (`cutout_disabled` 503, `cutout_failed` 502) and never anything else the
 * route would have to guess at.
 */
export async function cutoutImage(bytes: Buffer): Promise<Buffer> {
  if (!cutoutEnabled()) throw new CutoutError("cutout_disabled", 503);
  const mime = sniffImage(bytes);
  if (!mime || !(mime in EXT)) throw new CutoutError("cutout_failed", 502, `unsupported source ${mime || "?"}`);

  const form = new FormData();
  form.append("model", CUTOUT_MODEL);
  form.append("image", new Blob([new Uint8Array(bytes)], { type: mime }), `photo.${EXT[mime]}`);
  form.append("prompt", CUTOUT_PROMPT);
  form.append("background", "transparent");
  form.append("output_format", "png");
  form.append("n", "1");
  form.append("size", "auto");

  let res: Response;
  try {
    res = await fetch(CUTOUT_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${(process.env.OPENAI_API_KEY || "").trim()}` },
      body: form,
      signal: AbortSignal.timeout(cutoutTimeoutMs()),
    });
  } catch (err) {
    throw new CutoutError("cutout_failed", 502, err instanceof Error ? err.message : "network");
  }
  if (!res.ok) {
    /* The status is the whole of what is kept: an error body from the model
       host can quote the request back, and the route logs this message. */
    await res.text().catch(() => "");
    throw new CutoutError("cutout_failed", 502, `upstream ${res.status}`);
  }
  let data: { data?: Array<{ b64_json?: string }> };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new CutoutError("cutout_failed", 502, "not json");
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) throw new CutoutError("cutout_failed", 502, "no image in the answer");
  const out = Buffer.from(b64, "base64");
  if (sniffImage(out) !== "image/png") throw new CutoutError("cutout_failed", 502, "the answer is not a png");
  return out;
}
