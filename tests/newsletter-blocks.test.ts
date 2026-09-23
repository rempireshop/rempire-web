/**
 * «Рассылка» as blocks — src/lib/newsletter-blocks.ts, the block half of
 * src/emails/newsletter.ts, and the routes that store and preview them.
 *
 * The letter Renat asked for (Aromatic 89, 20.09.2026) is pictures, each
 * clicking through to its own page, with a little text between. What this
 * file pins:
 *   · a picture block goes out as the SAME Outlook-safe banner 7b3969a
 *     settled on — a block <a> round a block <img>, 504 px, border 0 — and its
 *     link lands on the page in the reader's own language;
 *   · a text is escaped text, a button the shell's bulletproof button;
 *   · nothing the panel sends is trusted — javascript:, http pictures, tags in
 *     a text, an unknown block, a thousand blocks;
 *   · a half-translated letter is not sent half in Russian;
 *   · a letter written before blocks renders exactly as it did, and opens in
 *     the new editor as one block that renders exactly the same.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newsletterLinkUrl, renderNewsletter, shopLinkPath, type NewsletterCard } from "@/emails/newsletter";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { exec } from "@/lib/db";
import {
  BLOCKS_MAX,
  blocksComplete,
  blocksProducts,
  cleanBlocks,
  cleanImageSrc,
  cleanLink,
  type NewsBlock,
} from "@/lib/newsletter-blocks";
import {
  cleanNewsletterInput,
  createNewsletter,
  getNewsletter,
  readyLangs,
  sendNewsletterTest,
  updateNewsletter,
} from "@/lib/newsletters";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const BASE = "https://test.rempireshop.com";
const PRODUCT = "system-4-bio-botanical-shampoo";
const IMG = "https://img.rempireshop.com/news/1758600000000-autumn.jpg";
const IMG2 = "https://img.rempireshop.com/news/1758600000001-beard.jpg";

const CARD: NewsletterCard = {
  id: PRODUCT,
  brand: "System 4",
  name: "Bio Botanical Shampoo — шампунь",
  price: 9,
  priceFrom: true,
  img: `/shop/img/${PRODUCT}-0.webp`,
};

const tri = (RU: string, ET = "", EN = "") => ({ RU, ET, EN });

/** The Aromatic 89 shape: banner, a line, banner, a button, a card. */
const AROMATIC: NewsBlock[] = [
  { t: "img", src: IMG, href: `product:${PRODUCT}`, alt: "" },
  { t: "text", style: "h", text: tri("Осенние новинки", "Sügise uudised", "Autumn news") },
  { t: "text", style: "p", text: tri("Привезли уход.\nСмотрите ниже.\n\nВторой абзац.", "Tõime hoolduse.", "We brought care.") },
  { t: "img", src: IMG2, href: "cat:beard", alt: "Борода" },
  { t: "btn", text: tri("В магазин", "Poodi", "To the shop"), href: "home" },
  { t: "product", id: PRODUCT },
];

function letter(blocks: NewsBlock[], lang = "ru", products: NewsletterCard[] = [CARD]) {
  return renderNewsletter({ subject: "Тема", body: "", blocks, products }, lang);
}

/** Every <img …> tag for one picture. */
const imgTags = (html: string, src: string) => html.match(new RegExp(`<img[^>]*${src.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[^>]*>`, "g")) ?? [];
/** The <a …> that directly wraps the picture, if any. */
function anchorAround(html: string, src: string): string {
  const at = html.indexOf(`src="${src}"`);
  if (at < 0) return "";
  const open = html.lastIndexOf("<a ", at);
  const close = html.lastIndexOf("</a>", at);
  const imgOpen = html.lastIndexOf("<img", at);
  return open > close && html.slice(open, imgOpen).trim().endsWith(">") ? html.slice(open, html.indexOf(">", open) + 1) : "";
}

let saved: string | undefined;
beforeAll(() => {
  saved = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = BASE;
});
afterAll(() => {
  if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = saved;
});

/* ---------- the banner ----------------------------------------------------- */

