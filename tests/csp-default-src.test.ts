import { describe, expect, it } from "vitest";

/**
 * The Content-Security-Policy a request to the shop's home page and to the
 * panel gets — moved here from e2e/security.spec.ts (03.11.2026), which asked
 * a running `next dev` for the same two headers. next.config.ts headers() is
 * where both come from, so reading the rules is the same check without a
 * browser or a server.
 *
 * tests/security-product-page.test.ts covers script-src, style-src, framing
 * and the 'unsafe-inline' list rule by rule; what it did not pin is the
 * fallback itself: `default-src 'self'` on every policy, so that a directive
 * nobody wrote (worker-src, manifest-src…) still falls back to our own origin.
 */

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values];
    }),
  );
}

describe("Content-Security-Policy", () => {
  it("every policy falls back to 'self' and nothing else", async () => {
    const { default: nextConfig } = await import("../next.config");
    const rules = await nextConfig.headers!();
    const policies = rules
      .map((r) => ({ source: r.source, csp: r.headers.find((h) => h.key === "Content-Security-Policy")?.value }))
      .filter((r): r is { source: string; csp: string } => !!r.csp);
    expect(policies.length).toBeGreaterThan(3);
    for (const { source, csp } of policies) expect(directives(csp)["default-src"], source).toEqual(["'self'"]);
  });

  /* The policy a request actually gets, not a rule looked up by name: Next
     applies every rule whose `source` matches and the later one wins a key —
     the same matcher as the Permissions-Policy test next door. */
  it("the home page and the panel get it, and the panel's scripts are files from 'self' only", async () => {
    const { default: nextConfig } = await import("../next.config");
    const rules = (await nextConfig.headers!()).filter((r) => !("missing" in r) && !("has" in r));
    const matches = (source: string, pathname: string) =>
      new RegExp("^" + source.replace(/:[A-Za-z]+\*/g, ".*").replace(/:[A-Za-z]+\(([^)]*)\)/g, "($1)").replace(/:[A-Za-z]+/g, "[^/]+") + "$").test(pathname);
    const policyFor = (pathname: string) =>
      rules
        .filter((r) => matches(r.source, pathname))
        .map((r) => r.headers.find((h) => h.key === "Content-Security-Policy")?.value)
        .filter((v): v is string => !!v)
        .pop() ?? "";

    for (const path of ["/", "/ru", "/et/", "/admin", "/admin/"]) {
      const d = directives(policyFor(path));
      expect(d["default-src"], path).toEqual(["'self'"]);
      expect(d["script-src"], path).toContain("'self'");
      expect(d["script-src"], path).not.toContain("'unsafe-inline'");
    }
  });
});
