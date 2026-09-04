/**
 * The assistant's action whitelist — the only door between what the model
 * writes and what the shop does. No database and no network: these are pure
 * functions over a JSON blob.
 */
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { briefHero, sanitizeAction, sanitizeHero } from "@/app/api/assistant/actions";

const known = new Set((catalogueMin as Array<{ id: string }>).map((p) => p.id));
const someId = (catalogueMin as Array<{ id: string }>)[0].id;

const goodSlide = {
  id: "s1",
  eyebrow: { RU: "Только сейчас", ET: "Ainult praegu", EN: "Right now" },
  title: { RU: "−20 % на бороду", ET: "−20 % habemele", EN: "−20 % on beard care" },
  sub: { RU: "Масла и бальзамы — до конца месяца.", ET: "Õlid ja palsamid — kuu lõpuni.", EN: "Oils and balms — until month end." },
  cta: { RU: "Смотреть", ET: "Vaata", EN: "Shop now" },
  go: "cat:beard",
  image: someId,
  on: true,
};

describe("set_hero", () => {
  it("accepts a well-formed banner and hands it back whole", () => {
    const out = sanitizeAction({ type: "set_hero", value: { slides: [goodSlide], interval: 6000 } }, known, true) as {
      type: string;
      value: { slides: Array<Record<string, unknown>>; interval: number };
    };
    expect(out).toBeTruthy();
    expect(out.type).toBe("set_hero");
    expect(out.value.interval).toBe(6000);
    expect(out.value.slides).toHaveLength(1);
    expect(out.value.slides[0]).toEqual(goodSlide);
  });

  it("accepts value:null — «вернуть стандартный баннер»", () => {
    expect(sanitizeAction({ type: "set_hero", value: null }, known, true)).toEqual({ type: "set_hero", value: null });
  });

  it("keeps at most five slides", () => {
    const many = { slides: Array.from({ length: 9 }, (_, i) => ({ ...goodSlide, id: `s${i + 1}` })) };
    const out = sanitizeHero(many, known) as { slides: unknown[] };
    expect(out.slides).toHaveLength(5);
  });

  it("trims oversize text instead of letting it into the layout", () => {
    const out = sanitizeHero(
      { slides: [{ ...goodSlide, title: { RU: "я".repeat(300) }, sub: { RU: "б".repeat(300) }, cta: { RU: "в".repeat(300) }, eyebrow: { RU: "г".repeat(300) } }] },
      known,
    ) as { slides: Array<{ title: { RU: string }; sub: { RU: string }; cta: { RU: string }; eyebrow: { RU: string } }> };
    const s = out.slides[0];
    expect(s.title.RU).toHaveLength(40);
    expect(s.sub.RU).toHaveLength(90);
    expect(s.cta.RU).toHaveLength(24);
    expect(s.eyebrow.RU).toHaveLength(40);
  });

  it("refuses an unknown link target and falls back to the whole catalogue", () => {
    const out = sanitizeHero({ slides: [{ ...goodSlide, go: "cat:sunglasses" }] }, known) as { slides: Array<{ go: string }> };
    expect(out.slides[0].go).toBe("cat:all");

    const evil = sanitizeHero({ slides: [{ ...goodSlide, go: "page:/etc/passwd" }] }, known) as { slides: Array<{ go: string }> };
    expect(evil.slides[0].go).toBe("cat:all");

    const ghost = sanitizeHero({ slides: [{ ...goodSlide, go: "product:no-such-product" }] }, known) as { slides: Array<{ go: string }> };
    expect(ghost.slides[0].go).toBe("cat:all");

    const real = sanitizeHero({ slides: [{ ...goodSlide, go: `product:${someId}` }] }, known) as { slides: Array<{ go: string }> };
    expect(real.slides[0].go).toBe(`product:${someId}`);
  });

  it("only takes a known product id or an http(s) / /shop/ picture", () => {
    const pick = (image: unknown) =>
      (sanitizeHero({ slides: [{ ...goodSlide, image }] }, known) as { slides: Array<{ image: string }> }).slides[0].image;

    expect(pick(someId)).toBe(someId);
    expect(pick("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(pick("/shop/img/handmade-soap-666-0.webp")).toBe("/shop/img/handmade-soap-666-0.webp");
    expect(pick("javascript:alert(1)")).toBe("");
    expect(pick("/api/admin/settings/")).toBe("");
    expect(pick(`https://cdn.example.com/${"a".repeat(400)}.jpg`)).toBe("");
    expect(pick({ nested: true })).toBe("");
  });

  it("drops unknown keys and slides with no title at all", () => {
    const out = sanitizeHero(
      { slides: [{ ...goodSlide, script: "<img onerror=1>", nope: 1 }, { ...goodSlide, id: "s2", title: {} }], interval: 6000, extra: "x" },
      known,
    ) as Record<string, unknown> & { slides: Array<Record<string, unknown>> };
    expect(Object.keys(out).sort()).toEqual(["interval", "slides"]);
    expect(out.slides).toHaveLength(1);
    expect(Object.keys(out.slides[0]).sort()).toEqual(["cta", "eyebrow", "go", "id", "image", "on", "sub", "title"]);
  });

  it("clamps the interval and coerces `on`", () => {
    const fast = sanitizeHero({ slides: [goodSlide], interval: 5 }, known) as { interval: number };
    expect(fast.interval).toBe(2000);
    const slow = sanitizeHero({ slides: [goodSlide], interval: 9_000_000 }, known) as { interval: number };
    expect(slow.interval).toBe(30_000);
    const noTick = sanitizeHero({ slides: [goodSlide] }, known) as { interval: number };
    expect(noTick.interval).toBe(6000);
    const off = sanitizeHero({ slides: [{ ...goodSlide, on: false }] }, known) as { slides: Array<{ on: boolean }> };
    expect(off.slides[0].on).toBe(false);
    const truthy = sanitizeHero({ slides: [{ ...goodSlide, on: "yes" }] }, known) as { slides: Array<{ on: boolean }> };
    expect(truthy.slides[0].on).toBe(true);
  });

  it("rejects a banner that is not a banner", () => {
    for (const value of [{}, { slides: [] }, { slides: "nope" }, [goodSlide], "hero", 42]) {
      expect(sanitizeAction({ type: "set_hero", value }, known, true)).toBeNull();
    }
  });

  it("is admin-only — a shopper cannot rewrite the banner", () => {
    expect(sanitizeAction({ type: "set_hero", value: { slides: [goodSlide] } }, known, false)).toBeNull();
  });
});

describe("the rest of the whitelist still holds", () => {
  it("keeps the existing admin actions and drops unknown ones", () => {
    expect(sanitizeAction({ type: "toggle_bundles", value: false }, known, true)).toEqual({ type: "toggle_bundles", value: false });
    expect(sanitizeAction({ type: "set_price", id: someId, value: 9 }, known, true)).toEqual({ type: "set_price", id: someId, value: 9 });
    expect(sanitizeAction({ type: "set_price", id: someId, value: 9999 }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "drop_database" }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "set_price", id: someId, value: 9 }, known, false)).toBeNull();
  });
});