describe("a picture block is the Outlook-safe banner", () => {
  it("wraps the picture in a block link to the chosen page", () => {
    const { html } = letter(AROMATIC);
    const a = anchorAround(html, IMG);
    expect(a, "the banner lost its link").toContain(`href="${BASE}/shop2/p/${PRODUCT}/"`);
    // an inline <a> round a block image draws an underline stripe in Outlook
    expect(a).toContain("display:block");
    expect(a).toContain("text-decoration:none");
  });

  it("draws the picture at the letter's width with the attributes Outlook reads", () => {
    const [tag] = imgTags(letter(AROMATIC).html, IMG);
    expect(tag).toBeTruthy();
    expect(tag).toContain('width="504"'); // Outlook sizes by the attribute, not the CSS
    expect(tag).toContain("max-width:504px");
    expect(tag).toContain("width:100%");
    expect(tag).toContain("height:auto");
    expect(tag).toContain("display:block");
    expect(tag).toContain("border:0");
    expect(tag).toMatch(/alt="[^"]+"/); // images off by default in Outlook: the alt is what shows
  });

  it("sends each reader to the page in their own language", () => {
    expect(anchorAround(letter(AROMATIC, "et").html, IMG)).toContain(`${BASE}/shop2/et/p/${PRODUCT}/`);
    expect(anchorAround(letter(AROMATIC, "en").html, IMG2)).toContain(`${BASE}/shop2/en/c/beard/`);
    expect(anchorAround(letter(AROMATIC, "ru").html, IMG2)).toContain(`${BASE}/shop2/c/beard/`);
  });

  it("leaves a picture with no link a picture", () => {
    const { html } = letter([{ t: "img", src: IMG, href: "", alt: "" }]);
    expect(imgTags(html, IMG)).toHaveLength(1);
    expect(anchorAround(html, IMG)).toBe("");
  });

  it("the plain-text part says where the banner goes, not which file it is", () => {
    const { text } = letter(AROMATIC);
    expect(text).toContain(`${BASE}/shop2/p/${PRODUCT}/`);
    expect(text).toContain(`Борода: ${BASE}/shop2/c/beard/`);
    expect(text).not.toContain(IMG);
  });
});

/* ---------- text, heading, button, card ----------------------------------- */

