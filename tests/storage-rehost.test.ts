/**
 * A photo uploaded before the bucket got its own domain is still ours.
 *
 * On 21.09.2026 `R2_PUBLIC_BASE` moved off `pub-….r2.dev` — Cloudflare's own
 * console calls that address rate-limited, uncacheable and not for production
 * — onto `img.rempireshop.com`. The catch is that the base is not only how a
 * URL is BUILT: `keyFromUrl()` reads it backwards, and «Убрать фон» and
 * «Удалить фото» both go through it. Matched against the current base alone,
 * every photo already in the database would have stopped being editable at
 * the instant the variable changed — the picture still on screen, the buttons
 * beside it quietly doing nothing.
 *
 * So the bucket remembers the addresses it has worn. That is what is pinned
 * here, along with the rule that keeps it safe: a URL that is not one of ours
 * is never rewritten, because the owner may paste a picture from anywhere and
 * rewriting a stranger's address would point his letter at our bucket.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keyFromUrl, publicUrl, rehost, storageConfig } from "@/lib/storage";

const OLD = "https://pub-cb5b2acfd95a42a89fe5b418936afeea.r2.dev";
const NEW = "https://img.rempireshop.com";
const KEY = "products/c-rempire-hoodie/1789499755429-renat.png";

const saved = { ...process.env };

beforeEach(() => {
  process.env.R2_ACCOUNT_ID = "acc";
  process.env.R2_ACCESS_KEY_ID = "id";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_BUCKET = "rempire";
  process.env.R2_PUBLIC_BASE = NEW;
  delete process.env.R2_PUBLIC_BASE_OLD;
});
afterEach(() => { process.env = { ...saved }; });

describe("a URL stored under the old address is still recognised", () => {
  it("keyFromUrl() reads both", () => {
    expect(keyFromUrl(`${NEW}/${KEY}`)).toBe(KEY);
    expect(keyFromUrl(`${OLD}/${KEY}`), "an already-uploaded photo stopped being ours").toBe(KEY);
  });

  it("…and new URLs are built on the new one only", () => {
    expect(publicUrl(KEY)).toBe(`${NEW}/${KEY}`);
  });

  it("a query string survives the round trip, as it did before", () => {
    expect(keyFromUrl(`${OLD}/${KEY}?v=2`)).toBe(KEY);
  });

  it("the old base is listed after the current one, never instead of it", () => {
    const cfg = storageConfig();
    expect(cfg?.bases[0]).toBe(NEW);
    expect(cfg?.bases).toContain(OLD);
  });
});

describe("rehost() moves ours and leaves everything else alone", () => {
  it("an old address becomes the new one, key untouched", () => {
    expect(rehost(`${OLD}/${KEY}`)).toBe(`${NEW}/${KEY}`);
  });

  it("a URL already on the new address is returned as it is", () => {
    expect(rehost(`${NEW}/${KEY}`)).toBe(`${NEW}/${KEY}`);
  });

  it("somebody else's picture is NOT rewritten", () => {
    /* The owner pastes images into letters and articles from wherever he
       likes. Pointing one of those at our bucket would break it. */
    for (const u of ["https://cdn.shopify.com/s/files/1/x.jpg", "https://example.com/banner.png", "/shop/img/a.webp", ""]) {
      expect(rehost(u)).toBe(u);
    }
  });

  it("a host that merely STARTS like ours is not ours", () => {
    const evil = `${OLD}.attacker.test/${KEY}`;
    expect(rehost(evil)).toBe(evil);
    expect(keyFromUrl(evil)).toBeNull();
  });
});

describe("the list of past addresses is configurable", () => {
  it("R2_PUBLIC_BASE_OLD replaces the built-in default", () => {
    process.env.R2_PUBLIC_BASE_OLD = "https://one.example, https://two.example/";
    const cfg = storageConfig();
    expect(cfg?.bases).toEqual([NEW, "https://one.example", "https://two.example"]);
    expect(keyFromUrl(`https://two.example/${KEY}`)).toBe(KEY);
    // …and the built-in default is no longer implied once it is set
    expect(keyFromUrl(`${OLD}/${KEY}`)).toBeNull();
  });

  it("the current base is never duplicated into the list", () => {
    process.env.R2_PUBLIC_BASE_OLD = NEW;
    expect(storageConfig()?.bases).toEqual([NEW]);
  });

  it("nothing configured at all means nothing to rewrite", () => {
    delete process.env.R2_BUCKET;
    expect(storageConfig()).toBeNull();
    expect(keyFromUrl(`${OLD}/${KEY}`)).toBeNull();
    expect(rehost(`${OLD}/${KEY}`), "an unconfigured shop must not invent a host").toBe(`${OLD}/${KEY}`);
  });
});
