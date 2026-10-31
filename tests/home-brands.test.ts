/**
 * «Строка брендов» (31.10.2026): Renat asked to take CBD Daily and Lumin out
 * of the home page's brand row, and nothing in the panel could. What must
 * hold: settings.home_brands keeps names only (src/lib/home-brands.ts), the
 * shop's public feed carries it, the settings route cleans it on the way in,
 * and «Помощник» proposes it only for brands the shop has. The connector's
 * two tools are in tests/mcp-connector.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { cleanHomeBrands, matchBrands, patchHomeBrands } from "@/lib/home-brands";
import { sanitizeAction } from "@/app/api/assistant/actions";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { getSettingRaw } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

describe("the stored row", () => {
  it("keeps one line per name, no repeats whatever the case, and drops anything else", () => {
    expect(cleanHomeBrands({ hidden: [" CBD  Daily ", "cbd daily", 7, "", "Lumin\u0000Skin"] })).toEqual({ hidden: ["CBD Daily", "Lumin Skin"] });
    for (const raw of [null, "CBD Daily", ["CBD Daily"], { hidden: "CBD Daily" }]) expect(cleanHomeBrands(raw)).toEqual({ hidden: [] });
  });

  it("hides and shows by name, without case", () => {
    expect(patchHomeBrands({ hidden: ["CBD Daily"] }, ["Lumin Skin"], ["cbd daily"])).toEqual({ hidden: ["Lumin Skin"] });
    expect(patchHomeBrands({ hidden: [] }, ["Lumin Skin", "lumin skin"], [])).toEqual({ hidden: ["Lumin Skin"] });
  });

  it("matches names to the shop's spelling and says which it does not have", () => {
    expect(matchBrands(["cbd daily", "Nobody"], ["CBD Daily", "Lumin Skin"])).toEqual({ found: ["CBD Daily"], unknown: ["Nobody"] });
    expect(matchBrands("LUMIN SKIN", ["CBD Daily", "Lumin Skin"]).found).toEqual(["Lumin Skin"]);
  });
});

describe("«Помощник»", () => {
  const brands = new Set(["CBD Daily", "Lumin Skin", "Davines"]);
  it("proposes the row's change for brands the shop has, spelt its way", () => {
    expect(sanitizeAction({ type: "set_home_brands", hide: ["cbd daily", "Lumin Skin", "Nobody"] }, new Set(), true, { brands }))
      .toEqual({ type: "set_home_brands", hide: ["CBD Daily", "Lumin Skin"], show: [] });
    expect(sanitizeAction({ type: "set_home_brands", show: "davines" }, new Set(), true, { brands }))
      .toEqual({ type: "set_home_brands", hide: [], show: ["Davines"] });
  });
  it("proposes nothing for unknown brands, and nothing to a shopper", () => {
    expect(sanitizeAction({ type: "set_home_brands", hide: ["Nobody"] }, new Set(), true, { brands })).toBeNull();
    expect(sanitizeAction({ type: "set_home_brands", hide: ["CBD Daily"] }, new Set(), false, { brands })).toBeNull();
  });
});

describe("the settings route and the public feed", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("cleans what the panel sends and publishes it to the shop", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    const res = await PUT(new NextRequest("https://rempireshop.com/api/admin/settings/", {
      method: "PUT",
      headers: { "content-type": "application/json", host: "rempireshop.com", origin: "https://rempireshop.com", cookie: `${ADMIN_COOKIE}=${makeSessionToken()}` },
      body: JSON.stringify({ settings: { home_brands: { hidden: ["CBD Daily", "cbd daily", 42], extra: true } } }),
    }));
    expect(res.status).toBe(200);
    expect((await getSettingRaw("home_brands")).value).toEqual({ hidden: ["CBD Daily"] });

    const { GET } = await import("@/app/api/overrides/route");
    const feed = await (await GET()).json();
    expect(feed.settings.home_brands).toEqual({ hidden: ["CBD Daily"] });
  });
});