describe("the other blocks", () => {
  it("a text is paragraphs of escaped text, single newlines kept as line breaks", () => {
    const { html, text } = letter([{ t: "text", style: "p", text: tri('Раз <script>alert(1)</script> & "два"\nтри\n\nчетыре') }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Раз &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;два&quot;<br>три");
    expect(html).toContain(">четыре</p>");
    expect(text).toContain('Раз <script>alert(1)</script> & "два"\nтри');
  });

  it("a heading is the letter's own heading row", () => {
    const { html, text } = letter(AROMATIC);
    expect(html).toMatch(/<h2[^>]*>Осенние новинки<\/h2>/);
    expect(text).toContain("ОСЕННИЕ НОВИНКИ");
  });

  it("a button is the shell's bulletproof button, linked in the reader's language", () => {
    const { html, text } = letter(AROMATIC, "et");
    const btn = /<td[^>]*class="em-btn"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(html);
    expect(btn, "no bulletproof button").toBeTruthy();
    expect(btn![1]).toBe(`${BASE}/shop2/et/`);
    expect(btn![2]).toBe("Poodi");
    expect(html).toMatch(/bgcolor="[^"]+"[^>]*mso-padding-alt/); // Outlook paints the cell, not the <a>
    expect(text).toContain(`Poodi: ${BASE}/shop2/et/`);
  });

  it("a button with no link or no words draws nothing rather than a dead button", () => {
    const html = letter([
      { t: "btn", text: tri("Смотреть"), href: "" },
      { t: "btn", text: tri(""), href: "home" },
    ]).html;
    expect(html).not.toContain('class="em-btn"');
  });

  it("a product block is the usual card, drawn where it stands and not again under the letter", () => {
    const { html } = letter(AROMATIC);
    expect(html.split(`${BASE}/shop/img/${PRODUCT}-0.webp`).length - 1).toBe(1);
    expect(html).toContain("от&nbsp;9&nbsp;€");
    // the card comes after the button, where the owner put it
    expect(html.indexOf(`${BASE}/shop/img/${PRODUCT}-0.webp`)).toBeGreaterThan(html.indexOf("В магазин"));
  });

  it("the inbox preview line is the first words of text, not the subject", () => {
    const { html } = letter(AROMATIC);
    expect(html).toMatch(/Привезли уход\. Смотрите ниже\./);
  });

  it("the order of the blocks is the order of the letter", () => {
    // from the logo down — the hidden preheader at the top quotes the first text
    const html = letter(AROMATIC).html.split("REMPIRE</a>")[1];
    const at = (s: string) => html.indexOf(s);
    expect(at(IMG)).toBeLessThan(at("Осенние новинки"));
    expect(at("Осенние новинки")).toBeLessThan(at("Привезли уход"));
    expect(at("Привезли уход")).toBeLessThan(at(IMG2));
    expect(at(IMG2)).toBeLessThan(at("В магазин"));
  });
});

/* ---------- links ----------------------------------------------------------- */

describe("links", () => {
  it("knows the shop's own places", () => {
    expect(shopLinkPath("home")).toBe("/");
    expect(shopLinkPath("blog")).toBe("/blog/");
    expect(shopLinkPath("gift")).toBe("/gift/");
    expect(shopLinkPath("cat:hair")).toBe("/c/hair/");
    expect(shopLinkPath("brand:kevin-murphy")).toBe("/b/kevin-murphy/");
    expect(shopLinkPath("post:kak-uhazhivat-za-borodoy")).toBe("/blog/kak-uhazhivat-za-borodoy/");
    expect(shopLinkPath(`product:${PRODUCT}`)).toBe(`/p/${PRODUCT}/`);
    for (const bad of ["cat:../x", "product:", "post:A B", "brand:<x>", "javascript:alert(1)", "https://x.ee/"]) {
      expect(shopLinkPath(bad), bad).toBeNull();
    }
  });

  it("keeps an ordinary address and refuses everything that is not http(s)", () => {
    expect(cleanLink("https://aromatic89.ee/uudised")).toBe("https://aromatic89.ee/uudised");
    expect(cleanLink("http://example.com/a?b=1")).toBe("http://example.com/a?b=1");
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:a@b.ee",
      "//evil.example/",
      "/shop2/c/hair/",
      "https://user:pass@evil.example/",
      'https://x.ee/"onmouseover="alert(1)',
      "ftp://x.ee/",
      42,
    ]) {
      expect(cleanLink(bad), String(bad)).toBe("");
    }
    // …and the renderer does not trust the stored value either
    expect(newsletterLinkUrl("javascript:alert(1)", "ru")).toBe("");
  });

  it("takes a picture only from https or from this shop", () => {
    expect(cleanImageSrc(IMG)).toBe(IMG);
    expect(cleanImageSrc("/shop/img/x.webp")).toBe("/shop/img/x.webp");
    for (const bad of ["http://img.example/x.jpg", "data:image/png;base64,AAAA", "javascript:alert(1)", "//evil/x.jpg", "https://x/a b.jpg", "x.jpg", ""]) {
      expect(cleanImageSrc(bad), bad).toBe("");
    }
  });
});

/* ---------- cleaning ---------------------------------------------------------- */

