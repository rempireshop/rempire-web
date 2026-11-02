/**
 * Read a public web page for the blog's «Материалы» → «Ссылка» — and nothing
 * else on the internet, and nothing inside our own network.
 *
 * The owner pastes an address («tallinnavesi.ee — жёсткость воды»), and the
 * server fetches it so the article writer can read it. A server that fetches
 * whatever address it is handed is the classic SSRF hole: the address can
 * name 169.254.169.254 (a cloud's metadata service), 127.0.0.1, a 10.x
 * neighbour, or a public name whose DNS answers with one of those, or a public
 * page that redirects to one. So, every one of these is refused:
 *
 *   · anything but https:, a user:password in the address, a port other than 443;
 *   · a host that is an IP literal, «localhost», or a name under .local,
 *     .internal, .localhost, .home.arpa;
 *   · a name that resolves to ANY private, loopback, link-local, CGNAT,
 *     multicast, reserved or IPv4-mapped-private address — checked at the
 *     moment of connecting (the `lookup` handed to https.request), so a DNS
 *     answer that changes between a check and the connect (rebinding) is the
 *     answer that is checked;
 *   · a redirect: followed by hand, at most three, each new address put
 *     through all of the above again;
 *   · more than 2 MB, more than 10 seconds in all, or a type that is not HTML
 *     or plain text.
 *
 * What comes back is the page's TEXT (HTML → text here, no script runs), its
 * <title>, and where it ended up. Waiting on the network costs the function
 * nothing on Vercel's CPU meter; the HTML → text is a few regex passes over
 * at most 2 MB.
 *
 * fetchPublicFile (Dim, 02.11.2026: Renat's Claude saves a material from a
 * link — «PDFs and images at a URL included, with size/type limits») goes
 * through the very same loop and takes a PDF (20 MB) or a photo (JPEG, PNG,
 * WebP, AVIF; 12 MB) as well as a page, within 20 seconds; what the bytes
 * are is decided by their first bytes, not by the name or the header alone.
 * src/lib/blog-material-link.ts turns them into a material.
 *
 * The network halves (`resolve` and `request`) can be handed in, which is how
 * tests/blog-materials.test.ts proves every refusal without a network.
 */
import dns from "node:dns";
import https from "node:https";
import net from "node:net";

export class SafeFetchError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_REDIRECTS = 3;

/* ---------- which addresses are the public internet ---------------------- */

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}
const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],       // «this network»
  ["10.0.0.0", 8],      // private
  ["100.64.0.0", 10],   // carrier-grade NAT
  ["127.0.0.0", 8],     // loopback
  ["169.254.0.0", 16],  // link-local — the cloud metadata service lives here
  ["172.16.0.0", 12],   // private
  ["192.0.0.0", 24],    // IETF protocol assignments
  ["192.0.2.0", 24],    // documentation
  ["192.88.99.0", 24],  // 6to4 relay
  ["192.168.0.0", 16],  // private
  ["198.18.0.0", 15],   // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24],  // documentation
  ["224.0.0.0", 4],     // multicast
  ["240.0.0.0", 4],     // reserved, and 255.255.255.255
];
function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}
/** An IPv6 address as eight 16-bit groups (expanding «::» and a dotted tail). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    s = s.slice(0, -dotted[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => parseInt(g || "0", 16));
  return out.every((g) => Number.isFinite(g) && g >= 0 && g <= 0xffff) ? out : null;
}
function v6Blocked(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true;                              // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;    // ::1
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible) — judged as the IPv4 they carry
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return v4Blocked([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join("."));
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;                     // NAT64 — reaches IPv4 we cannot see
  if ((g[0] & 0xfe00) === 0xfc00) return true;                           // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                           // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true;                           // fec0::/10 site-local (old)
  if ((g[0] & 0xff00) === 0xff00) return true;                           // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                   // documentation
  if (g[0] === 0x2002) return true;                                      // 6to4 — wraps an IPv4 inside
  return false;
}
/** Is this resolved address somewhere a request from our server must never go? */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind === 6) return v6Blocked(ip);
  return true;   // not an address at all: refused
}

