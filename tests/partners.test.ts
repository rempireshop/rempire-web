/**
 * «+ Партнёр» — POST /api/admin/customers (create-or-promote by e-mail), the
 * tier flips on PATCH, and the welcome letter both of them send.
 *
 * Runs on PGlite like tests/loyalty.test.ts. The letter is proven through the
 * e2e mail sink in src/lib/mail.ts (E2E_BOOTSTRAP=1 + a non-production
 * NODE_ENV — vitest's is "test"): RESEND_API_KEY is empty here, so a send is
 * "captured, then skipped", which is exactly what the panel's toast reads.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { recordLogin } from "@/lib/customers";
import { exec } from "@/lib/db";
import { capturedMail } from "@/lib/mail";
import { approveProCustomer, customerTier, requestProTier, upsertPartner } from "@/lib/loyalty";
import { renderPartnerWelcome } from "@/emails/partner-welcome";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

function adminReq(url: string, opts: { method?: string; body?: unknown; raw?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie !== "") headers.cookie = opts.cookie ?? `${ADMIN_COOKIE}=${makeSessionToken()}`;
  return new Request(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.raw !== undefined ? opts.raw : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function post(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/admin/customers/route");
  return POST(adminReq("https://x/api/admin/customers/", { method: "POST", body, cookie }));
}

/** The letters the sink saw for one address, oldest first. */
function lettersTo(email: string) {
  return capturedMail().filter((m) => m.template === "partner-welcome" && m.to.includes(email));
}

let priorEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  priorEnv = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    E2E_BOOTSTRAP: process.env.E2E_BOOTSTRAP,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  };
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  process.env.E2E_BOOTSTRAP = "1";
  process.env.RESEND_API_KEY = "";
  process.env.PUBLIC_BASE_URL = "https://rempireshop.com";
  await setupDb();
});
afterAll(async () => {
  await teardownDb();
  for (const [k, v] of Object.entries(priorEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  await exec("truncate customers, loyalty_ledger, orders, settings, admin_audit, login_codes restart identity cascade");
  resetRateLimits();
});

/* ---------- the route ------------------------------------------------------- */

describe("POST /api/admin/customers — «+ Партнёр»", () => {
  it("401s without the admin cookie", async () => {
    const res = await post({ email: "salon@example.com" }, "");
    expect(res.status).toBe(401);
  });

  it("refuses a bad body, a bad e-mail and an unknown tier with a code, never a 500", async () => {
    const { POST } = await import("@/app/api/admin/customers/route");
    for (const raw of ["null", "[]", "42", "{not json"]) {
      const res = await POST(adminReq("https://x/api/admin/customers/", { method: "POST", raw }));
      expect(res.status, raw).toBe(400);
      expect((await res.json()).ok).toBe(false);
    }
    for (const email of ["", "not-an-email", "a@b", 12, null]) {
      const res = await post({ email });
      expect(res.status, String(email)).toBe(400);
      expect((await res.json()).error).toBe("bad_email");
    }
    const tier = await post({ email: "salon@example.com", tier: "gold" });
    expect(tier.status).toBe(400);
    expect((await tier.json()).error).toBe("bad_tier");
  });

  it("creates the row for an address that never signed in, as a partner, and sends the letter", async () => {
    const res = await post({ email: "Salon.New@Example.com ", company: "Salon Uus OÜ", phone: "+372 5000 0001", lang: "ET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.promoted).toBe(true);
    expect(body.customer.email).toBe("salon.new@example.com");
    expect(body.customer.tier).toBe("pro");
    expect(body.customer.company).toBe("Salon Uus OÜ");
    expect(body.customer.phone).toBe("+372 5000 0001");
    expect(body.customer.proApprovedAt).toBeTruthy();
    expect(body.customer.proRequestedAt).toBeNull();
    expect(await customerTier(body.customer.id)).toBe("pro");

    // no key → captured, then skipped — the panel says «письмо ушло» only on ok
    expect(body.mail.sent).toBe(false);
    expect(body.mail.skipped).toBe(true);
    const letters = lettersTo("salon.new@example.com");
    expect(letters).toHaveLength(1);
    // the letter follows the language the panel asked for
    expect(letters[0].subject).toBe("Salongihinnad on teile sisse lülitatud — Rempire");
  });

  it("promotes an existing customer in place: typed values win, blanks keep theirs, an open request closes", async () => {
    const c = await recordLogin("mari@example.com", "ET");
    const { updateCustomer } = await import("@/lib/customers");
    await updateCustomer(c.email, { name: "Mari Tamm", phone: "+372 111" });
    await requestProTier(c.email, { company: "Ilusalong Mari", regCode: "87654321", phone: "" });

    // the owner corrects the company and the phone, leaves the name blank,
    // and asks in Russian — the letter still goes out in Mari's Estonian
    const res = await post({ email: "mari@example.com", company: "Salon Mari OÜ", name: "", phone: "+372 999", lang: "RU" });
    const body = await res.json();
    expect(body.created).toBe(false);
    expect(body.promoted).toBe(true);
    expect(body.customer.id).toBe(c.id);
    expect(body.customer.tier).toBe("pro");
    expect(body.customer.name).toBe("Mari Tamm");
    expect(body.customer.company).toBe("Salon Mari OÜ");
    expect(body.customer.regCode).toBe("87654321");
    expect(body.customer.phone).toBe("+372 999");
    expect(body.customer.lang).toBe("ET");
    expect(body.customer.proRequestedAt).toBeNull();
    const letters = lettersTo("mari@example.com");
    expect(letters).toHaveLength(1);
    expect(letters[0].subject).toBe("Salongihinnad on teile sisse lülitatud — Rempire");
  });

  it("is idempotent: a partner added twice stays one row and gets no second letter", async () => {
    await post({ email: "twice@example.com", company: "Salon Twice" });
    const again = await post({ email: "twice@example.com" });
    const body = await again.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(false);
    expect(body.promoted).toBe(false);
    expect(body.mail.sent).toBe(false);
    expect(lettersTo("twice@example.com")).toHaveLength(1);
    const { GET } = await import("@/app/api/admin/customers/route");
    const list = await (await GET(adminReq("https://x/api/admin/customers/?tier=pro"))).json();
    expect(list.customers.filter((x: { email: string }) => x.email === "twice@example.com")).toHaveLength(1);
  });

  it("tier:'retail' only creates the row — no promotion, no letter", async () => {
    const res = await post({ email: "retail-only@example.com", tier: "retail", name: "Retail Only" });
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.promoted).toBe(false);
    expect(body.customer.tier).toBe("retail");
    expect(body.customer.proApprovedAt).toBeNull();
    expect(lettersTo("retail-only@example.com")).toHaveLength(0);
  });

  it("the new partner shows up under the «Партнёры» filter of the list", async () => {
    await post({ email: "listed@example.com" });
    const { GET } = await import("@/app/api/admin/customers/route");
    const pro = await (await GET(adminReq("https://x/api/admin/customers/?tier=pro"))).json();
    expect(pro.customers.some((x: { email: string }) => x.email === "listed@example.com")).toBe(true);
    const retail = await (await GET(adminReq("https://x/api/admin/customers/?tier=retail"))).json();
    expect(retail.customers.some((x: { email: string }) => x.email === "listed@example.com")).toBe(false);
  });
});

describe("PATCH /api/admin/customers/[id] — the tier switch and «Одобрить» send the same letter, once", () => {
  async function patch(id: string, body: unknown) {
    const { PATCH } = await import("@/app/api/admin/customers/[id]/route");
    return PATCH(adminReq("https://x", { method: "PATCH", body }), { params: Promise.resolve({ id }) });
  }

  it("approve sends the welcome letter; a repeat approve does not", async () => {
    const c = await recordLogin("approve-me@example.com", "EN");
    await requestProTier(c.email, { company: "Barber EN", regCode: "1", phone: "" });
    const first = await (await patch(c.id, { action: "approve" })).json();
    expect(first.customer.tier).toBe("pro");
    expect(first.mail.skipped).toBe(true);
    expect(lettersTo("approve-me@example.com")).toHaveLength(1);
    expect(lettersTo("approve-me@example.com")[0].subject).toBe("Salon prices are on for you — Rempire");

    const second = await (await patch(c.id, { action: "approve" })).json();
    expect(second.mail).toBeUndefined();
    expect(lettersTo("approve-me@example.com")).toHaveLength(1);
  });

  it("the switch: retail → pro writes the letter, pro → retail writes nothing", async () => {
    const c = await recordLogin("switch@example.com", "RU");
    const up = await (await patch(c.email, { tier: "pro" })).json();
    expect(up.customer.tier).toBe("pro");
    expect(lettersTo("switch@example.com")).toHaveLength(1);
    const down = await (await patch(c.email, { tier: "retail" })).json();
    expect(down.customer.tier).toBe("retail");
    expect(down.mail).toBeUndefined();
    expect(lettersTo("switch@example.com")).toHaveLength(1);
  });
});

/* ---------- the library and the letter --------------------------------------- */

describe("upsertPartner", () => {
  it("refuses an address that is not one", async () => {
    expect(await upsertPartner({ email: "nope" })).toBeNull();
    expect(await upsertPartner({ email: "" })).toBeNull();
  });

  it("reports promoted only when the tier actually flipped", async () => {
    const c = await recordLogin("already@example.com", "RU");
    await approveProCustomer(c.id);
    const out = await upsertPartner({ email: c.email });
    expect(out?.created).toBe(false);
    expect(out?.promoted).toBe(false);
    expect(out?.customer.tier).toBe("pro");
  });
});

describe("renderPartnerWelcome", () => {
  it("renders in the three languages with the live discount and the account link", () => {
    for (const [lang, needle] of [
      ["ru", "минус 25 %"],
      ["et", "25 % soodsamalt"],
      ["en", "25% off"],
    ] as const) {
      const mail = renderPartnerWelcome({ email: "x@example.com", customer_name: "Kai" }, lang, { percent: 25 });
      expect(mail.html).toContain(needle);
      expect(mail.text).toContain(needle);
      expect(mail.html).toContain("/shop2/account/");
      expect(mail.subject).toContain("Rempire");
      // a service letter — no unsubscribe link
      expect(mail.html).not.toContain("Отписаться");
      expect(mail.html).not.toContain("Unsubscribe");
    }
  });

  it("greets the company when the person has no name yet", () => {
    const mail = renderPartnerWelcome({ email: "x@example.com" }, "ru", { company: "Salon Näidis OÜ" });
    expect(mail.html).toContain("Здравствуйте, Salon Näidis OÜ!");
    const bare = renderPartnerWelcome({ email: "x@example.com" }, "ru");
    expect(bare.html).toContain("Здравствуйте!");
  });
});