describe("draft_post", () => {
  const goodPost = {
    title: { RU: "Как ухаживать за бородой зимой", ET: "Kuidas hooldada habet talvel", EN: "Beard care in winter" },
    excerpt: { RU: "Три привычки на холодный сезон.", ET: "Kolm harjumust külmaks hooajaks.", EN: "Three habits for the cold season." },
    body: { RU: "# Зима\n\nМасло **каждый день**.", ET: "# Talv\n\nÕli **iga päev**.", EN: "# Winter\n\nOil **every day**." },
    tags: ["борода", "зима"],
    products: [someId],
  };

  it("accepts a well-formed draft and rebuilds it field by field", () => {
    const out = sanitizeAction({ type: "draft_post", ...goodPost }, known, true) as {
      type: string; title: Record<string, string>; tags: string[]; products: string[];
    };
    expect(out).toBeTruthy();
    expect(out.type).toBe("draft_post");
    expect(out.title).toEqual(goodPost.title);
    expect(out.tags).toEqual(["борода", "зима"]);
    expect(out.products).toEqual([someId]);
  });

  it("requires at least a Russian title", () => {
    expect(sanitizeAction({ type: "draft_post", ...goodPost, title: { ET: "Ainult eesti keeles" } }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "draft_post", ...goodPost, title: {} }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "draft_post", ...goodPost, title: null }, known, true)).toBeNull();
  });

  it("drops a product id the catalogue does not have", () => {
    const out = sanitizeAction(
      { type: "draft_post", ...goodPost, products: [someId, "not-a-real-product"] },
      known,
      true,
    ) as { products: string[] };
    expect(out.products).toEqual([someId]);
  });

  it("caps the body length per language, tighter than a human editor's own limit", () => {
    const out = sanitizeAction(
      { type: "draft_post", ...goodPost, body: { RU: "я".repeat(9000) } },
      known,
      true,
    ) as { body: Record<string, string> };
    expect(out.body.RU).toHaveLength(6000);
  });

  it("carries the Google title and description per language, capped at what a post stores, and has no seo key when the model sent none", () => {
    const seo = {
      title: { RU: "Уход за бородой зимой: три привычки", ET: "Habeme talvine hooldus", EN: "T".repeat(100) },
      description: { RU: "Мороз сушит бороду.", ET: "   ", EN: "D".repeat(300) },
    };
    const out = sanitizeAction({ type: "draft_post", ...goodPost, seo }, known, true) as {
      seo: { title: Record<string, string>; description: Record<string, string> };
    };
    expect(out.seo.title.RU).toBe("Уход за бородой зимой: три привычки");
    expect(out.seo.title.ET).toBe("Habeme talvine hooldus");
    expect(out.seo.title.EN).toHaveLength(70);
    expect(out.seo.description.RU).toBe("Мороз сушит бороду.");
    expect(out.seo.description.EN).toHaveLength(170);
    expect(out.seo.description).not.toHaveProperty("ET");   // blank is not a value

    expect(sanitizeAction({ type: "draft_post", ...goodPost }, known, true)).not.toHaveProperty("seo");
    expect(sanitizeAction({ type: "draft_post", ...goodPost, seo: { title: { RU: "  " } } }, known, true)).not.toHaveProperty("seo");
    expect(sanitizeAction({ type: "draft_post", ...goodPost, seo: "not an object" }, known, true)).not.toHaveProperty("seo");
    expect(sanitizeAction({ type: "draft_post", ...goodPost, seo: { title: ["a", "b"] } }, known, true)).not.toHaveProperty("seo");
  });

  it("is admin-only", () => {
    expect(sanitizeAction({ type: "draft_post", ...goodPost }, known, false)).toBeNull();
  });
});