const BAD_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|corp)$/i;

/** The address as given, checked for everything that does not need DNS. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    throw new SafeFetchError("bad_url");
  }
  if (u.protocol !== "https:") throw new SafeFetchError("not_https");
  if (u.username || u.password) throw new SafeFetchError("credentials");
  if (u.port && u.port !== "443") throw new SafeFetchError("bad_port");
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || net.isIP(host)) throw new SafeFetchError("ip_host");
  if (BAD_HOST.test(host) || !host.includes(".")) throw new SafeFetchError("private_host");
  return u;
}

/* ---------- the fetch ------------------------------------------------------ */

type Resolve = (host: string) => Promise<Array<{ address: string; family: number }>>;
export type SafeRequest = (url: URL, lookup: net.LookupFunction, signal: AbortSignal) => Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer | string>;
}>;

const defaultResolve: Resolve = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** The lookup https.request connects with: every address the name has must be public. */
export function guardedLookup(resolve: Resolve = defaultResolve): net.LookupFunction {
  return ((hostname: string, options: unknown, callback: (...a: unknown[]) => void) => {
    const cb = typeof options === "function" ? (options as (...a: unknown[]) => void) : callback;
    const all = !!(options && typeof options === "object" && (options as { all?: boolean }).all);
    resolve(hostname).then((list) => {
      if (!list.length) return cb(new SafeFetchError("no_address"));
      if (list.some((a) => isPrivateAddress(a.address))) return cb(new SafeFetchError("private_address"));
      if (all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    }, (err) => cb(err));
  }) as net.LookupFunction;
}

const PAGE_ACCEPT = "text/html,text/plain;q=0.9";
/** What a file link asks for — a page, a PDF or a photo (fetchPublicFile). */
const FILE_ACCEPT = "text/html,application/pdf,image/jpeg,image/png,image/webp,image/avif;q=0.9,text/plain;q=0.8";

const requestWith = (accept: string): SafeRequest => (url, lookup, signal) =>
  new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      lookup,
      signal,
      headers: {
        "user-agent": "RempireShop/1.0 (+https://rempireshop.com) blog-materials",
        accept,
        "accept-encoding": "identity",
      },
    }, (res) => resolve({ status: res.statusCode || 0, headers: res.headers, body: res }));
    req.on("error", reject);
    req.end();
  });
const defaultRequest: SafeRequest = requestWith(PAGE_ACCEPT);
const fileRequest: SafeRequest = requestWith(FILE_ACCEPT);

export interface PublicPage {
  url: string;
  title: string;
  text: string;
}

type Deps = { resolve?: Resolve; request?: SafeRequest; timeoutMs?: number; maxBytes?: number };

/**
 * The text of a public https page. Refuses with a SafeFetchError (its `code`
 * says which rule) — never reaches a private address, never follows a
 * redirect it has not checked, never reads past the caps.
 */
export async function fetchPublicPage(raw: string, deps: Deps = {}): Promise<PublicPage> {
  const maxBytes = deps.maxBytes ?? FETCH_MAX_BYTES;
  const got = await fetchGuarded(raw, { ...deps, request: deps.request ?? defaultRequest }, (type) =>
    !type || /^(text\/html|text\/plain|application\/xhtml\+xml)/.test(type) ? { kind: "page", max: maxBytes } : null);
  return { url: got.url, ...pageOf(got.type, got.body) };
}

function pageOf(type: string, body: Buffer): { title: string; text: string } {
  const html = body.toString("utf8");
  return /html/.test(type) || /<html|<body|<p[\s>]/i.test(html) ? htmlToText(html) : { title: "", text: html };
}

/* ---------- a file at a link: a page, a PDF or a photo ------------------- */

/** Each kind's own ceiling (Dim's «with size/type limits», 02.11.2026). */
export const FILE_MAX_BYTES = { page: FETCH_MAX_BYTES, pdf: 20 * 1024 * 1024, image: 12 * 1024 * 1024 } as const;
/** A 20 MB catalogue on a slow brand site is longer than a page — still waiting, not work. */
export const FILE_TIMEOUT_MS = 20_000;
export type PublicFileKind = "page" | "pdf" | "image";
export type PublicFile =
  | ({ kind: "page" } & PublicPage)
  | { kind: "pdf" | "image"; url: string; type: string; bytes: Buffer };

