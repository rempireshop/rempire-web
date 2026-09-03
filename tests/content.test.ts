/**
 * `settings.content` — the shop's own details.
 *
 * Three things are worth a test here, in this order of how badly they bite:
 * the sanitiser (it is the only door between a prompt-injected assistant
 * action and text on every page), the merge (a half-written row must never
 * erase the company name), and the placeholder resolution that keeps the legal
 * pages from freezing a company identity again.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import {
  DEFAULT_CONTENT,
  briefContent,
  mergeContent,
  pickLang,
  resolvePlaceholders,
  sanitizeContentPatch,
  sanitizeHours,
} from "@/lib/content";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";

/* ---------- sanitiser --------------------------------------------------- */

describe("sanitizeContentPatch", () => {
  it("keeps a well-formed company patch and nothing else", () => {
    const out = sanitizeContentPatch({
      company: { legalName: "Rempire Store OÜ", regCode: "12216136", vatNumber: "ee102723858", phone: "+372 5623 7237" },
    });
    expect(out).toEqual({
      company: {
        legalName: "Rempire Store OÜ",
        regCode: "12216136",
        vatNumber: "EE102723858",
        phone: "+372 5623 7237",
      },
    });
  });

  it("is a patch, not a document — untouched keys stay absent", () => {
    const out = sanitizeContentPatch({ company: { phone: "+372 5555 1234" } });
    expect(Object.keys(out!)).toEqual(["company"]);
    expect(Object.keys(out!.company!)).toEqual(["phone"]);
  });

  it("drops values that are not what they claim to be", () => {
    const out = sanitizeContentPatch({
      company: {
        regCode: "not-a-number",
        vatNumber: "12345",
        email: "not an address",
        phone: "call me",
        iban: "nope",
      },
      social: { instagram: "javascript:alert(1)", facebook: "ftp://example.com/x", tiktok: "example.com" },
    });
    expect(out!.company).toEqual({ regCode: "", vatNumber: "", email: "", phone: "", iban: "" });
    expect(out!.social).toEqual({ instagram: "", facebook: "", tiktok: "" });
  });

  it("never lets the company name be blanked out", () => {
    const out = sanitizeContentPatch({ company: { legalName: "   ", address: "" } });
    expect(out!.company).toEqual({ address: "" });
  });

  it("strips markup out of the prose fields", () => {
    const out = sanitizeContentPatch({
      contactPage: { RU: "Звоните <script>alert(1)</script> нам" },
    });
    expect(out!.contactPage!.RU).not.toContain("<");
    expect(out!.contactPage!.RU).not.toContain(">");
    expect(out!.contactPage!.RU).toContain("Звоните");
  });

  it("cuts strings to their field's ceiling", () => {
    const out = sanitizeContentPatch({
      company: { address: "x".repeat(9000) },
      announcement: { text: { RU: "y".repeat(9000) }, short: { RU: "z".repeat(500) } },
      contactPage: { RU: "w".repeat(9000) },
    });
    expect(out!.company!.address!.length).toBe(200);
    expect(out!.announcement!.text!.RU!.length).toBe(300);
    expect(out!.announcement!.short!.RU!.length).toBe(120);
    expect(out!.contactPage!.RU!.length).toBe(1200);
  });

  it("takes only http(s) links for the socials and the announcement", () => {
    const out = sanitizeContentPatch({
      social: { youtube: "https://www.youtube.com/@rempire.official" },
      announcement: { link: "https://rempireshop.com/shop2/c/beard/", on: false },
    });
    expect(out!.social!.youtube).toBe("https://www.youtube.com/@rempire.official");
    expect(out!.announcement!.link).toBe("https://rempireshop.com/shop2/c/beard/");
    expect(out!.announcement!.on).toBe(false);
  });

  it("ignores keys nobody put on the list", () => {
    const out = sanitizeContentPatch({
      company: { legalName: "Rempire Store OÜ", secretToken: "hunter2" },
      chatbot: false,
      legal: { nonsense: { RU: "hi" } },
    });
    expect(out!.company).toEqual({ legalName: "Rempire Store OÜ" });
    expect("chatbot" in out!).toBe(false);
    expect(out!.legal).toBeUndefined();
  });

  it("returns null when there is nothing to change", () => {
    expect(sanitizeContentPatch(null)).toBeNull();
    expect(sanitizeContentPatch("phone: 123")).toBeNull();
    expect(sanitizeContentPatch([{ company: {} }])).toBeNull();
    expect(sanitizeContentPatch({ nothing: "useful" })).toBeNull();
  });
});