describe("cleanBlocks — nothing the panel sends is trusted", () => {
  it("drops what is not a block and cuts every field to its type", () => {
    const out = cleanBlocks([
      { t: "img", src: "http://insecure.example/x.jpg", href: "home" }, // http picture: gone
      { t: "img", src: IMG, href: "javascript:alert(1)", alt: "  Осень\u0000 " }, // bad link: kept, unlinked
      { t: "script", src: IMG },
      "a string",
      null,
      { t: "text", style: "weird", text: { RU: "Абзац\r\n\r\n\r\n\r\nещё‮", ET: 5, EN: ["x"] } },
      { t: "text", style: "h", text: { RU: "Заголовок\nв две строки" } },
      { t: "btn", text: { RU: "x".repeat(500) }, href: "cat:hair" },
      { t: "product", id: "../../etc/passwd" },
      { t: "product", id: PRODUCT },
      { t: "html", html: { RU: '<p onclick="x">Старое</p><script>alert(1)</script>', ET: "<p><br></p>" } },
    ]);
    expect(out).toEqual([
      { t: "img", src: IMG, href: "", alt: "Осень" },
      { t: "text", style: "p", text: { RU: "Абзац\n\nещё", ET: "", EN: "" } },
      { t: "text", style: "h", text: { RU: "Заголовок в две строки", ET: "", EN: "" } },
      { t: "btn", text: { RU: "x".repeat(60), ET: "", EN: "" }, href: "cat:hair" },
      { t: "product", id: PRODUCT },
      { t: "html", html: { RU: "<p>Старое</p>", ET: "", EN: "" } },
    ]);
  });

  it("keeps half-filled blocks — a draft is saved mid-edit — and caps the list", () => {
    expect(cleanBlocks([{ t: "text", text: {} }, { t: "btn", text: { RU: "Смотреть" } }])).toHaveLength(2);
    const many = Array.from({ length: BLOCKS_MAX + 20 }, () => ({ t: "text", style: "p", text: { RU: "x" } }));
    expect(cleanBlocks(many)).toHaveLength(BLOCKS_MAX);
    expect(cleanBlocks("not a list")).toEqual([]);
  });

  it("never keeps more product cards than the letter can resolve", () => {
    const ids = Array.from({ length: 12 }, (_, i) => ({ t: "product", id: `p${i}` }));
    const out = cleanBlocks([...ids, { t: "product", id: "p0" }]);
    expect(new Set(out.map((b) => (b as { id: string }).id)).size).toBe(8);
    expect(out.filter((b) => (b as { id: string }).id === "p0")).toHaveLength(2); // the same card twice is fine
  });

  it("names the products the cards are resolved for — blocks first, then an old body's markers", () => {
    const blocks = cleanBlocks([
      { t: "html", html: { RU: '<p><a data-product="kevin-murphy-un-tangled-spray"></a></p>' } },
      { t: "product", id: PRODUCT },
    ]);
    expect(blocksProducts(blocks)).toEqual([PRODUCT, "kevin-murphy-un-tangled-spray"]);
  });
});

/* ---------- languages ------------------------------------------------------- */

describe("which languages a block letter can go out in", () => {
  const subject = { RU: "Тема", ET: "Teema", EN: "Subject" };
  const body = { RU: "", ET: "", EN: "" };

  it("pictures and cards are in every language; words have to be written in each", () => {
    expect(readyLangs({ subject, body, blocks: AROMATIC })).toEqual(["RU", "ET", "EN"]);
    const pics: NewsBlock[] = [{ t: "img", src: IMG, href: "home", alt: "" }];
    expect(readyLangs({ subject: { RU: "Тема", ET: "", EN: "Subject" }, body, blocks: pics })).toEqual(["RU", "EN"]);
  });

  it("a text or a button missing in a language keeps that language back — its readers get the Russian whole", () => {
    const half: NewsBlock[] = [
      { t: "img", src: IMG, href: "home", alt: "" },
      { t: "btn", text: tri("В магазин", "Poodi", ""), href: "home" },
    ];
    expect(blocksComplete(half, "EN")).toBe(false);
    expect(readyLangs({ subject, body, blocks: half })).toEqual(["RU", "ET"]);
  });

  it("an empty block list is no letter, whatever the subject says", () => {
    expect(readyLangs({ subject, body, blocks: [] })).toEqual([]);
    expect(readyLangs({ subject, body, blocks: [{ t: "btn", text: tri("x", "x", "x"), href: "" }] })).toEqual([]);
  });
});

/* ---------- the letter written before blocks ------------------------------- */

