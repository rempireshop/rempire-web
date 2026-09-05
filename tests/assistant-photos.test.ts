/**
 * The assistant's photo actions (add_product_photo, set_post_cover), the
 * attachments brief that gates them, and the short form of draft_post —
 * pure functions over a JSON blob, like tests/assistant-actions.test.ts.
 *
 * The rule that matters: a photo action may name only a key this very
 * conversation uploaded (the panel sends them along, the route hands them
 * to sanitizeAction as `attachedKeys`). A key the model made up — or one it
 * read in some other owner's message — is refused, whatever its shape.
 */
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ATTACHMENTS_MAX, briefAttachments, sanitizeAction, sanitizeDraftTopic } from "@/app/api/assistant/actions";

const known = new Set((catalogueMin as Array<{ id: string }>).map((p) => p.id));
const someId = (catalogueMin as Array<{ id: string }>)[0].id;
const KEY = "products/inbox/1757000000000-img-4321.webp";
const attached = new Set([KEY, "blog/1757000000001-cover.webp"]);

describe("briefAttachments — what the panel says it uploaded", () => {
  it("keeps a well-formed key with a one-line name, defaulting the name", () => {
    expect(briefAttachments([{ key: KEY, name: "IMG_4321.jpg" }, { key: "blog/1-x.png" }])).toEqual([
      { key: KEY, name: "IMG_4321.jpg" },
      { key: "blog/1-x.png", name: "фото" },
    ]);
  });
  it("drops a key outside the prefixes this shop writes, a traversal, a video, a duplicate, and anything that is not an object", () => {
    const out = briefAttachments([
      { key: "giftcards/x.pdf" }, { key: "../products/x.webp" }, { key: "products/a//b.webp" }, { key: "videos/1/x.mp4" },
      { key: "https://evil.example/x.webp" }, { key: KEY }, { key: KEY }, "products/x.webp", null, 42,
    ]);
    expect(out).toEqual([{ key: KEY, name: "фото" }]);
  });
  it("caps the list and strips prompt punctuation from a name", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `products/inbox/${i}-x.webp`, name: `a|b\`c ${i}` }));
    const out = briefAttachments(many);
    expect(out).toHaveLength(ATTACHMENTS_MAX);
    expect(out[0].name).toBe("a b c 0");
  });
  it("is an empty list for anything but an array", () => {
    expect(briefAttachments(undefined)).toEqual([]);
    expect(briefAttachments("products/x.webp")).toEqual([]);
    expect(briefAttachments({ key: KEY })).toEqual([]);
  });
});

describe("add_product_photo", () => {
  it("accepts a known product and an attached key, main defaulting to false", () => {
    expect(sanitizeAction({ type: "add_product_photo", id: someId, key: KEY, main: true }, known, true, { attachedKeys: attached }))
      .toEqual({ type: "add_product_photo", id: someId, key: KEY, main: true });
    expect(sanitizeAction({ type: "add_product_photo", id: someId, key: KEY, main: "yes" }, known, true, { attachedKeys: attached }))
      .toEqual({ type: "add_product_photo", id: someId, key: KEY, main: false });
  });
  it("refuses a key the conversation did not upload — however well-formed", () => {
    expect(sanitizeAction({ type: "add_product_photo", id: someId, key: "products/inbox/9-other.webp" }, known, true, { attachedKeys: attached })).toBeNull();
    expect(sanitizeAction({ type: "add_product_photo", id: someId, key: KEY }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "add_product_photo", id: someId, key: KEY }, known, true, { attachedKeys: new Set() })).toBeNull();
  });
  it("refuses an unknown product, a missing key, and is admin-only", () => {
    expect(sanitizeAction({ type: "add_product_photo", id: "ghost", key: KEY }, known, true, { attachedKeys: attached })).toBeNull();
    expect(sanitizeAction({ type: "add_product_photo", id: someId }, known, true, { attachedKeys: attached })).toBeNull();
    expect(sanitizeAction({ type: "add_product_photo", id: someId, key: KEY }, known, false, { attachedKeys: attached })).toBeNull();
  });
  it("rebuilds the action field by field — nothing rides along", () => {
    const out = sanitizeAction({ type: "add_product_photo", id: someId, key: KEY, main: true, __proto__: { x: 1 }, url: "https://evil" }, known, true, { attachedKeys: attached });
    expect(Object.keys(out as object).sort()).toEqual(["id", "key", "main", "type"]);
  });
});

describe("set_post_cover", () => {
  it("accepts a slug and an attached key", () => {
    expect(sanitizeAction({ type: "set_post_cover", slug: "Uhod-Za-Borodoy", key: "blog/1757000000001-cover.webp" }, known, true, { attachedKeys: attached }))
      .toEqual({ type: "set_post_cover", slug: "uhod-za-borodoy", key: "blog/1757000000001-cover.webp" });
  });
  it("refuses a bad slug, a foreign key, and is admin-only", () => {
    expect(sanitizeAction({ type: "set_post_cover", slug: "../x", key: KEY }, known, true, { attachedKeys: attached })).toBeNull();
    expect(sanitizeAction({ type: "set_post_cover", slug: "post", key: "blog/9-not-mine.webp" }, known, true, { attachedKeys: attached })).toBeNull();
    expect(sanitizeAction({ type: "set_post_cover", slug: "post", key: KEY }, known, false, { attachedKeys: attached })).toBeNull();
  });
});

describe("draft_post — the short form: a topic, the panel writes the rest", () => {
  it("accepts a topic and a language, defaulting the language to Russian", () => {
    expect(sanitizeAction({ type: "draft_post", topic: "Как ухаживать за бородой зимой", lang: "RU" }, known, true))
      .toEqual({ type: "draft_post", topic: "Как ухаживать за бородой зимой", lang: "RU", hint: "" });
    expect(sanitizeAction({ type: "draft_post", topic: "Habemehooldus talvel", lang: "ET", hint: "algajatele" }, known, true))
      .toEqual({ type: "draft_post", topic: "Habemehooldus talvel", lang: "ET", hint: "algajatele" });
    expect(sanitizeAction({ type: "draft_post", topic: "x".repeat(10), lang: "de" }, known, true)).toMatchObject({ lang: "RU" });
  });
  it("one-lines and caps the topic, refuses one that is too short or missing", () => {
    const out = sanitizeDraftTopic({ topic: "  уход\nза   бородой " + "я".repeat(300) });
    expect(out!.topic).not.toContain("\n");
    expect(out!.topic.length).toBeLessThanOrEqual(200);
    expect(sanitizeDraftTopic({ topic: "ab" })).toBeNull();
    expect(sanitizeDraftTopic({})).toBeNull();
    expect(sanitizeAction({ type: "draft_post" }, known, true)).toBeNull();
  });
  it("still takes the old all-in-one shape whole, and prefers it to a topic when both are there", () => {
    const out = sanitizeAction({ type: "draft_post", topic: "x", title: { RU: "Заголовок" }, body: { RU: "Текст" } }, known, true) as Record<string, unknown>;
    expect(out.title).toEqual({ RU: "Заголовок" });
    expect(out).not.toHaveProperty("topic");
  });
});
