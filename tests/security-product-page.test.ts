/**
 * Security re-audit, 04.09.2026 — the request-time product page and the
 * custom sitemap (src/lib/product-page.ts, src/lib/seo-head.mjs,
 * src/app/shop2/{,et/,en/}p/[id]/route.ts, src/app/sitemap-custom.xml/route.ts)
 * and the header block in next.config.ts that covers them.
 *
 * The owner types brand, name, sizes, description and the Google pair; the
 * page puts them into <title>, meta attributes, HTML text and the JSON-LD.
 * Each context has its own rule. What is pinned here:
 *   · no owner-typed string opens a tag or an attribute, or ends the <title>;
 *   · the JSON-LD block cannot be ended early («</script>»), cannot open the
 *     HTML parser's escaped state («<!--») and carries no raw U+2028/U+2029;
 *   · the id is a slug or the request answers 404 with the shell — never a
 *     file path, never a 5xx (the 404 half is new on 07.09.2026: a product
 *     nobody has is a page nobody has);
 *   · a hidden product is a 404 no cache may keep, a shown one is cached for
 *     a minute, a database outage is the shell, uncached;
 *   · the sitemap escapes and caches sanely;
 *   · the /shop2/* CSP has no 'unsafe-inline' in script-src, the page carries
 *     no inline executable script, and the inline <style> the shell ships is
 *     covered by style-src.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomProduct, setCustomProductActive } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { esc, headBlock } from "@/lib/seo-head.mjs";
import catalogueMin from "@/data/catalogue.min.json";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const LIVE = "https://rempireshop.com";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function pageFor(seg: "" | "et" | "en", id: string): Promise<Response> {
  const mod = seg === "et"
    ? await import("@/app/shop2/et/p/[id]/route")
    : seg === "en"
      ? await import("@/app/shop2/en/p/[id]/route")
      : await import("@/app/shop2/p/[id]/route");
  return mod.GET(new Request(`${LIVE}/shop2${seg ? "/" + seg : ""}/p/${encodeURIComponent(id)}/`), ctx(id));
}

const title = (html: string) => (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? "";
const meta = (html: string, key: string) =>
  (html.match(new RegExp(`<meta (?:name|property)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content="([^"]*)"`)) || [])[1] ?? "";
/** Every <script …>…</script> on the page, attributes and body apart. */
function scripts(html: string): Array<{ attrs: string; body: string }> {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
}
const ldBlocks = (html: string) => scripts(html).filter((s) => /type="application\/ld\+json"/.test(s.attrs));

/* Every field the owner can type, each carrying the one thing that breaks
   its own context: a closing tag for the JSON-LD, a comment opener, a quote
   for an attribute, an end tag for the <title>. All within the caps
   src/lib/custom-products.ts enforces, so they are stored as written. */
const HOSTILE = {
  brand: "</script><img src=x onerror=alert(1)>",
  name: 'Balm <!--<script>alert(2)</script> "q" & co',
  cat: "beard",
  sizes: ["100 мл</li><script>x</script>"],
  prices: [9],
  description: { RU: "Текст </script><svg onload=alert(3)> конец", EN: "Text </script><!-- x --> end" },
  seo: { RU: { title: "</title><script>alert(4)</script>", desc: '"><script>alert(5)</script>' } },
  gallery: [{ url: "https://cdn.example.com/p/x.png", thumb: "https://cdn.example.com/p/x.png", alt: '"><script>alert(6)</script>' }],
};

const BALM = { brand: "Proraso", name: "Beard Balm", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] };

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = LIVE;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  vi.spyOn(console, "error").mockImplementation(() => {});
  await exec("truncate custom_products, product_overrides restart identity cascade");
});
afterEach(() => vi.restoreAllMocks());

/* ---------- escaping, context by context ---------------------------------- */