describe("an old letter", () => {
  const OLD_RU = '<h2>Новинки</h2><p>Привезли <strong>System 4</strong>.</p><figure><a href="/shop2/c/hair/"><img src="/shop/img/x.webp" alt="Фото"></a></figure>' +
    `<p><a data-product="${PRODUCT}"></a></p>`;

  it("renders from its body exactly as before when it has no blocks", () => {
    const a = renderNewsletter({ subject: "S", body: OLD_RU, products: [CARD] }, "ru");
    const b = renderNewsletter({ subject: "S", body: OLD_RU, blocks: null, products: [CARD] }, "ru");
    expect(b.html).toBe(a.html);
    expect(b.text).toBe(a.text);
  });

  it("carried into the new editor as one block, renders the very same letter", () => {
    const old = renderNewsletter({ subject: "S", body: OLD_RU, products: [CARD] }, "ru");
    const asBlock = renderNewsletter({ subject: "S", body: "", blocks: cleanBlocks([{ t: "html", html: { RU: OLD_RU } }]), products: [CARD] }, "ru");
    expect(asBlock.html).toBe(old.html);
    expect(asBlock.text).toBe(old.text);
  });

  it("still opens: a draft stored the old way comes back with its body and no blocks", () => {
    const c = cleanNewsletterInput({ subject: { RU: "S" }, body: { RU: OLD_RU }, products: [PRODUCT] });
    expect(c.blocks).toBeNull();
    expect(c.body.RU).toContain("<h2>Новинки</h2>");
    expect(c.products).toEqual([PRODUCT]);
  });

  it("a block draft ignores any stray body and products the panel sends along", () => {
    const c = cleanNewsletterInput({ subject: { RU: "S" }, body: { RU: OLD_RU }, products: ["other-thing"], blocks: [{ t: "product", id: PRODUCT }] });
    expect(c.body).toEqual({ RU: "", ET: "", EN: "" });
    expect(c.products).toEqual([PRODUCT]);
    expect(c.blocks).toEqual([{ t: "product", id: PRODUCT }]);
  });
});

/* ---------- the database and the routes ----------------------------------- */