describe("sanitizeHours", () => {
  it("accepts a range and normalises the dash", () => {
    expect(sanitizeHours("10:00-19:00")).toBe("10:00–19:00");
    expect(sanitizeHours("10:00 — 19:00")).toBe("10:00–19:00");
    expect(sanitizeHours("09:30–17:45")).toBe("09:30–17:45");
  });
  it("accepts «closed» in the three words an owner would type", () => {
    expect(sanitizeHours("closed")).toBe("closed");
    expect(sanitizeHours("Выходной")).toBe("closed");
    expect(sanitizeHours("suletud")).toBe("closed");
  });
  it("treats an empty value as «not published»", () => {
    expect(sanitizeHours("")).toBe("");
    expect(sanitizeHours(undefined)).toBe("");
  });
  it("refuses anything that is not a clock", () => {
    expect(sanitizeHours("с утра до вечера")).toBe("");
    expect(sanitizeHours("25:00–26:00")).toBe("");
    expect(sanitizeHours("10-19")).toBe("");
    expect(sanitizeHours("10:00")).toBe("");
  });
});

/* ---------- merge ------------------------------------------------------- */

describe("mergeContent", () => {
  it("with nothing stored, hands back the shipping defaults", () => {
    const c = mergeContent(undefined);
    expect(c.company.legalName).toBe("Rempire Store OÜ");
    expect(c.company.regCode).toBe("12216136");
    expect(c.company.email).toBe("info@rempireshop.com");
    expect(c.announcement.on).toBe(true);
    expect(c.legal).toEqual({});
    // opening hours have no source yet — blank, so no hours block renders
    expect(c.hours.mon).toBe("");
  });

  it("lays one patch over the defaults without losing the rest", () => {
    const c = mergeContent({ company: { phone: "+372 5555 1234" } });
    expect(c.company.phone).toBe("+372 5555 1234");
    expect(c.company.legalName).toBe(DEFAULT_CONTENT.company.legalName);
    expect(c.company.address).toBe(DEFAULT_CONTENT.company.address);
  });

  it("keeps the Estonian a later Russian-only patch does not mention", () => {
    const c = mergeContent(
      { announcement: { text: { RU: "Скидка", ET: "Soodustus", EN: "Sale" } } },
      { announcement: { text: { RU: "Новая скидка" } } },
    );
    expect(c.announcement.text).toEqual({ RU: "Новая скидка", ET: "Soodustus", EN: "Sale" });
  });

  it("survives a row that was hand-edited into nonsense", () => {
    const c = mergeContent({ company: "Rempire", hours: 7, announcement: [] });
    expect(c.company.legalName).toBe("Rempire Store OÜ");
    expect(c.announcement.on).toBe(true);
  });

  it("drops a legal override once every language is blank again", () => {
    const withText = mergeContent({ legal: { terms: { RU: "Наши условия" } } });
    expect(withText.legal.terms.RU).toBe("Наши условия");
    const cleared = mergeContent(
      { legal: { terms: { RU: "Наши условия" } } },
      { legal: { terms: { RU: "" } } },
    );
    expect("terms" in cleared.legal).toBe(false);
  });

  it("pickLang falls back to Russian, never to «undefined»", () => {
    const t = { RU: "Привет", ET: "", EN: "Hello" };
    expect(pickLang(t, "ET")).toBe("Привет");
    expect(pickLang(t, "EN")).toBe("Hello");
    expect(pickLang(t, "zz")).toBe("Привет");
    expect(pickLang(undefined, "RU")).toBe("");
  });
});

/* ---------- placeholders ------------------------------------------------ */

describe("legal placeholders", () => {
  it("fills the company identity in", () => {
    const c = mergeContent({ company: { legalName: "Rempire Store OÜ", regCode: "12216136" } });
    const out = resolvePlaceholders(
      "REMPIRE({{legalName}}), registration number {{regCode}}, {{address}}.",
      c,
    );
    expect(out).toBe("REMPIRE(Rempire Store OÜ), registration number 12216136, Mardi 1, 10145 Tallinn.");
  });

  it("leaves a placeholder it does not know exactly as it found it", () => {
    const out = resolvePlaceholders("{{legalName}} · {{something}}", mergeContent(undefined));
    expect(out).toBe("Rempire Store OÜ · {{something}}");
  });

  it("the harvested legal texts no longer name the wrong company", () => {
    for (const f of ["legal.js", "legal.ru.js", "legal.et.js"]) {
      const src = readFileSync(`public/shop/${f}`, "utf8");
      expect(src, f).not.toContain("THEFLOW");
      expect(src, f).not.toContain("16320586");
      expect(src, f).toContain("{{legalName}}");
      expect(src, f).toContain("{{regCode}}");
    }
  });
});

