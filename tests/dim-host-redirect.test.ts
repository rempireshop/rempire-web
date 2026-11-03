/**
 * rempireshop.diipsolutions.eu carries Dim's handover page and nothing of the
 * shop (Dim, 03.11.2026): every other page there moves to the same address on
 * rempireshop.com, while /handover, the panel it shares its marks with, the
 * API and every file those pages load stay. And on the shop's own domain the
 * rule does nothing at all. Resolved the way Next resolves next.config.ts's
 * redirects — the same matcher, host test and destination compiler.
 */
import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { constructRequest } from "next/dist/experimental/testing/server/utils";
import nextConfig from "../next.config";

type Redirect = { source: string; destination: string; permanent?: boolean; statusCode?: number; has?: never[]; missing?: never[] };

async function resolve(url: string): Promise<{ to: string; status: number } | null> {
  const u = new URL(url);
  const req = constructRequest({ url, headers: { host: u.host } });
  const query = Object.fromEntries(u.searchParams);
  for (const r of (await nextConfig.redirects!()) as Redirect[]) {
    const params = getPathMatch(r.source, { strict: true, removeUnnamedParams: true, regexModifier: undefined })(u.pathname);
    if (!params) continue;
    const has = r.has || r.missing ? matchHas(req as never, query, r.has, r.missing) : {};
    if (!has) continue;
    const { newUrl, parsedDestination } = prepareDestination({ appendParamsToQuery: false, destination: r.destination, params: { ...params, ...has }, query });
    const to = new URL(newUrl, `${parsedDestination.protocol}//${parsedDestination.hostname}`);
    to.search = u.search; // a redirect keeps the request's query
    return { to: to.href, status: r.statusCode ?? (r.permanent ? 308 : 307) };
  }
  return null;
}

describe("Dim's own domain carries the handover page only", () => {
  const DIM = "https://rempireshop.diipsolutions.eu";

  it("moves every page of the shop to the same address on rempireshop.com, query and all", async () => {
    for (const [from, to] of [
      ["/", "https://rempireshop.com/"],
      ["/collections/hair-care", "https://rempireshop.com/collections/hair-care"],
      ["/ru/products/x?size=50ml&utm_source=mail", "https://rempireshop.com/ru/products/x?size=50ml&utm_source=mail"],
      ["/et/blogs/news/some-article", "https://rempireshop.com/et/blogs/news/some-article"],
      ["/shop2/c/hair/", "https://rempireshop.com/shop2/c/hair/"],
      ["/test", "https://rempireshop.com/test"],
    ]) {
      expect(await resolve(DIM + from), from).toEqual({ to, status: 301 });
    }
    expect((await resolve("https://www.rempireshop.diipsolutions.eu/pages/contact"))?.to).toBe("https://rempireshop.com/pages/contact");
  });

  it("leaves the handover page, the panel, the API and every file alone", async () => {
    for (const path of [
      "/handover", "/admin", "/admin?order=R-1001", "/admin/scan", "/shop2/admin/", "/api/golive/", "/api/admin/session/",
      "/api/shipping/notify/", "/api/payments/notify/", "/_next/static/chunks/x.js", "/shop2/app.js",
      "/shop2/admin.webmanifest", "/shop2/admin-sw.js", "/golive/index.html", "/icon.svg", "/robots.txt",
    ]) {
      expect(await resolve(DIM + path), path).toBeNull();
    }
  });

  it("does nothing on the shop's own domain", async () => {
    for (const path of ["/", "/collections/hair-care", "/handover", "/test"]) {
      expect(await resolve("https://rempireshop.com" + path), path).toBeNull();
    }
  });
});