describe("owner-typed text on a custom product's page", () => {
  it("cannot open a tag, end the <title>, or break out of an attribute", async () => {
    const p = await createCustomProduct(HOSTILE);
    for (const seg of ["", "en"] as const) {
      const res = await pageFor(seg, p.id);
      expect(res.status, seg).toBe(200);
      const html = await res.text();

      // one <title>, ended where the page ends it, the owner's text inside as text
      expect((html.match(/<title>/g) || []).length, seg).toBe(1);
      expect((html.match(/<\/title>/g) || []).length, seg).toBe(1);
      expect(title(html), seg).toBe(esc("</title><script>alert(4)</script> — REMPIRE"));
      // the meta description closes its own quote, not the owner's
      expect(meta(html, "description"), seg).toBe(esc('"><script>alert(5)</script>'));
      expect(meta(html, "og:title"), seg).toBe(title(html));

      // the body: h1, the size list, the description paragraphs
      expect(html, seg).toContain('<h1 class="pdp__title">' + esc(p.name) + "</h1>");
      expect(html, seg).toContain("<li>" + esc("100 мл</li><script>x</script>") + " · ");
      expect(html, seg).toContain(esc(seg === "en" ? "Text </script><!-- x --> end" : "Текст </script><svg onload=alert(3)> конец"));

      // nothing the owner typed became markup anywhere on the page
      expect(html, seg).not.toContain("<img src=x");
      expect(html, seg).not.toContain("<svg");
      expect(html, seg).not.toMatch(/<script>alert/);
      expect(html, seg).not.toContain("onerror=alert(1)>");
    }
  });

  it("the JSON-LD cannot be ended early, cannot open the parser's escaped state, and still round-trips", async () => {
    const p = await createCustomProduct(HOSTILE);
    const html = await (await pageFor("", p.id)).text();

    // every <script> on the page is a file or a data block — never inline code
    const all = scripts(html);
    expect(all.length).toBe((html.match(/<script\b/g) || []).length);
    for (const s of all) {
      expect(s.attrs, s.attrs).toMatch(/\bsrc="|type="application\/(?:ld\+json|json)"/);
    }
    // the data blocks carry none of the three characters HTML's script parser reacts to
    const ld = ldBlocks(html);
    expect(ld.length).toBeGreaterThanOrEqual(2);
    for (const block of ld) {
      expect(block.body).not.toMatch(/[<>\u2028\u2029]/);
      expect(() => JSON.parse(block.body)).not.toThrow();
    }
    // …and are the same JSON to a reader: the name and the brand are exactly what was typed
    const product = ld.map((b) => JSON.parse(b.body) as Record<string, unknown>).find((o) => o["@type"] === "Product") as
      Record<string, unknown> & { brand: { name: string } };
    expect(product.name).toBe(`${p.brand} ${p.name}`);
    expect(product.brand.name).toBe(p.brand);
    expect(product.sku).toBe(p.id);
  });

  it("headBlock() escapes the JSON-LD for its own context — «</script>», «<!--», the two line separators — losslessly", () => {
    const lang = { code: "RU", seg: "", tag: "ru", htmlLang: "ru", ogLocale: "ru_RU" };
    const ld = {
      "@context": "https://schema.org", "@type": "Product",
      name: "</script><!--", description: "a\u2028b\u2029c<>&\"'/",
    };
    const html = headBlock({
      base: LIVE, robots: "noindex, nofollow", lang, seg: "", rest: "/p/c-x/",
      title: "T</title>", desc: 'D"', image: "/brand/og-default.png", imageAlt: "a<b", ogType: "product", ldMain: true,
      jsonld: [ld],
    }) as string;
    const block = html.match(/<script type="application\/ld\+json" id="ldjson">([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(block).not.toBe("");
    expect(block).not.toMatch(/[<>\u2028\u2029]/);
    expect(JSON.parse(block)).toEqual(ld);
    expect(html).toContain("<title>T&lt;/title&gt;</title>");
    expect(html).toContain('content="D&quot;"');
    expect(html).toContain('content="a&lt;b"');
  });
});

/* ---------- the id ----------------------------------------------------------- */

describe("the id in the path", () => {
  /* Every one of these is a product that does not exist, whatever it is
     dressed up as. Until 07.09.2026 they were all answered with the shell at
     200 — safe, but a soft 404 for a page nobody has (see
     docs/audit/2026-09-07-storefront.md): a `c-` slug nobody owns already
     answered 404, and now so does everything else that is neither a real
     catalogue id nor a real custom one. What the security of it rests on has
     not moved: the shell, never a file, never a 5xx, never somebody else's
     product, and never a `Product` block for a row that is not there. */
  it("anything that is not a product answers 404 with the shell, whatever it looks like", async () => {
    const ids = [
      "c-../../etc/passwd", "c-x/../y", "..%2f..%2fetc", "c-A", "C-UPPER", "c-", "c-x y",
      "c-" + "a".repeat(200), "c-x\u0000", "c-<script>", "c-%00", "c-x'; drop table custom_products; --",
    ];
    for (const id of ids) {
      const res = await pageFor("et", id);
      expect(res.status, id).toBe(404);
      expect(res.headers.get("content-type"), id).toContain("text/html");
      // an address that does not exist is never cached and never indexed
      expect(res.headers.get("cache-control"), id).toBe("no-store");
      const html = await res.text();
      expect(html, id).toContain('<div id="app">');
      expect(html, id).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html, id).not.toContain('id="ldjson"');
      expect(html, id).not.toContain("passwd");
    }
    /* …and a real catalogue id still gets the shell at 200: that is the
       fresh-clone case, where `npm run prerender` has not written the static
       page yet and 404ing a product the shop really sells would be worse than
       the soft 404 this test used to pin. */
    const real = await pageFor("et", (catalogueMin as Array<{ id: string }>)[0].id);
    expect(real.status).toBe(200);
    expect(await real.text()).toContain('<div id="app">');

    // and the table is still there — nothing above was SQL
    expect(await createCustomProduct(BALM)).toMatchObject({ id: "c-proraso-beard-balm" });
  });
});

/* ---------- caching ------------------------------------------------------------ */

describe("what a cache may keep", () => {
  it("a shown product for a minute, a hidden one never, an outage never", async () => {
    const p = await createCustomProduct(BALM);
    const shown = await pageFor("", p.id);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=300");

    await setCustomProductActive(p.id, false);
    const hidden = await pageFor("", p.id);
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("cache-control")).toBe("no-store");
    const html = await hidden.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain(p.name);

    await setCustomProductActive(p.id, true);
    const back = await pageFor("", p.id);
    expect(back.status).toBe(200);
    expect(back.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=300");

    // the table gone: the shell, uncached — never a 5xx, never a stale page
    await exec("alter table custom_products rename to custom_products_gone");
    try {
      const down = await pageFor("", p.id);
      expect(down.status).toBe(200);
      expect(down.headers.get("cache-control")).toBe("no-store");
      const shell = await down.text();
      expect(shell).toContain('<div id="app">');
      expect(shell).not.toContain(p.name);
      expect(shell).not.toMatch(/relation|custom_products|\.ts:\d+/);
    } finally {
      await exec("alter table custom_products_gone rename to custom_products");
    }
  });
});

/* ---------- the sitemap ------------------------------------------------------- */

describe("sitemap-custom.xml", () => {
  it("escapes what it prints, caches for five minutes, and is an uncached empty urlset on an outage", async () => {
    const p = await createCustomProduct(HOSTILE);
    const { GET } = await import("@/app/sitemap-custom.xml/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    const xml = await res.text();
    expect(xml).toContain(`<loc>${LIVE}/shop2/p/${p.id}/</loc>`);
    // only slugs ever reach the XML, and every text node is escaped: no raw ampersand, no tag but the sitemap's own
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
    expect(xml.replace(/<\/?(?:\?xml|urlset|url|loc|xhtml:link|lastmod|priority)\b[^>]*>/g, "")).not.toMatch(/[<>]/);
    expect(xml).not.toMatch(/<script|&lt;|&quot;/i);

    await exec("alter table custom_products rename to custom_products_gone");
    try {
      const down = await GET();
      expect(down.status).toBe(200);
      expect(down.headers.get("cache-control")).toBe("no-store");
      expect(await down.text()).toMatch(/<urlset [^>]*>\n<\/urlset>\n$/);
    } finally {
      await exec("alter table custom_products_gone rename to custom_products");
    }
  });
});

/* ---------- headers ---------------------------------------------------------- */

function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const [k, ...v] = part.trim().split(/\s+/);
    if (k) out[k] = v;
  }
  return out;
}

describe("the security headers over /shop2/*", () => {
  it("script-src has no 'unsafe-inline' or 'unsafe-eval'; the inline <style> is covered; HSTS and framing are set", async () => {
    const { default: nextConfig } = await import("../next.config");
    const rules = await nextConfig.headers!();
    const header = (source: string, key: string) =>
      rules.find((r) => r.source === source)?.headers.find((h) => h.key === key)?.value ?? "";

    for (const source of ["/shop2", "/shop2/:path*"]) {
      const d = directives(header(source, "Content-Security-Policy"));
      expect(d["script-src"], source).toBeTruthy();
      expect(d["script-src"], source).not.toContain("'unsafe-inline'");
      expect(d["script-src"], source).not.toContain("'unsafe-eval'");
      expect(d["script-src"], source).toContain("'self'");
      expect(d["style-src"], source).toContain("'unsafe-inline'");
      expect(d["frame-ancestors"], source).toEqual(["'none'"]);
      expect(d["base-uri"], source).toEqual(["'none'"]);
      expect(d["object-src"], source).toEqual(["'none'"]);
      expect(header(source, "Strict-Transport-Security"), source).toBe("max-age=31536000; includeSubDomains");
      expect(header(source, "X-Frame-Options"), source).toBe("DENY");
      expect(header(source, "X-Content-Type-Options"), source).toBe("nosniff");
    }
    // nothing anywhere loosened past what the audit accepted: 'unsafe-inline' for
    // scripts only where Next streams its own payload, never eval, never hashes
    const inlineScript = rules
      .filter((r) => (directives(r.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "")["script-src"] ?? []).includes("'unsafe-inline'"))
      .map((r) => r.source);
    expect(inlineScript).toEqual(["/:path*", "/prototypes/:path*", "/api/admin/mail/preview/:path*"]);
    // 'unsafe-eval' exists for exactly one path: the design archive under
    // /prototypes/, whose pages compile their own JSX in the browser. Nothing
    // the shop, the admin or the API serve may ever carry it.
    for (const r of rules) {
      const csp = r.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
      if (r.source === "/prototypes/:path*") {
        expect(directives(csp)["script-src"]).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
        continue;
      }
      expect(csp, r.source).not.toMatch(/unsafe-eval|unsafe-hashes|strict-dynamic/);
    }
  });

  it("the page the route serves fits that policy: scripts are files from 'self' or the beacon host, styles are inline or from 'self'/Google Fonts", async () => {
    const p = await createCustomProduct(HOSTILE);
    const html = await (await pageFor("", p.id)).text();
    for (const s of scripts(html)) {
      const src = s.attrs.match(/\bsrc="([^"]*)"/)?.[1];
      if (src) expect(src, src).toMatch(/^\/|^https:\/\/static\.cloudflareinsights\.com\//);
      else expect(s.attrs, s.attrs).toMatch(/type="application\/(?:ld\+json|json)"/);
    }
    for (const m of html.matchAll(/<link\b([^>]*)>/g)) {
      if (!/rel="stylesheet"/.test(m[1])) continue;
      const href = m[1].match(/\bhref="([^"]*)"/)?.[1] ?? "";
      expect(href, href).toMatch(/^\/|^https:\/\/fonts\.googleapis\.com\//);
    }
    // the shell's two inline <style> blocks are the ones style-src 'unsafe-inline' exists for
    expect(html).toContain("<style>html{background:#fff}</style>");
    expect(html).toContain('<style id="prestyle">');
  });
});