/* ---------- what the assistant may do ----------------------------------- */

describe("set_content", () => {
  it("passes a partial patch through the action whitelist", async () => {
    const { sanitizeAction } = await import("@/app/api/assistant/actions");
    const out = sanitizeAction(
      { type: "set_content", value: { company: { phone: "+372 5555 1234" } } },
      new Set<string>(),
      true,
    );
    expect(out).toEqual({ type: "set_content", value: { company: { phone: "+372 5555 1234" } } });
  });

  it("is admin-only", async () => {
    const { sanitizeAction } = await import("@/app/api/assistant/actions");
    expect(
      sanitizeAction({ type: "set_content", value: { company: { phone: "+372 1" } } }, new Set<string>(), false),
    ).toBeNull();
  });

  it("drops an action whose every field is rubbish", async () => {
    const { sanitizeAction } = await import("@/app/api/assistant/actions");
    expect(sanitizeAction({ type: "set_content", value: { chatbot: false } }, new Set<string>(), true)).toBeNull();
  });

  it("briefContent trims what goes into the prompt", () => {
    const brief = briefContent(
      mergeContent({ company: { legalName: "A`quote\nand a newline" }, hours: { mon: "10:00-19:00" } }),
    );
    expect(brief).not.toContain("`");
    expect(brief).not.toContain("A`quote\n");
    expect(brief).toContain("mon 10:00–19:00");
  });
});

/* ---------- the public route -------------------------------------------- */

describe("GET /api/overrides carries the content", () => {
  let admin = "";
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });

  it("serves the defaults when nothing is stored", async () => {
    const { GET } = await import("@/app/api/overrides/route");
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.settings.content.company.legalName).toBe("Rempire Store OÜ");
    expect(body.settings.content.company.regCode).toBe("12216136");
    expect(body.settings.content.announcement.on).toBe(true);
  });

  it("serves what the owner wrote, merged over the defaults", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    const { GET } = await import("@/app/api/overrides/route");
    const req = new Request(`${ORIGIN}/api/admin/settings/`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ content: { company: { phone: "+372 5555 1234" }, hours: { mon: "10:00-19:00" } } }),
    });
    expect((await PUT(req)).status).toBe(200);

    const body = await (await GET()).json();
    expect(body.settings.content.company.phone).toBe("+372 5555 1234");
    expect(body.settings.content.hours.mon).toBe("10:00–19:00");
    // untouched fields still come from the defaults, not from nowhere
    expect(body.settings.content.company.legalName).toBe("Rempire Store OÜ");
  });

  it("a garbage row cannot take the company name off the site", async () => {
    const { PUT } = await import("@/app/api/admin/settings/route");
    const { GET } = await import("@/app/api/overrides/route");
    const req = new Request(`${ORIGIN}/api/admin/settings/`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ content: { company: { legalName: "", regCode: "oops" } } }),
    });
    await PUT(req);
    const body = await (await GET()).json();
    expect(body.settings.content.company.legalName).toBe("Rempire Store OÜ");
    expect(body.settings.content.company.regCode).toBe("");
  });
});

/* ---------- the letters ------------------------------------------------- */

describe("letter footer", () => {
  it("prints the owner's company details and his extra line", async () => {
    const { setBrandOverride } = await import("@/emails/layout");
    const { renderOrderConfirmed } = await import("@/emails/order-confirmed");
    const order = {
      number: "R-100042",
      email: "klient@example.com",
      lang: "ru",
      items: [{ id: "x", title: "Товар", qty: 1, price: 10 }],
      total: 10,
    };

    setBrandOverride({
      legal: "Уютный Магазин OÜ",
      address: "Mardi 1, 10145 Tallinn",
      email: "info@rempireshop.com",
      note: { ru: "Салон Rempire, Таллинн" },
    });
    const mine = renderOrderConfirmed(order, "ru");
    expect(mine.html).toContain("Уютный Магазин OÜ");
    expect(mine.html).toContain("mailto:info@rempireshop.com");
    expect(mine.html).toContain("Салон Rempire, Таллинн");
    expect(mine.text).toContain("Салон Rempire, Таллинн");

    // a language the owner left blank gets no extra line rather than a Russian one
    const en = renderOrderConfirmed({ ...order, lang: "en" }, "en");
    expect(en.html).not.toContain("Салон Rempire");

    setBrandOverride(null);
    const plain = renderOrderConfirmed(order, "ru");
    expect(plain.html).toContain("Rempire Store OÜ, Tallinn");
    expect(plain.html).not.toContain("Уютный Магазин");
  });
});
