/**
 * robots.txt — tools/lib/robots-policy.mjs, which the prerender writes.
 *
 * Production names the AI search, assistant and training crawlers (Dim,
 * 09.10.2026: open, training included) in a group of their own. The trap in
 * that: a crawler obeys ONLY the most specific group that names it, so a
 * group with a bare `Allow: /` would hand them the basket, the checkout and
 * /api/ that `*` keeps closed. So this reads the files the way a crawler does
 * (RFC 9309: the group naming the bot, else `*`; the longest matching rule
 * wins, Allow on a tie) and wants every AI bot to get exactly what `*` gets.
 * The `*` group itself must not move a byte, and staging stays shut to all.
 */
import { describe, expect, it } from "vitest";
import { AI_BOTS, ALLOW_API, NO_INDEX_PATHS, robotsProduction, robotsStaging } from "../tools/lib/robots-policy.mjs";

const SITEMAP = "https://rempireshop.com/sitemap.xml";
const PROD = robotsProduction(SITEMAP);
const STAGING = robotsStaging("https://rempireshop.diipsolutions.eu/sitemap.xml");

type Rule = { allow: boolean; path: string };
/** The rules one user-agent obeys: the groups that name it, or — when none does — the `*` groups. */
function rulesFor(txt: string, ua: string): Rule[] {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  for (const raw of txt.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && cur) {
      cur.rules.push({ allow: key === "allow", path: val });
    }
  }
  const own = groups.filter((g) => g.agents.includes(ua.toLowerCase()));
  return (own.length ? own : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
}
/** May `ua` fetch `path`? */
function allowed(txt: string, ua: string, path: string): boolean {
  let best: Rule | null = null;
  for (const r of rulesFor(txt, ua)) {
    if (!r.path || !path.startsWith(r.path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

const PATHS = [
  "/", "/ru", "/et/collections/habemehooldus", "/products/night-rider", "/blogs/news/x", "/llms.txt", "/sitemap.xml",
  "/api/overrides/", "/api/blog/x", "/api/shipping/carriers/", "/api/admin/settings", "/api/payments/create",
  "/checkout", "/checkout/done", "/cart", "/ru/cart", "/et/account", "/search?q=x", "/admin", "/admin/scan", "/golive", "/handover",
];

describe("production", () => {
  it("names every AI crawler the owner opened the shop to", () => {
    expect(AI_BOTS).toEqual(["OAI-SearchBot", "ChatGPT-User", "GPTBot", "PerplexityBot", "Perplexity-User",
      "ClaudeBot", "Claude-SearchBot", "Claude-User", "Google-Extended", "Applebot-Extended"]);
    for (const bot of AI_BOTS) expect(PROD).toContain("User-agent: " + bot + "\n");
    // Bingbot is a general crawler and stays under `*`
    expect(PROD).not.toMatch(/User-agent: bingbot/i);
  });

  it("gives every AI crawler exactly the rules `*` has — not a bare Allow: /", () => {
    const star = rulesFor(PROD, "SomeOtherBot");
    expect(star.length).toBe(1 + ALLOW_API.length + NO_INDEX_PATHS.length);
    for (const bot of AI_BOTS) {
      expect(rulesFor(PROD, bot), bot).toEqual(star);
      for (const p of PATHS) expect(allowed(PROD, bot, p), `${bot} ${p}`).toBe(allowed(PROD, "Googlebot", p));
    }
    expect(allowed(PROD, "GPTBot", "/products/night-rider")).toBe(true);
    expect(allowed(PROD, "ClaudeBot", "/api/overrides/")).toBe(true);
    expect(allowed(PROD, "ClaudeBot", "/checkout")).toBe(false);
    expect(allowed(PROD, "OAI-SearchBot", "/api/admin/settings")).toBe(false);
    expect(allowed(PROD, "PerplexityBot", "/ru/cart")).toBe(false);
  });

  it("keeps the `*` group exactly as it was", () => {
    const star = PROD.slice(PROD.indexOf("User-agent: *"), PROD.indexOf("\n# --- AI search"));
    expect(star).toBe(
      "User-agent: *\nAllow: /\n" +
      "Allow: /api/overrides/\nAllow: /api/bundles/\nAllow: /api/blog/\nAllow: /api/reviews/\nAllow: /api/shipping/carriers/\n" +
      "\n# Nothing behind a cart, a payment form or a login belongs in an index.\n" +
      "Disallow: /admin\nDisallow: /checkout\nDisallow: /cart\nDisallow: /account\nDisallow: /search\n" +
      "Disallow: /ru/checkout\nDisallow: /ru/cart\nDisallow: /ru/account\nDisallow: /ru/search\n" +
      "Disallow: /et/checkout\nDisallow: /et/cart\nDisallow: /et/account\nDisallow: /et/search\n" +
      "Disallow: /api/\nDisallow: /test\nDisallow: /guide\nDisallow: /golive\nDisallow: /handover\n",
    );
    expect(PROD.trimEnd().endsWith("Sitemap: " + SITEMAP)).toBe(true);
  });
});

describe("staging", () => {
  it("stays shut to every crawler, AI ones included, and names none of them", () => {
    for (const bot of [...AI_BOTS, "Googlebot", "bingbot"]) {
      expect(allowed(STAGING, bot, "/"), bot).toBe(false);
      expect(allowed(STAGING, bot, "/products/night-rider"), bot).toBe(false);
      expect(STAGING).not.toContain("User-agent: " + bot + "\n");
    }
    // the link-preview scrapers still get a card
    expect(allowed(STAGING, "facebookexternalhit", "/products/night-rider")).toBe(true);
  });
});
