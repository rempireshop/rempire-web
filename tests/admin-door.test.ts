/**
 * `/admin` opens the panel, and keeps opening it after the footer link goes.
 *
 * The panel lived at `/shop2/admin/`, reached by a link at the bottom of every
 * page in the shop. Dim, 21.09.2026: at the switch that link comes off the
 * storefront — it tells anyone who scrolls down where the panel is — and
 * Renat opens `/admin` instead. Before that, `/admin` was a 404, so taking the
 * link away would simply have locked him out of his own habit. Since the URL
 * move of 08.10.2026 (Shopify's addresses, src/lib/shop-paths.mjs) `/admin`
 * is no longer a door to the panel but the panel's own address.
 *
 * Two things are pinned, and the second is the one that bites later:
 *
 *   1. the door exists and IS the panel;
 *   2. nothing at `/admin` is a redirect. A permanent redirect is cached by the
 *      browser that followed it, so moving the panel afterwards would mean
 *      Renat's phone going to the old address for as long as it remembers —
 *      and his phone is the one device that must not be the last to find out.
 *      Served where it is, there is nothing for the phone to remember.
 *
 * A link nobody has is not a security measure; the password is still the only
 * one. This is about not advertising the address, and about `/admin` being
 * short enough to type that taking the link away is reasonable.
 */
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { legacyTarget } from "@/lib/legacy-redirects";
import { isOwnerRest, parseShopPath, publicPath } from "@/lib/shop-paths.mjs";

type Rule = { source: string; destination: string; permanent: boolean };

async function rules(): Promise<Rule[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Rule[]> }).redirects;
  expect(typeof fn, "next.config.ts no longer declares redirects()").toBe("function");
  return (await fn!.call(nextConfig)) as Rule[];
}

describe("the owner's own door", () => {
  it("/admin leads to the panel", async () => {
    const route = parseShopPath("/admin");
    expect(route, "/admin is no page of the shop — it would 404, as it did before 21.09.2026").toBeTruthy();
    expect(route!.rest).toBe("/admin/");
    expect(isOwnerRest(route!.rest)).toBe(true);
    /* One address in every language: the panel is never prefixed. */
    for (const lang of ["RU", "ET", "EN"]) expect(publicPath(lang, "/admin/")).toBe("/admin");
  });

  it("…served where it is, so the panel can still be moved", async () => {
    /* Neither the config nor the middleware answers /admin with a redirect of
       any kind — so there is nothing for his phone to cache. */
    expect((await rules()).find((r) => r.source === "/admin"), "a redirect is cached in his phone").toBeUndefined();
    expect(legacyTarget("/admin")).toBeNull();
    expect(legacyTarget("/admin", "?order=R-100042")).toBeNull();
  });

  it("the trailing-slash form resolves to the same door", async () => {
    /* `trailingSlash: false` + `skipTrailingSlashRedirect: true`: Next does
       not answer /admin/ with a 308 of its own; src/middleware.ts gives it
       ONE 301 to /admin, query kept. This guards the config options
       themselves: flip either and every slash rule changes meaning. */
    expect((nextConfig as { trailingSlash?: boolean }).trailingSlash).toBe(false);
    expect((nextConfig as { skipTrailingSlashRedirect?: boolean }).skipTrailingSlashRedirect).toBe(true);
    expect(legacyTarget("/admin/")?.path).toBe("/admin");
    expect(legacyTarget("/admin/", "?order=R-100042")?.path).toBe("/admin?order=R-100042");
  });

  it("the old footer link still works until launch day removes it", async () => {
    /* `/shop/admin` was the pre-redesign address and is in the legacy rule
       that carries the screen name through. It is unrelated to the footer
       button, and removing the button must not disturb it. The prototype's
       unprefixed /shop/ was Russian, so its screens land on /ru — except the
       owner's, which has no language. */
    const screens: Array<[string, string]> = [
      ["search", "/ru/search"],
      ["brands", "/ru/collections/brands"],
      ["account", "/ru/account"],
      ["checkout", "/ru/checkout"],
      ["done", "/ru/checkout/done"],
      ["admin", "/admin"],
    ];
    for (const [screen, to] of screens) {
      expect(legacyTarget("/shop/" + screen)?.path, "/shop/" + screen).toBe(to);
      expect(legacyTarget("/shop/" + screen + "/")?.path, "/shop/" + screen + "/").toBe(to);
    }
    /* …and the panel's own previous address, the one on his home screen. */
    expect(legacyTarget("/shop2/admin/")?.path).toBe("/admin");
  });
});
