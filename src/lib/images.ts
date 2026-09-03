/**
 * What happens to a photo between the owner's phone and the bucket.
 *
 * Nothing the browser sends is trusted: the type is read off the first bytes
 * (a .jpg that is really a PDF is a PDF), the file is decoded by sharp, turned
 * upright by its EXIF orientation, stripped of every scrap of metadata — GPS
 * included, phones put the salon's address in there — resized to fit 1600 px
 * and re-encoded as WebP. A 400 px thumbnail comes out of the same decode.
 *
 * Product photos on this shop are cut-outs standing on nothing, so alpha is
 * kept whenever the source has it; a photo from a camera has none and gets the
 * smaller opaque encoding by itself.
 *
 * HEIC (what an iPhone shoots by default) is NOT accepted: sharp's prebuilt
 * libvips ships the HEIF container without the HEVC decoder — patents — so it
 * cannot be decoded on Vercel or anywhere else the prebuilt binary runs. The
 * admin says so in as many words instead of failing at the decode. iOS
 * converts to JPEG on its own when a photo is picked from the camera roll in
 * Safari, so in practice the owner never meets this.
 */

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB in
export const MAX_EDGE = 1600; // longest side of the stored photo
export const THUMB_EDGE = 400; // longest side of the …-thumb.webp
export const WEBP_QUALITY = 82;
/** A 1600×1600 photo is 2.6 MP; this is the decode bomb guard, not a limit. */
export const MAX_PIXELS = 50_000_000;

export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

export class ImageError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.status = status;
  }
}

/* ---------- what is actually in the bytes -------------------------------- */

const ascii = (b: Uint8Array, from: number, len: number): string =>
  Buffer.from(b.subarray(from, from + len)).toString("latin1");

/** HEIF brands that carry HEVC — the ones sharp's prebuilt binary cannot read. */
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/**
 * The real type, from the magic bytes. `heic` comes back as its own answer so
 * the route can say why rather than «неподдерживаемый файл».
 */
export function sniffImage(input: Uint8Array): AcceptedMime | "image/heic" | null {
  const b = input;
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4).toLowerCase();
    if (AVIF_BRANDS.has(brand)) return "image/avif";
    if (HEIC_BRANDS.has(brand)) return "image/heic";
  }
  return null;
}

/* ---------- sharp -------------------------------------------------------- */

/*
 * Imported at call time. sharp is a native module: on a machine where its
 * binary did not install, the whole route would fail to load at import — this
 * way it fails as one honest error on one request instead.
 */
type SharpFactory = typeof import("sharp").default;
let sharpModule: SharpFactory | null = null;

export async function loadSharp(): Promise<SharpFactory> {
  if (sharpModule) return sharpModule;
  try {
    const mod = (await import("sharp")) as unknown as { default?: SharpFactory };
    sharpModule = (mod.default || (mod as unknown as SharpFactory)) as SharpFactory;
    return sharpModule;
  } catch (err) {
    console.error("[images] sharp is not available:", err);
    throw new ImageError("image_tools_unavailable", 503);
  }
}

export type ProcessedImage = {
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  bytes: number;
  hasAlpha: boolean;
  sourceMime: AcceptedMime;
};

/**
 * Bytes in, two WebPs out. Throws ImageError with a code the admin knows how
 * to translate: too_large, bad_type, heic_unsupported, bad_image.
 */
export async function processImage(input: Uint8Array | Buffer): Promise<ProcessedImage> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!buf.length) throw new ImageError("empty_file");
  if (buf.length > MAX_UPLOAD_BYTES) throw new ImageError("too_large", 413, `${buf.length} bytes`);

  const kind = sniffImage(buf);
  if (kind === "image/heic") throw new ImageError("heic_unsupported", 415);
  if (!kind) throw new ImageError("bad_type", 415);

  const sharp = await loadSharp();
  // limitInputPixels guards the decode; failOn:"none" lets a slightly truncated
  // phone photo through instead of refusing a picture the owner can see fine.
  const base = sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "none" }).rotate();

  let meta;
  try {
    meta = await base.metadata();
  } catch (err) {
    throw new ImageError("bad_image", 400, err instanceof Error ? err.message : undefined);
  }
  if (!meta.width || !meta.height) throw new ImageError("bad_image", 400, "no dimensions");
  const hasAlpha = !!meta.hasAlpha;

  const encode = (edge: number) =>
    base
      .clone()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      // sharp drops EXIF/ICC/XMP unless asked to keep them, so this is already
      // metadata-free; alpha rides along only when the source had it.
      .webp({ quality: WEBP_QUALITY, alphaQuality: 90, effort: 4 });

  try {
    const [main, thumb] = await Promise.all([
      encode(MAX_EDGE).toBuffer({ resolveWithObject: true }),
      encode(THUMB_EDGE).toBuffer(),
    ]);
    return {
      main: main.data,
      thumb,
      width: main.info.width,
      height: main.info.height,
      bytes: main.data.length,
      hasAlpha,
      sourceMime: kind,
    };
  } catch (err) {
    throw new ImageError("bad_image", 400, err instanceof Error ? err.message : undefined);
  }
}