describe("publish_post", () => {
  it("accepts a slug and a publish flag", () => {
    expect(sanitizeAction({ type: "publish_post", slug: "beard-care-winter", publish: true }, known, true))
      .toEqual({ type: "publish_post", slug: "beard-care-winter", publish: true });
    expect(sanitizeAction({ type: "publish_post", slug: "beard-care-winter", publish: false }, known, true))
      .toEqual({ type: "publish_post", slug: "beard-care-winter", publish: false });
  });

  it("lower-cases the slug and rejects one that could not have come from slugify()", () => {
    expect(sanitizeAction({ type: "publish_post", slug: "Beard-Care-Winter", publish: true }, known, true))
      .toEqual({ type: "publish_post", slug: "beard-care-winter", publish: true });
    for (const slug of ["../etc/passwd", "beard care winter", "beard_care", "", "a".repeat(81)]) {
      expect(sanitizeAction({ type: "publish_post", slug, publish: true }, known, true)).toBeNull();
    }
  });

  it("requires a boolean publish flag", () => {
    expect(sanitizeAction({ type: "publish_post", slug: "beard-care-winter" }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "publish_post", slug: "beard-care-winter", publish: "true" }, known, true)).toBeNull();
  });

  it("is admin-only", () => {
    expect(sanitizeAction({ type: "publish_post", slug: "beard-care-winter", publish: true }, known, false)).toBeNull();
  });
});