describe("block letters through the database and the routes", () => {
  let admin = "";
  const sent: Array<{ to: string[]; subject: string; html: string; text: string }> = [];
  const env: Record<string, string | undefined> = {};
  const KEYS = ["SESSION_SECRET", "ADMIN_PASSWORD_HASH", "RESEND_API_KEY", "MAIL_RETRY_DELAY_MS"];

  beforeAll(async () => {
    for (const k of KEYS) env[k] = process.env[k];
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    process.env.MAIL_RETRY_DELAY_MS = "0";
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(async () => {
    await teardownDb();
    for (const k of KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
  });
  beforeEach(async () => {
    resetRateLimits();
    sent.length = 0;
    process.env.RESEND_API_KEY = "re_test_key";
    await exec("truncate newsletters, newsletter_sends, customers, mail_optouts, admin_audit, mail_sends_daily restart identity cascade");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (init.cookie) headers.cookie = init.cookie;
    return new Request(`${ORIGIN}${path}`, { ...init, headers });
  };
  const draft = { title: "Осень", subject: { RU: "Осенние новинки", ET: "Sügise uudised", EN: "Autumn news" }, blocks: AROMATIC };

  it("stores the blocks, derives the cards from them, and reads them back", async () => {
    const { POST, GET, PATCH } = await import("@/app/api/admin/newsletters/route");
    const created = await (await POST(req("/api/admin/newsletters/", { method: "POST", cookie: admin, body: JSON.stringify(draft) }))).json();
    expect(created.ok).toBe(true);
    expect(created.newsletter.blocks).toEqual(AROMATIC);
    expect(created.newsletter.products).toEqual([PRODUCT]);
    expect(created.newsletter.ready).toEqual(["RU", "ET", "EN"]);

    const list = await (await GET(req("/api/admin/newsletters/", { cookie: admin }))).json();
    expect(list.newsletters[0].blocks, "the list carries whole letters").toBeUndefined();
    expect(list.newsletters[0].productCount).toBe(1);

    const moved = [AROMATIC[3], AROMATIC[0]];
    const edited = await (await PATCH(req("/api/admin/newsletters/", { method: "PATCH", cookie: admin, body: JSON.stringify({ id: created.newsletter.id, ...draft, blocks: moved }) }))).json();
    expect(edited.newsletter.blocks).toEqual(moved);
    expect(edited.newsletter.products).toEqual([]);
    expect((await getNewsletter(created.newsletter.id))!.blocks).toEqual(moved);
  });

  it("an old draft keeps NULL blocks until it is saved as blocks", async () => {
    const old = await createNewsletter({ title: "Старое", subject: { RU: "Тема" }, body: { RU: "<p>Старый текст</p>" } });
    expect(old.blocks).toBeNull();
    expect(old.ready).toEqual(["RU"]);
    const now = await updateNewsletter(old.id, { title: "Старое", subject: { RU: "Тема" }, blocks: [{ t: "html", html: { RU: "<p>Старый текст</p>" } }] });
    expect(now.blocks).toEqual([{ t: "html", html: { RU: "<p>Старый текст</p>", ET: "", EN: "" } }]);
    expect(now.body).toEqual({ RU: "", ET: "", EN: "" });
    expect(now.ready).toEqual(["RU"]);
  });

  it("the live preview renders an unsaved draft in the language asked for, and says which languages are ready", async () => {
    const { POST } = await import("@/app/api/admin/newsletters/preview/route");
    const half = { ...draft, blocks: [...AROMATIC, { t: "text", style: "p", text: { RU: "Только по-русски" } }] };
    const res = await POST(req("/api/admin/newsletters/preview/", { method: "POST", cookie: admin, body: JSON.stringify({ ...half, lang: "ET" }) }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.lang).toBe("ET");
    expect(j.subject).toBe("Sügise uudised");
    expect(j.html).toContain(`${BASE}/shop2/et/p/${PRODUCT}/`);
    expect(j.html).toContain('<base target="_blank">'); // a tap in the preview opens a tab, not the frame
    expect(j.html).toContain("/api/mail/unsubscribe/");
    expect(j.ready).toEqual(["RU"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("the live preview is the owner's: 401 without the cookie, 400 for a body that is not a draft", async () => {
    const { POST } = await import("@/app/api/admin/newsletters/preview/route");
    expect((await POST(req("/api/admin/newsletters/preview/", { method: "POST", body: JSON.stringify(draft) }))).status).toBe(401);
    expect((await POST(req("/api/admin/newsletters/preview/", { method: "POST", cookie: admin, body: "[1]" }))).status).toBe(400);
    expect((await POST(req("/api/admin/newsletters/preview/", { method: "POST", cookie: admin, body: "{nope" }))).status).toBe(400);
  });

  it("the saved letter's own preview and the test letter are the block letter", async () => {
    vi.stubGlobal("fetch", async (_u: unknown, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const n = await createNewsletter(draft);
    const { GET } = await import("@/app/api/admin/newsletters/[id]/preview/route");
    const page = await (await GET(req(`/api/admin/newsletters/${n.id}/preview/?lang=EN`, { cookie: admin }), { params: Promise.resolve({ id: n.id }) })).text();
    expect(page).toContain(IMG);
    expect(page).toContain(`${BASE}/shop2/en/p/${PRODUCT}/`);
    expect(page).toContain("To the shop");

    const { result, lang } = await sendNewsletterTest(n, "renat@example.com", "ET");
    expect(result.ok).toBe(true);
    expect(lang).toBe("ET");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("[test] Sügise uudised");
    expect(anchorAround(sent[0].html, IMG)).toContain(`${BASE}/shop2/et/p/${PRODUCT}/`);
  });

  it("a block letter with nothing in it is refused as empty, one without a subject as such", async () => {
    const empty = await createNewsletter({ subject: { RU: "Тема" }, blocks: [] });
    await expect(sendNewsletterTest(empty, "a@example.com", "RU")).rejects.toMatchObject({ code: "empty_body" });
    const nameless = await createNewsletter({ subject: {}, blocks: [{ t: "img", src: IMG, href: "", alt: "" }] });
    await expect(sendNewsletterTest(nameless, "a@example.com", "RU")).rejects.toMatchObject({ code: "no_subject" });
  });
});
