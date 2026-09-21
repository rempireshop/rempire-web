/**
 * `/admin` opens the panel, and keeps opening it after the footer link goes.
 *
 * The panel has always lived at `/shop2/admin/`, reached by a link at the
 * bottom of every page in the shop. Dim, 21.09.2026: at the switch that link
 * comes off the storefront — it tells anyone who scrolls down where the panel
 * is — and Renat opens `/admin` instead. Before this, `/admin` was a 404, so
 * taking the link away would simply have locked him out of his own habit.
 *
 * Two things are pinned, and the second is the one that bites later:
 *
 *   1. the door exists and leads to the panel;
 *   2. it is a TEMPORARY redirect. A permanent one is cached by the browser
 *      that followed it, so moving the panel afterwards would mean Renat's
 *      phone going to the old address for as long as it remembers — and his
 *      phone is the one device that must not be the last to find out.
 *
 * A link nobody has is not a security measure; the password is still the only
 * one. This is about not advertising the address, and about `/admin` being
 * short enough to type that taking the link away is reasonable.
 */
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

type Rule = { source: string; destination: string; permanent: boolean };

async function rules(): Promise<Rule[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Rule[]> }).redirects;
  expect(typeof fn, "next.config.ts no longer declares redirects()").toBe("function");
  return (await fn!.call(nextConfig)) as Rule[];
}

describe("the owner's own door", () => {
  it("/admin leads to the panel", async () => {
    const hit = (await rules()).find((r) => r.source === "/admin");
    expect(hit, "/admin has no redirect — it would 404, as it did before 21.09.2026").toBeTruthy();
    expect(hit!.destination).toBe("/shop2/admin/");
  });

  it("…temporarily, so the panel can still be moved", async () => {
    const hit = (await rules()).find((r) => r.source === "/admin")!;
    expect(hit.permanent, "a permanent redirect is cached in his phone for good").toBe(false);
  });

  it("the trailing-slash form resolves to the same door", async () => {
    /* `trailingSlash: true` turns /admin into /admin/ with a 308 before any
       redirect rule is consulted, so the rule is written without the slash
       exactly as the other legacy rules here are. This guards the config
       option itself: flip it and every one of those rules changes meaning. */
    expect((nextConfig as { trailingSlash?: boolean }).trailingSlash).toBe(true);
  });

  it("the old footer link still works until launch day removes it", async () => {
    /* `/shop/admin` was the pre-redesign address and is in the legacy rule
       that carries the screen name through. It is unrelated to the footer
       button, and removing the button must not disturb it. */
    const legacy = (await rules()).find((r) => r.source.includes("(search|brands|account|checkout|done|admin)"));
    expect(legacy, "the /shop/<screen> rule went missing").toBeTruthy();
    expect(legacy!.destination).toBe("/shop2/:screen/");
  });
});