const IMAGE_TYPES = /^image\/(jpeg|jpg|pjpeg|png|webp|avif)\b/;
/* Servers that send a PDF as «a file» — decided by its first bytes instead. */
const OCTET = /^(application\/(octet-stream|x-pdf|force-download|download|binary)|binary\/octet-stream)\b/;

/** The kind the first bytes say — never the name, never the header alone. */
export function sniffKind(bytes: Buffer): "pdf" | "image" | "" {
  if (bytes.subarray(0, 1024).toString("latin1").includes("%PDF-")) return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image";                                  // JPEG
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image";   // PNG
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image";
  if (bytes.subarray(4, 12).toString("latin1").startsWith("ftypavi")) return "image";                              // AVIF
  return "";
}

/**
 * A public https address as a page's text, a PDF's bytes or a photo's bytes —
 * through every rule fetchPublicPage keeps (the address, DNS at the connect,
 * each redirect), each kind under its own ceiling. The type in the header
 * picks the ceiling; the first bytes have the last word, so a «PDF» that is
 * an HTML page, or a photo that is a script, is refused as `not_file`.
 */
export async function fetchPublicFile(raw: string, deps: Deps = {}): Promise<PublicFile> {
  const got = await fetchGuarded(raw, { timeoutMs: FILE_TIMEOUT_MS, ...deps, request: deps.request ?? fileRequest }, (type) => {
    if (!type || /^(text\/html|text\/plain|application\/xhtml\+xml)/.test(type)) return { kind: "page", max: FILE_MAX_BYTES.page };
    if (/^application\/pdf\b/.test(type) || OCTET.test(type)) return { kind: "pdf", max: FILE_MAX_BYTES.pdf };
    if (IMAGE_TYPES.test(type)) return { kind: "image", max: FILE_MAX_BYTES.image };
    return null;
  });
  const sniffed = sniffKind(got.body);
  if (got.kind === "page") {
    // a page that is really a PDF or a photo, sent as text by a careless server
    if (sniffed === "pdf" || sniffed === "image") return { kind: sniffed, url: got.url, type: got.type, bytes: got.body };
    return { kind: "page", url: got.url, ...pageOf(got.type, got.body) };
  }
  if (sniffed !== got.kind) throw new SafeFetchError("not_file");
  return { kind: got.kind as "pdf" | "image", url: got.url, type: got.type, bytes: got.body };
}

/** The one guarded loop both readers go through; `classify` says which types are wanted and how many bytes each may have. */
async function fetchGuarded(
  raw: string,
  deps: Deps,
  classify: (type: string) => { kind: PublicFileKind; max: number } | null,
): Promise<{ url: string; type: string; kind: PublicFileKind; body: Buffer }> {
  const resolve = deps.resolve ?? defaultResolve;
  const request = deps.request ?? defaultRequest;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  let url = checkUrl(raw);

  for (let hop = 0; ; hop++) {
    /* Checked before the request too, so a refusal does not depend on the
       request function honouring `lookup` — the connect is checked again. */
    const list = await resolve(url.hostname).catch(() => {
      throw new SafeFetchError("no_address");
    });
    if (!list.length) throw new SafeFetchError("no_address");
    if (list.some((a) => isPrivateAddress(a.address))) throw new SafeFetchError("private_address");

    let res;
    try {
      res = await request(url, guardedLookup(resolve), signal);
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;
      throw new SafeFetchError(signal.aborted ? "timeout" : "unreachable");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.location;
      const next = Array.isArray(loc) ? loc[0] : loc;
      if (!next) throw new SafeFetchError("bad_redirect");
      if (hop >= FETCH_MAX_REDIRECTS) throw new SafeFetchError("too_many_redirects");
      let target: string;
      try {
        target = new URL(next, url).toString();
      } catch {
        throw new SafeFetchError("bad_redirect");
      }
      url = checkUrl(target);   // the same rules for where it sends us
      continue;
    }
    if (res.status !== 200) throw new SafeFetchError("http_" + res.status);
    const type = String(res.headers["content-type"] || "").toLowerCase().trim();
    const want = classify(type);
    if (!want) throw new SafeFetchError("not_text");
    const maxBytes = deps.maxBytes ? Math.min(deps.maxBytes, want.max) : want.max;
    // a length that says «too big» is refused before a byte is read
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) throw new SafeFetchError("too_large");

    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const c of res.body) {
        const b = typeof c === "string" ? Buffer.from(c) : c;
        size += b.length;
        if (size > maxBytes) throw new SafeFetchError("too_large");
        chunks.push(b);
      }
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;
      throw new SafeFetchError(signal.aborted ? "timeout" : "unreachable");
    }
    return { url: url.toString(), type, kind: want.kind, body: Buffer.concat(chunks) };
  }
}

