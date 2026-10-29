/**
 * Russian words left in an Estonian or English text are refused at the
 * panel's own doors — PUT /api/admin/overrides/ (a catalogue product) and
 * PUT /api/admin/products/<id>/ (the owner's own) — as Claude and «Помощник»
 * already refused them (seoOffLanguage(), src/lib/ai-prompts.ts).
 *
 * Renat's translations of 27.10.2026 left «Чёрное мыло 666 — ручная работа.»
 * at the end of the Estonian and English soap texts and «футболка оверсайз»
 * inside the T-shirt's: the panel saved them, the connector would not have.
 * Found by the Renat-proof pass of 29.10.2026 (tools/chaos-build.mjs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { getDescriptionOverride } from "@/lib/product-descriptions";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
let admin = "";
const req = (path: string, body: unknown) => new Request(`${ORIGIN}${path}`, {
  method: "PUT", headers: { cookie: admin, "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});
afterAll(teardownDb);
beforeEach(truncateAll);

describe("PUT /api/admin/overrides/ — a catalogue product", () => {
  const SOAP = "handmade-soap-666"; // «Чёрное мыло 666 — ручная работа»

  it("refuses an Estonian or English description with Russian left in it, and saves nothing", async () => {
    const { PUT } = await import("@/app/api/admin/overrides/route");
    for (const [lang, text] of [["ET", "Käsitööseep. Koostis: vesi. Чёрное мыло 666 — ручная работа."], ["EN", "The Love Is The Gun — футболка оверсайз tee."]] as const) {
      const res = await PUT(req("/api/admin/overrides/", { id: SOAP, description: { RU: "Мыло.", [lang]: text } }));
      expect(res.status, lang).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, error: "wrong_language", detail: lang });
    }
    expect(await getDescriptionOverride(SOAP)).toBeNull();
  });

  it("refuses a Russian Google title on the Estonian page", async () => {
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const res = await PUT(req("/api/admin/overrides/", { id: SOAP, seo: { ET: { title: "Мыло ручной работы" } } }));
    expect(await res.json()).toMatchObject({ error: "wrong_language", detail: "ET" });
  });

  it("lets the product's own name stand as it is spelled, and Russian texts through", async () => {
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const res = await PUT(req("/api/admin/overrides/", {
      id: SOAP,
      description: { RU: "Чёрное мыло 666 — ручная работа.", ET: "Must seep 666: Чёрное мыло 666 on meie oma seep.", EN: "Black soap 666." },
    }));
    expect(res.status).toBe(200);
    expect((await getDescriptionOverride(SOAP))?.ET).toContain("Must seep 666");
  });
});

describe("PUT /api/admin/products/<id>/ — the owner's own product", () => {
  it("refuses the same, before anything is written", async () => {
    const { createCustomProduct, getCustomProduct } = await import("@/lib/custom-products");
    const own = await createCustomProduct({ brand: "Proraso", name: "Beard Balm — бальзам для бороды", cat: "beard", sizes: [], prices: [14.9] });
    const { PUT } = await import("@/app/api/admin/products/[id]/route");
    const res = await PUT(req(`/api/admin/products/${own.id}/`, { description: { ET: "Habemepalsam, бальзам для бороды." } }), {
      params: Promise.resolve({ id: own.id }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "wrong_language", detail: "ET" });
    expect((await getCustomProduct(own.id))?.description?.ET ?? "").toBe("");
  });
});

describe("the panel says why, under the box", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
  it("turns the refusal into the box's own message, in the panel's three languages", () => {
    expect(src).toContain('else if (r && r.body && r.body.error === "wrong_language") {');
    for (const ru of [
      "В эстонском тексте остались русские слова — исправьте их или нажмите «Перевести» ещё раз.",
      "В английском тексте остались русские слова — исправьте их или нажмите «Перевести» ещё раз.",
    ]) expect(src.split(JSON.stringify(ru)).length - 1, ru).toBe(3); // the message, and its ET and EN entries
  });
});
