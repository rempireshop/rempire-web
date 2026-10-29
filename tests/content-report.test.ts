/**
 * «Что поправить на сайте» — the weekly letter about the owner's content
 * (src/lib/content-report.ts), Dim's 29.10.2026 plan: a broken site turns a
 * check red and mails him; content that is merely not right goes into one
 * Russian letter a week to the shop's mailbox, with a copy to him.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exec } from "@/lib/db";
import { setupDb, teardownDb } from "./helpers";

const sent: Array<{ to: string | string[]; subject: string; text?: string }> = [];
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string | string[]; subject: string; text?: string }) => {
    sent.push(m);
    return { ok: true };
  },
}));

const MONDAY = Date.UTC(2026, 10, 2, 6, 0); // 02.11.2026, 08:00 in Tallinn
const TUESDAY = Date.UTC(2026, 10, 3, 6, 0);

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(async () => {
  sent.length = 0;
  await exec("truncate product_overrides, custom_products, settings, posts restart identity cascade");
  process.env.RESEND_TO = "shop@example.com";
  delete process.env.DEV_ALERT_TO;
});

describe("contentIssues()", () => {
  it("finds each kind the panel can leave behind — and nothing in a clean shop", async () => {
    const { contentIssues } = await import("@/lib/content-report");
    const { setDescriptionOverride } = await import("@/lib/product-descriptions");
    const { setSeoOverride } = await import("@/lib/product-seo");
    const { upsertOverride } = await import("@/lib/orders");
    const { listBundles } = await import("@/lib/bundles");
    const { upsertPost, publishPost } = await import("@/lib/blog");
    const { createCustomProduct } = await import("@/lib/custom-products");

    const clean = (await contentIssues()).filter((i) => i.kind !== "set_cannot_assemble");
    expect(clean).toEqual([]);

    // texts saved before the panel refused Russian in them (27.10.2026)
    await setDescriptionOverride("handmade-soap-666", { RU: "Мыло.", ET: "Seep. Чёрное мыло 666 — ручная работа.", EN: "Soap." });
    await setSeoOverride("touchable", { ET: { title: "Спрей-воск" } });
    // a set whose parts were hidden (the Yumain line, 28.10.2026)
    const [set] = await listBundles({ activeOnly: true });
    await upsertOverride(set.items[0].productId, { hidden: true });
    // an article published in Russian only
    const post = await upsertPost({ title: { RU: "Как выбрать шампунь", ET: "", EN: "" }, body: { RU: "Текст." } });
    await publishPost(post.id);
    // an own product on sale with no photo
    await createCustomProduct({ brand: "Proraso", name: "Beard Balm — бальзам для бороды", cat: "beard", sizes: [], prices: [14.9] });

    const found = await contentIssues();
    const kinds = (k: string) => found.filter((i) => i.kind === k);
    expect(kinds("desc_language")).toMatchObject([{ id: "handmade-soap-666", detail: "ET" }]);
    expect(kinds("seo_language")).toMatchObject([{ id: "touchable", detail: "ET" }]);
    expect(kinds("set_cannot_assemble").map((i) => i.id)).toContain(set.id);
    expect(kinds("post_untranslated")).toMatchObject([{ name: "Как выбрать шампунь", detail: "ET, EN" }]);
    expect(kinds("own_no_photo")).toHaveLength(1);
  });
});

describe("contentLetter()", () => {
  it("says what and where, in Russian, one block per kind", async () => {
    const { contentLetter } = await import("@/lib/content-report");
    const { subject, text } = contentLetter([
      { kind: "desc_language", id: "x", name: "Rempire Чёрное мыло 666", detail: "ET" },
      { kind: "set_cannot_assemble", id: "tattoo-care", name: "Уход за татуировкой", detail: "Yumain Tattoo cream" },
    ]);
    expect(subject).toBe("REMPIRE — что поправить на сайте: 2");
    expect(text).toContain("Русские слова в эстонском или английском описании");
    expect(text).toContain("— Rempire Чёрное мыло 666 — в эстонском тексте");
    expect(text).toContain("«Уход за татуировкой»: нет — Yumain Tattoo cream. Верните товар или выключите набор.");
    expect(text).not.toContain("Статьи без");
  });
});

describe("runContentReport()", () => {
  it("writes on Monday, once, to the shop and to Dim — and never on another day", async () => {
    const { runContentReport } = await import("@/lib/content-report");
    const { createCustomProduct } = await import("@/lib/custom-products");
    await createCustomProduct({ brand: "B", name: "No Photo", cat: "hair", sizes: [], prices: [10] });

    expect(await runContentReport(TUESDAY)).toMatchObject({ sent: false, reason: "not_monday" });
    expect(sent).toEqual([]);

    expect(await runContentReport(MONDAY)).toMatchObject({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["shop@example.com", "info@diipsolutions.eu"]);
    expect(sent[0].subject).toMatch(/^REMPIRE — что поправить на сайте: \d+$/);

    expect(await runContentReport(MONDAY + 3600_000)).toMatchObject({ sent: false, reason: "already" });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing in a week with nothing to say", async () => {
    const { runContentReport } = await import("@/lib/content-report");
    const { setSetting } = await import("@/lib/orders");
    await setSetting("bundles", false); // no sets to count
    const { listBundles, setBundleActive } = await import("@/lib/bundles");
    for (const b of await listBundles()) await setBundleActive(b.id, false);
    expect(await runContentReport(MONDAY)).toMatchObject({ sent: false, issues: 0, reason: "nothing" });
    expect(sent).toEqual([]);
  });
});