describe("the banner handed to the model", () => {
  it("trims it and strips anything that could read as prompt structure", () => {
    const out = briefHero([
      { id: "s1", title: "Скидка\n\nна бороду ```", go: "cat:beard", image: someId, on: true },
      { title: "x".repeat(500), on: false },
      ...Array.from({ length: 9 }, () => ({ title: "spam" })),
    ]);
    expect(out).toHaveLength(5);
    expect(out[0].title).toBe("Скидка на бороду");
    expect(out[1].id).toBe("s2");
    expect(out[1].title).toHaveLength(60);
    expect(out[1].on).toBe(false);
    expect(briefHero("nonsense")).toEqual([]);
  });
});

// inventory: stock_adjust and stock_set — real numbers, not the демо в наличии/мало/нет badge
describe("stock_adjust", () => {
  it("accepts a relative move on a known product", () => {
    const out = sanitizeAction(
      { type: "stock_adjust", product_id: someId, delta: 6, reason: "goods_in" },
      known,
      true,
    );
    expect(out).toEqual({ type: "stock_adjust", product_id: someId, variant: "", delta: 6, reason: "goods_in" });
  });

  it("defaults an unnamed or invalid reason to 'adjust'", () => {
    const noReason = sanitizeAction({ type: "stock_adjust", product_id: someId, delta: -2 }, known, true);
    expect(noReason).toMatchObject({ reason: "adjust" });
    // 'sale_web'/'sale_pos' are written by a real sale, never claimed from chat
    const fakeSale = sanitizeAction(
      { type: "stock_adjust", product_id: someId, delta: -2, reason: "sale_pos" },
      known,
      true,
    );
    expect(fakeSale).toMatchObject({ reason: "adjust" });
  });

  it("carries a variant through when given one", () => {
    const out = sanitizeAction(
      { type: "stock_adjust", product_id: someId, variant: "75 мл", delta: 1, reason: "return" },
      known,
      true,
    );
    expect(out).toMatchObject({ variant: "75 мл", reason: "return" });
  });

  it("refuses an unknown product, a zero delta, and a delta that is not a number", () => {
    expect(sanitizeAction({ type: "stock_adjust", product_id: "ghost", delta: 1 }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "stock_adjust", product_id: someId, delta: 0 }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "stock_adjust", product_id: someId, delta: "six" }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "stock_adjust", product_id: someId, delta: 50_000 }, known, true)).toBeNull();
  });

  it("is admin-only", () => {
    expect(sanitizeAction({ type: "stock_adjust", product_id: someId, delta: 1 }, known, false)).toBeNull();
  });
});

describe("stock_set", () => {
  it("accepts an absolute count on a known product", () => {
    const out = sanitizeAction({ type: "stock_set", product_id: someId, qty: 10 }, known, true);
    expect(out).toEqual({ type: "stock_set", product_id: someId, variant: "", qty: 10 });
  });

  it("refuses a negative or out-of-range quantity", () => {
    expect(sanitizeAction({ type: "stock_set", product_id: someId, qty: -1 }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "stock_set", product_id: someId, qty: 1_000_000 }, known, true)).toBeNull();
  });

  it("refuses an unknown product and is admin-only", () => {
    expect(sanitizeAction({ type: "stock_set", product_id: "ghost", qty: 1 }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "stock_set", product_id: someId, qty: 1 }, known, false)).toBeNull();
  });
});
