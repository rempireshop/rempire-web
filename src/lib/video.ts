/**
 * What counts as a product video — the server's half of parseVideo() in
 * public/shop2/app.js.
 *
 * There are four shapes and the shop renders each one differently, so both
 * sides have to agree on what a stored `product_overrides.video_url` may be:
 *
 *   yt / vimeo  a click-to-load embed, built from the id — the address the
 *               owner pasted is never rendered anywhere.
 *   instagram   the same reel or post address with `/embed/` on the end. No
 *               token, no API key, no account: that page is public.
 *   file        an .mp4/.mov the owner uploaded himself
 *               (POST /api/admin/upload, kind=video → `videos/…` in our own
 *               R2 bucket). This is the ONLY shape whose stored address is
 *               used verbatim as a media source, which is why it is the only
 *               one pinned to our own public host rather than to a pattern.
 *
 * The parse is deliberately done with `new URL()` and a host comparison
 * rather than a regular expression that searches. A regex that merely FINDS
 * "youtube.com/watch?v=…" somewhere in the field happily accepts
 * `javascript:alert(1)#youtube.com/watch?v=xxxxxxx`; a URL parse that then
 * checks `protocol` cannot. `javascript:` and `data:` are refused here, at
 * the door, not filtered out later.
 *
 * Uploads: `video/mp4` and `video/quicktime` (what an iPhone records), up to
 * 60 MB, and — like every image on this shop — the type is read off the first
 * bytes rather than believed from the browser's Content-Type. Nothing is
 * transcoded: a phone's own H.264 plays in every browser as it is, and
 * ffmpeg is not a dependency this project is going to grow for one field.
 * See docs/media.md.
 */
import { keyFromUrl } from "@/lib/storage";

/* ---------- uploads ------------------------------------------------------- */

/** 60 MB. A minute of phone video is 60–120 MB at 4K, 15–30 MB at 1080p. */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export const ACCEPTED_VIDEO_MIME = ["video/mp4", "video/quicktime"] as const;
export type AcceptedVideoMime = (typeof ACCEPTED_VIDEO_MIME)[number];

/** The file extension a given type is stored under. */
export const VIDEO_EXT: Record<AcceptedVideoMime, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

const ascii = (b: Uint8Array, from: number, len: number): string =>
  Buffer.from(b.subarray(from, from + len)).toString("latin1");

/**
 * MP4 and MOV are both ISO base media files: a `ftyp` box at offset 4 whose
 * major brand says which. `qt  ` is QuickTime; everything else in the list is
 * an MP4 profile a phone or a camera actually writes. An unknown brand comes
 * back null rather than being waved through as "probably fine" — the bytes
 * are what ends up in the bucket with a video/* content type on it.
 */
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "m4v ", "dash", "mmp4"]);

export function sniffVideo(input: Uint8Array): AcceptedVideoMime | null {
  if (input.length < 12) return null;
  if (ascii(input, 4, 4) !== "ftyp") return null;
  const brand = ascii(input, 8, 4).toLowerCase();
  if (brand === "qt  ") return "video/quicktime";
  return MP4_BRANDS.has(brand) ? "video/mp4" : null;
}

/* ---------- the four shapes ----------------------------------------------- */

export type ProductVideo =
  | { kind: "yt"; id: string; embed: string; page: string }
  | { kind: "vimeo"; id: string; embed: string; page: string }
  | { kind: "instagram"; id: string; shape: "reel" | "p"; embed: string; page: string }
  | { kind: "file"; id: string; embed: string; page: string };

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID = /^\d{6,12}$/;
/** Instagram shortcodes are base64url-ish, 10–11 today; allow a little room. */
const IG_ID = /^[A-Za-z0-9_-]{5,24}$/;

function host(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
}

/** Path segments with the empty ones dropped: "/reel/abc/" → ["reel","abc"]. */
function segments(u: URL): string[] {
  return u.pathname.split("/").filter(Boolean);
}

/**
 * The one door. `null` for anything this shop cannot turn into a player —
 * which is also what the admin turns into a refusal, so «Сохранено ✓» never
 * means "stored, and shows nothing".
 */
export function parseProductVideo(raw: unknown): ProductVideo | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 500) return null;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  // Kills javascript:, data:, vbscript:, file: and everything else in one line.
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const h = host(u);
  const seg = segments(u);

  /* ---- YouTube ---------------------------------------------------------- */
  if (h === "youtu.be" && seg.length && YT_ID.test(seg[0])) return yt(seg[0]);
  if (h === "youtube.com" || h === "youtube-nocookie.com") {
    if (seg[0] === "watch") {
      const v = u.searchParams.get("v") || "";
      if (YT_ID.test(v)) return yt(v);
    }
    if ((seg[0] === "embed" || seg[0] === "shorts" || seg[0] === "live") && seg[1] && YT_ID.test(seg[1])) {
      return yt(seg[1]);
    }
    return null;
  }

  /* ---- Vimeo ------------------------------------------------------------ */
  if (h === "vimeo.com" || h === "player.vimeo.com") {
    const id = seg.find((x) => VIMEO_ID.test(x));
    return id ? vimeo(id) : null;
  }

  /* ---- Instagram --------------------------------------------------------
     Both shapes the app's own «Copy link» produces:
       instagram.com/reel/<id>/ · instagram.com/p/<id>/
     and the same two with the account name in front, which is what a link
     copied from a profile grid looks like. `reels` is the plural the web
     app sometimes uses; it embeds under `reel`. */
  if (h === "instagram.com" || h === "instagr.am" || h === "ddinstagram.com") {
    const at = seg.findIndex((x) => x === "reel" || x === "reels" || x === "p" || x === "tv");
    // Only a bare id or one account segment in front — nothing deeper.
    if (at < 0 || at > 1 || !seg[at + 1] || !IG_ID.test(seg[at + 1])) return null;
    return instagram(seg[at] === "p" ? "p" : "reel", seg[at + 1]);
  }

  /* ---- a file in our own bucket ------------------------------------------
     keyFromUrl() is what pins this to R2_PUBLIC_BASE; the `videos/` prefix is
     what stops a photo key being served as a <video>. Without the bucket
     configured there is no host to match, so this returns null — correct: a
     shop with no storage cannot have an uploaded video either. */
  const key = keyFromUrl(s);
  if (key && key.startsWith("videos/")) return { kind: "file", id: key, embed: s, page: s };

  return null;
}

function yt(id: string): ProductVideo {
  return {
    kind: "yt",
    id,
    embed: `https://www.youtube-nocookie.com/embed/${id}`,
    page: `https://www.youtube.com/watch?v=${id}`,
  };
}
function vimeo(id: string): ProductVideo {
  return { kind: "vimeo", id, embed: `https://player.vimeo.com/video/${id}`, page: `https://vimeo.com/${id}` };
}
function instagram(shape: "reel" | "p", id: string): ProductVideo {
  const page = `https://www.instagram.com/${shape}/${id}/`;
  return { kind: "instagram", id, shape, embed: `${page}embed/`, page };
}

/**
 * What `product_overrides.video_url` is allowed to hold: the address itself,
 * trimmed, when it is one of the four shapes above — and `null` for an empty
 * field. Anything else throws, because a link the shop cannot play is not
 * something to store quietly: the owner would see «Сохранено ✓» and then no
 * video, with nothing anywhere to explain the difference.
 */
export class VideoError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

export function cleanVideoUrl(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (!parseProductVideo(s)) throw new VideoError("bad_video", s.slice(0, 120));
  return s;
}