/* ---------- HTML → text ---------------------------------------------------- */

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", laquo: "«", raquo: "»", hellip: "…" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/* Everything below runs on a page somebody else wrote, so every step is
 * linear: no lazy scans to a closing tag, no unbounded `[^>]*` that a page
 * full of unclosed «<br» would rescan to the end once per tag (security
 * review, 02.11.2026). Only the first HTML_SCAN_MAX characters are read;
 * the text kept is capped at 60k anyway. */
const HTML_SCAN_MAX = 600_000;
const SKIP_TAGS = /<(script|style|noscript|svg|template|iframe|head|nav|footer|form)\b/gi;

/** `src` with every `open … close` span cut out; an unclosed one cuts to the end. */
function cutSpans(src: string, lower: string, open: string, close: (m: string) => string, rx?: RegExp): string {
  let out = "";
  let pos = 0;
  for (;;) {
    let at: number;
    let closeTag: string;
    if (rx) {
      rx.lastIndex = pos;
      const m = rx.exec(lower);
      if (!m) break;
      at = m.index;
      closeTag = close(m[1]);
    } else {
      at = lower.indexOf(open, pos);
      if (at < 0) break;
      closeTag = close("");
    }
    out += src.slice(pos, at) + " ";
    const end = lower.indexOf(closeTag, at + 1);
    if (end < 0) return out;
    const gt = closeTag.endsWith(">") ? end + closeTag.length : lower.indexOf(">", end);
    if (gt < 0) return out;
    pos = closeTag.endsWith(">") ? gt : gt + 1;
  }
  return out + src.slice(pos);
}

/** The words a reader of the page sees, as paragraphs; no script, style or menu markup. */
export function htmlToText(html: string): { title: string; text: string } {
  const src = String(html || "").slice(0, HTML_SCAN_MAX);
  const lower = src.toLowerCase();
  const ts = lower.indexOf("<title");
  const tgt = ts < 0 ? -1 : lower.indexOf(">", ts);
  const te = tgt < 0 ? -1 : lower.indexOf("</title", tgt);
  const title = decode((te < 0 ? "" : src.slice(tgt + 1, te)).replace(/\s+/g, " ").trim()).slice(0, 200);
  const bs = lower.indexOf("<body");
  const bgt = bs < 0 ? -1 : lower.indexOf(">", bs);
  const be = bgt < 0 ? -1 : lower.lastIndexOf("</body");
  const inner = bgt >= 0 ? src.slice(bgt + 1, be > bgt ? be : src.length) : src;
  const noComments = cutSpans(inner, inner.toLowerCase(), "<!--", () => "-->");
  const body = cutSpans(noComments, noComments.toLowerCase(), "", (tag) => "</" + tag, SKIP_TAGS)
    .replace(/<(br|hr)\b[^<>]{0,500}>/gi, "\n")
    .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|header|main|figure|figcaption|dd|dt)\b[^<>]{0,2000}>/gi, "\n")
    .replace(/<[^<>]{0,2000}>/g, " ");
  const text = decode(body)
    .split("\n")
    .map((l) => l.replace(/[\t\f\v  ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 60_000);
  return { title, text };
}
