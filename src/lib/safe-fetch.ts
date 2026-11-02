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

const defaultRequest: SafeRequest = (url, lookup, signal) =>
  new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      lookup,
      signal,
      headers: {
        "user-agent": "RempireShop/1.0 (+https://rempireshop.com) blog-materials",
        accept: "text/html,text/plain;q=0.9",
        "accept-encoding": "identity",
      },
    }, (res) => resolve({ status: res.statusCode || 0, headers: res.headers, body: res }));
    req.on("error", reject);
    req.end();
  });

export interface PublicPage {
  url: string;
  title: string;
  text: string;
}

/**
 * The text of a public https page. Refuses with a SafeFetchError (its `code`
 * says which rule) — never reaches a private address, never follows a
 * redirect it has not checked, never reads past the caps.
 */
export async function fetchPublicPage(
  raw: string,
  deps: { resolve?: Resolve; request?: SafeRequest; timeoutMs?: number; maxBytes?: number } = {},
): Promise<PublicPage> {
  const resolve = deps.resolve ?? defaultResolve;
  const request = deps.request ?? defaultRequest;
  const maxBytes = deps.maxBytes ?? FETCH_MAX_BYTES;
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
    const type = String(res.headers["content-type"] || "").toLowerCase();
    if (type && !/^(text\/html|text\/plain|application\/xhtml\+xml)/.test(type)) throw new SafeFetchError("not_text");

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
    const html = Buffer.concat(chunks).toString("utf8");
    const page = /html/.test(type) || /<html|<body|<p[\s>]/i.test(html) ? htmlToText(html) : { title: "", text: html };
    return { url: url.toString(), title: page.title, text: page.text };
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

/** The words a reader of the page sees, as paragraphs; no script, style or menu markup. */
export function htmlToText(html: string): { title: string; text: string } {
  const src = String(html || "");
  const title = decode((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim()).slice(0, 200);
  const body = (src.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? src)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|header|main|figure|figcaption|dd|dt)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body)
    .split("\n")
    .map((l) => l.replace(/[\t\f\v  ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 60_000);
  return { title, text };
}
