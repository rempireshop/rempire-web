/**
 * rempireshop.diipsolutions.eu carries Dim's handover page and nothing of the
 * shop (Dim, 03.11.2026): every other page there moves to the same address on
 * rempireshop.com, while /handover, the panel it shares its marks with, the
 * API and every file those pages load stay. And on the shop's own domain the
 * rule does nothing at all. Resolved the way Next resolves next.config.ts's
 * redirects — the same matcher, host test and destination compiler.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

type Rewrite = { source: string; destination: string; has?: never[]; missing?: never[] };

/** Where a `beforeFiles` rewrite — the phase that runs before a file under
    public/ is served — sends a request, or null. */
async function beforeFiles(url: string): Promise<string | null> {
  const u = new URL(url);
  const req = constructRequest({ url, headers: { host: u.host } });
  const rewrites = (await nextConfig.rewrites!()) as { beforeFiles: Rewrite[] };
  for (const r of rewrites.beforeFiles) {
    const params = getPathMatch(r.source, { strict: true, removeUnnamedParams: true, regexModifier: undefined })(u.pathname);
    if (!params) continue;
    if (!(r.has || r.missing ? matchHas(req as never, {}, r.has, r.missing) : {})) continue;
    return r.destination;
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
      ["/golive", "https://rempireshop.com/golive"],
      ["/cards", "https://rempireshop.com/cards"],
    ]) {
      expect(await resolve(DIM + from), from).toEqual({ to, status: 301 });
    }
    expect((await resolve("https://www.rempireshop.diipsolutions.eu/pages/contact"))?.to).toBe("https://rempireshop.com/pages/contact");
  });

  it("leaves the handover page, the panel, the API and every file alone", async () => {
    for (const path of [
      "/handover", "/admin", "/admin?order=R-1001", "/admin/scan", "/shop2/admin/", "/api/golive/", "/api/admin/session/",
      "/api/shipping/notify/", "/api/payments/notify/", "/_next/static/chunks/x.js", "/shop2/app.js",
      "/shop2/admin.webmanifest", "/shop2/admin-sw.js", "/golive/index.html", "/golive/sets-search.html", "/icon.svg", "/robots.txt",
    ]) {
      expect(await resolve(DIM + path), path).toBeNull();
    }
  });

  it("does nothing on the shop's own domain", async () => {
    for (const path of ["/", "/collections/hair-care", "/handover", "/test", "/golive", "/cards", "/card", "/karty"]) {
      expect(await resolve("https://rempireshop.com" + path), path).toBeNull();
    }
  });
});

/* /handover is public/golive/index.html, and a file under public/ answers on
   every host the deployment has — so the file itself is turned away anywhere
   but Dim's address (Dim, 03.11.2026: his pages are not the shop's). */
describe("the go-live file behind /handover", () => {
  it("is handed to the shop's 404 on rempireshop.com and on any other host", async () => {
    for (const origin of ["https://rempireshop.com", "https://www.rempireshop.com", "https://rempire-web.vercel.app"]) {
      /* /golive/ never gets this far: the middleware moves the slash first,
         to /golive */
      for (const path of ["/golive", "/golive/index.html", "/golive/handover.html", "/golive/sets-search.html"]) {
        expect(await beforeFiles(origin + path), origin + path).toBe("/golive-gone");
      }
    }
  });

  it("sends it to an address with nothing on disk, so the 404 is the catch-all's", async () => {
    /* Rewritten to /golive itself, Vercel's file check found public/golive/
       and served its index.html: 200 on rempireshop.com (76c9fb2d). */
    const { beforeFiles: rules } = (await nextConfig.rewrites!()) as { beforeFiles: Rewrite[] };
    for (const r of rules) {
      expect(existsSync(path.join(__dirname, "..", "public", r.destination)), r.destination).toBe(false);
    }
  });

  it("is left to the file on Dim's address, and nothing else is touched", async () => {
    for (const url of [
      "https://rempireshop.diipsolutions.eu/golive/index.html", "https://www.rempireshop.diipsolutions.eu/golive/index.html",
      "https://rempireshop.diipsolutions.eu/golive/sets-search.html",
      "https://rempireshop.diipsolutions.eu/handover", "https://rempireshop.com/handover", "https://rempireshop.com/",
      "https://rempireshop.com/shop2/app.js", "https://rempireshop.com/brand/og-golive.png",
    ]) {
      expect(await beforeFiles(url), url).toBeNull();
    }
  });
});

/* /golive/sets-search.html — Dim's «Наборы в поиске» proposal (07.11.2026), a
   picture of search screens drawn from the live sets. It rides the go-live
   folder's host rule above, so it exists on his address only; and it must stay
   a picture: a working search box there would put test queries into Renat's
   search report. */
describe("the sets-in-search proposal page", () => {
  const doc = readFileSync(path.join(__dirname, "..", "public", "golive", "sets-search.html"), "utf8");

  it("runs nothing and asks for nothing", () => {
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/<(?:input|form|textarea|select|button)\b/i);
  });

  it("stays out of search engines and loads only the shop's pictures and the fonts", () => {
    expect(doc).toContain('<meta name="robots" content="noindex, nofollow">');
    for (const m of doc.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(m[1], m[1]).toMatch(/^(?:\/shop\/img\/|#|https:\/\/fonts\.(?:googleapis|gstatic)\.com)/);
    }
  });
});
