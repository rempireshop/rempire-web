/**
 * Google's three ownership tags survive the domain move.
 *
 * The live Shopify home page (https://rempireshop.com/, read 23.09.2026)
 * carries three `google-site-verification` tags — Search Console and Merchant
 * Center verifications. When rempireshop.com points at this shop, whatever
 * «/» serves has to carry them too, or a re-check drops the property (and
 * Merchant Center's free listings with it). «/» redirects to /shop2/, which
 * is the shell public/shop2/index.html; every prerendered page and the
 * request-time pages are built from the same headBlock() in
 * src/lib/seo-head.mjs — the one source for all of them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GOOGLE_SITE_VERIFICATION, LANGS, headBlock, verificationMeta } from "@/lib/seo-head.mjs";

const LIVE_TAGS = [
  "KUVTHWQUdqKHip0q8VUKTRnAj9L6isKgUsWE4163wNM",
  "vnp_AFwYKflLNLDsABZXCMqo_75IxmAD8RLMIgh4ahs",
  "k3GujBXDQzx0nVeZE5Raig1rp6QDNY8SsR0ONwTb2lw",
];
const tag = (t: string) => `<meta name="google-site-verification" content="${t}">`;

/** The <head> of a page, and the part of it between the seo markers. */
function head(html: string): { head: string; seo: string } {
  const h = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  const seo = h.slice(h.indexOf("<!-- seo:start -->"), h.indexOf("<!-- seo:end -->"));
  return { head: h, seo };
}

describe("google-site-verification", () => {
  it("carries exactly the three tags the live Shopify home page carries", () => {
    expect(GOOGLE_SITE_VERIFICATION).toEqual(LIVE_TAGS);
    expect(verificationMeta()).toBe(LIVE_TAGS.map(tag).join("\n"));
  });

  it("is in the block every page's head is built from, in all three languages", () => {
    for (const lang of LANGS) {
      const block = headBlock({
        base: "https://rempireshop.com", robots: "index, follow", lang, seg: lang.seg, rest: "/",
        title: "REMPIRE", desc: "x", image: "https://rempireshop.com/og.png", imageAlt: "", ogType: "website",
        jsonld: null, ldMain: false,
      });
      for (const t of LIVE_TAGS) expect(block.split(tag(t)).length - 1, `${lang.code} ${t}`).toBe(1);
    }
  });

  it("is in the head of /shop2/ — the shell, which is also the Russian home page", () => {
    const shell = readFileSync("public/shop2/index.html", "utf8").replace(/\r\n?/g, "\n");
    const { head: h, seo } = head(shell);
    for (const t of LIVE_TAGS) {
      expect(h.split(tag(t)).length - 1, t).toBe(1);
      // inside the generated block, so the next prerender writes it back rather than dropping it
      expect(seo).toContain(tag(t));
    }
    // …exactly where headBlock() puts it: right after the robots meta
    expect(seo).toMatch(new RegExp('<meta name="robots" content="[^"]*">\\n' + LIVE_TAGS.map((t) => tag(t)).join("\\n")));
  });

  it("«/» is a redirect to /shop2/, so the shell's head is the one Google reads", () => {
    const cfg = readFileSync("next.config.ts", "utf8");
    expect(cfg).toMatch(/\{ source: "\/", destination: "\/shop2\/", permanent: false \}/);
  });
});
