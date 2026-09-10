/**
 * «Рассылка» — src/lib/newsletters.ts, src/emails/newsletter.ts and the five
 * routes under /api/admin/newsletters/.
 *
 * What this file exists to catch: a letter to somebody who never ticked the
 * box or who pressed «Отписаться»; an Estonian reader getting nothing because
 * the owner wrote Russian only (they get the Russian — and the count says
 * so); a letter without the unsubscribe link or the RFC 8058 headers; a
 * resumed send mailing the same address twice; a route that answers without
 * the admin cookie; the e2e sink door standing open in production.
 *
 * Resend is a stubbed fetch — the same idiom as tests/consent.test.ts.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderNewsletter } from "@/emails/newsletter";
import { AiInputError, buildPrompt } from "@/lib/ai-prompts";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { optOut, recordMarketingConsent } from "@/lib/consent";
import { recordLogin } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import {
  audienceCounts,
  cleanNewsletterInput,
  createNewsletter,
  e2eSinkTransport,
  getNewsletter,
  langFor,
  newsletterCards,
  NewsletterError,
  readyLangs,
  sendNewsletterBatch,
} from "@/lib/newsletters";
import { listAudit } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const BASE = "https://test.rempireshop.com";
const PRODUCT = "system-4-bio-botanical-shampoo";

/** Every request Resend saw, headers included. */
interface Sent {
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  idempotencyKey: string | null;
}
const sent: Sent[] = [];
/** Per address: what Resend should answer — 200 unless told otherwise. */
const answers = new Map<string, number>();

function mockResend() {
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Sent;
    const h = (init.headers ?? {}) as Record<string, string>;
    const status = answers.get(body.to[0]) ?? 200;
    sent.push({ ...body, idempotencyKey: h["Idempotency-Key"] ?? null });
    if (status !== 200) {
      return new Response(JSON.stringify({ message: `nope ${status}` }), { status, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

async function subscribe(email: string, lang: string): Promise<void> {
  await recordLogin(email, lang);
  await recordMarketingConsent(email, lang, "account");
}

/** The four readers every send test starts from — plus the two who get nothing. */
async function seedAudience(): Promise<void> {
  await subscribe("anna@example.com", "RU");
  await subscribe("Boris@Example.com", "RU");
  await subscribe("kalev@example.com", "ET");
  await subscribe("john@example.com", "EN");
  await subscribe("gone@example.com", "RU");
  await optOut("gone@example.com", "marketing", "link");
  await recordLogin("silent@example.com", "RU"); // never ticked the box
}

const RU_BODY = "<h2>Новинки сентября</h2><p>Привезли <strong>Kevin.Murphy</strong> и System 4.</p><ul><li>Шампунь</li><li>Сыворотка</li></ul>";
const ET_BODY = "<p>Septembri uudised on kohal.</p>";

function draftInput(over: Record<string, unknown> = {}) {
  return {
    title: "Сентябрь",
    subject: { RU: "Новинки сентября", ET: "Septembri uudised" },
    body: { RU: RU_BODY, ET: ET_BODY },
    products: [PRODUCT],
    ...over,
  };
}

let admin = "";
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["SESSION_SECRET", "PUBLIC_BASE_URL", "ADMIN_PASSWORD_HASH", "RESEND_API_KEY", "MAIL_RETRY_DELAY_MS", "E2E_BOOTSTRAP", "NODE_ENV"];

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = BASE;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  process.env.MAIL_RETRY_DELAY_MS = "0";
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});

afterAll(async () => {
  await teardownDb();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(async () => {
  resetRateLimits();
  sent.length = 0;
  answers.clear();
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.E2E_BOOTSTRAP;
  await exec("truncate newsletters, newsletter_sends, customers, mail_optouts, admin_audit restart identity cascade");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ---------- cleaning and languages -------------------------------------- */

describe("cleanNewsletterInput", () => {
  it("keeps the allowlist, drops the rest, caps the products", () => {
    const c = cleanNewsletterInput({
      title: "  Осень\n2026  ",
      subject: { RU: "Тема\u0000", ET: 5, EN: "<b>x</b>" },
      body: { RU: '<p onclick="x">Текст</p><script>alert(1)</script>', ET: "<p><br></p>", EN: 42 },
      products: [PRODUCT, PRODUCT, "../../etc", "kevin-murphy-un-tangled-spray", 7, "a".repeat(200), "x1", "x2", "x3", "x4", "x5", "x6", "x7"],
    });
    expect(c.title).toBe("Осень 2026");
    expect(c.subject).toEqual({ RU: "Тема", ET: "", EN: "<b>x</b>" });
    expect(c.body.RU).toBe("<p>Текст</p>");
    expect(c.body.ET).toBe(""); // a paragraph with nothing in it is no body
    expect(c.body.EN).toBe("");
    expect(c.products[0]).toBe(PRODUCT);
    expect(c.products).not.toContain("../../etc");
    expect(c.products.length).toBeLessThanOrEqual(8);
  });

  it("knows which languages are ready and who falls back to Russian", () => {
    const ready = readyLangs({ subject: { RU: "т", ET: "e", EN: "" }, body: { RU: "<p>b</p>", ET: "", EN: "<p>c</p>" } });
    expect(ready).toEqual(["RU"]);
    expect(langFor("ET", ["RU", "ET"])).toBe("ET");
    expect(langFor("EN", ["RU", "ET"])).toBe("RU");
    expect(langFor("EN", ["ET"])).toBe("ET");
    expect(langFor("RU", [])).toBeNull();
  });
});

/* ---------- the audience ---------------------------------------------------- */

describe("audience", () => {
  it("counts the tick, minus the stop list, one row per address, by language", async () => {
    await seedAudience();
    // the same mailbox in another spelling is the same row
    await recordMarketingConsent("BORIS@example.com", "RU", "checkout");
    expect(await audienceCounts()).toEqual({ RU: 2, ET: 1, EN: 1, total: 4 });
  });

  it("a fresh tick puts somebody back, a withdrawn one takes them out", async () => {
    await seedAudience();
    await recordMarketingConsent("gone@example.com", "RU", "account");
    expect((await audienceCounts()).RU).toBe(3);
    await optOut("anna@example.com", "marketing", "one-click");
    expect((await audienceCounts()).RU).toBe(2);
  });
});

/* ---------- the letter ------------------------------------------------------ */

describe("renderNewsletter", () => {
  const cards = [{ id: PRODUCT, brand: "System 4", name: "Bio Botanical Shampoo — шампунь", price: 9, priceFrom: true, img: `/shop/img/${PRODUCT}-0.webp` }];

  it("carries the text, the cards, the unsubscribe link — in both parts", () => {
    const unsubscribe = `${BASE}/api/mail/unsubscribe/?u=abc&t=def`;
    const mail = renderNewsletter({ subject: "Новинки сентября", body: RU_BODY, products: cards, unsubscribeUrl: unsubscribe }, "ru");
    expect(mail.subject).toBe("Новинки сентября");
    expect(mail.html).toContain("Новинки сентября");
    expect(mail.html).toContain("<h2");
    expect(mail.html).toContain("<strong style=");
    expect(mail.html).toContain("<li");
    // an attribute value: the `&` between the two parameters is written as &amp;
    expect(mail.html).toContain(`href="${unsubscribe.replace("&", "&amp;")}"`);
    expect(mail.html).toContain("Отписаться");
    expect(mail.html).toContain(`${BASE}/shop2/p/${PRODUCT}/`);
    expect(mail.html).toContain(`${BASE}/shop/img/${PRODUCT}-0.webp`);
    expect(mail.html).toContain("от&nbsp;9&nbsp;€");
    expect(mail.text).toContain(unsubscribe);
    expect(mail.text).toContain("- Шампунь");
    expect(mail.text).toContain(`System 4 Bio Botanical Shampoo — шампунь — от 9 €: ${BASE}/shop2/p/${PRODUCT}/`);
    expect(mail.text).not.toMatch(/<[a-z]/i);
    for (const part of [mail.html, mail.text, mail.subject]) {
      expect(part).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
  });

  it("draws a placed card in the text and translates the name for an Estonian reader", () => {
    const body = `<p>Soovitame:</p><p><a data-product="${PRODUCT}" href="/shop2/p/${PRODUCT}/">System 4 — 9 €</a>&nbsp;</p><p>Head!</p>`;
    const mail = renderNewsletter({ subject: "Uudised", body, products: cards }, "et");
    expect(mail.html).toContain("Bio Botanical Shampoo — šampoon");
    expect(mail.html).toContain(`${BASE}/shop2/et/p/${PRODUCT}/`);
    expect(mail.html).toContain("Loobu"); // the ET «Отписаться»
    expect(mail.html).not.toContain("System 4 — 9 €"); // the marker's own words are not printed twice
    // the card stood in the text, so it is not repeated under it
    expect(mail.html.split(`${BASE}/shop/img/${PRODUCT}-0.webp`).length - 1).toBe(1);
    expect(mail.html).not.toMatch(/[Ѐ-ӿ]/); // no Cyrillic in an Estonian letter
  });

  it("survives a body with no blocks at all and one with a picture", () => {
    const bare = renderNewsletter({ subject: "S", body: "Просто строка <strong>без</strong> абзаца", products: [] }, "ru");
    expect(bare.html).toContain("Просто строка");
    expect(bare.text).toContain("Просто строка без абзаца");
    const pic = renderNewsletter({ subject: "S", body: '<figure><img src="/shop/img/x.webp" alt="Фото"></figure><p>Текст</p>', products: [] }, "ru");
    expect(pic.html).toContain(`src="${BASE}/shop/img/x.webp"`);
    expect(pic.html).toContain('alt="Фото"');
    expect(pic.text).toContain(`Фото: ${BASE}/shop/img/x.webp`);
  });
});

describe("newsletterCards", () => {
  it("names the product with the lowest size price and its photo, and skips an unknown id", async () => {
    const cards = await newsletterCards([PRODUCT, "no-such-product"]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: PRODUCT, brand: "System 4", price: 9, priceFrom: true, img: `/shop/img/${PRODUCT}-0.webp` });
    expect(cards[0].name).toContain("Bio Botanical Shampoo");
  });
});

/* ---------- the routes: locks ---------------------------------------------- */

function req(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...((init.headers as Record<string, string>) ?? {}) };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ZERO = "00000000-0000-0000-0000-000000000000";

describe("routes without the admin cookie", () => {
  it("every verb answers 401", async () => {
    const list = await import("@/app/api/admin/newsletters/route");
    const audience = await import("@/app/api/admin/newsletters/audience/route");
    const test = await import("@/app/api/admin/newsletters/[id]/test/route");
    const send = await import("@/app/api/admin/newsletters/[id]/send/route");
    const preview = await import("@/app/api/admin/newsletters/[id]/preview/route");
    vi.stubGlobal("fetch", () => { throw new Error("must not call Resend without a session"); });
    const cases = [
      list.GET(req("/api/admin/newsletters/")),
      list.POST(req("/api/admin/newsletters/", { method: "POST", body: "{}" })),
      list.PATCH(req("/api/admin/newsletters/", { method: "PATCH", body: JSON.stringify({ id: ZERO }) })),
      list.DELETE(req(`/api/admin/newsletters/?id=${ZERO}`, { method: "DELETE" })),
      audience.GET(req("/api/admin/newsletters/audience/")),
      test.POST(req(`/api/admin/newsletters/${ZERO}/test/`, { method: "POST", body: JSON.stringify({ to: "a@b.ee" }) }), ctx(ZERO)),
      send.POST(req(`/api/admin/newsletters/${ZERO}/send/`, { method: "POST" }), ctx(ZERO)),
      preview.GET(req(`/api/admin/newsletters/${ZERO}/preview/`), ctx(ZERO)),
    ];
    for (const res of await Promise.all(cases)) expect(res.status).toBe(401);
  });
});

/* ---------- the routes: drafts ---------------------------------------------- */

describe("drafts through the routes", () => {
  it("creates, lists, edits and deletes a draft; refuses to edit a sent letter", async () => {
    const { GET, POST, PATCH, DELETE } = await import("@/app/api/admin/newsletters/route");
    const created = await POST(req("/api/admin/newsletters/", { method: "POST", body: JSON.stringify(draftInput()), cookie: admin }));
    expect(created.status).toBe(200);
    const n = (await created.json()).newsletter;
    expect(n.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(n.status).toBe("draft");
    expect(n.ready).toEqual(["RU", "ET"]);
    expect(n.body.RU).toBe(RU_BODY);

    const list = await (await GET(req("/api/admin/newsletters/", { cookie: admin }))).json();
    expect(list.newsletters).toHaveLength(1);
    expect(list.newsletters[0]).toMatchObject({ id: n.id, title: "Сентябрь", productCount: 1 });
    expect(list.newsletters[0].body).toBeUndefined();

    const edited = await PATCH(req("/api/admin/newsletters/", { method: "PATCH", cookie: admin, body: JSON.stringify({ id: n.id, ...draftInput({ title: "Октябрь", products: [] }) }) }));
    expect(edited.status).toBe(200);
    expect((await edited.json()).newsletter.title).toBe("Октябрь");
    const one = await (await GET(req(`/api/admin/newsletters/?id=${n.id}`, { cookie: admin }))).json();
    expect(one.newsletter.products).toEqual([]);

    expect((await PATCH(req("/api/admin/newsletters/", { method: "PATCH", cookie: admin, body: JSON.stringify({ id: ZERO, title: "x" }) }))).status).toBe(404);
    expect((await PATCH(req("/api/admin/newsletters/", { method: "PATCH", cookie: admin, body: "null" }))).status).toBe(400);

    await query("update newsletters set status = 'sent' where id = $1", [n.id]);
    const locked = await PATCH(req("/api/admin/newsletters/", { method: "PATCH", cookie: admin, body: JSON.stringify({ id: n.id, title: "y" }) }));
    expect(locked.status).toBe(409);
    expect((await locked.json()).error).toBe("not_draft");
    expect((await DELETE(req(`/api/admin/newsletters/?id=${n.id}`, { method: "DELETE", cookie: admin }))).status).toBe(409);

    await query("update newsletters set status = 'draft' where id = $1", [n.id]);
    expect((await DELETE(req(`/api/admin/newsletters/?id=${n.id}`, { method: "DELETE", cookie: admin }))).status).toBe(200);
    expect(await getNewsletter(n.id)).toBeNull();
  });

  it("the audience route counts, the preview route renders the draft", async () => {
    await seedAudience();
    const { GET: audience } = await import("@/app/api/admin/newsletters/audience/route");
    const a = await (await audience(req("/api/admin/newsletters/audience/", { cookie: admin }))).json();
    expect(a.audience).toEqual({ RU: 2, ET: 1, EN: 1, total: 4 });

    const n = await createNewsletter(draftInput());
    const { GET: preview } = await import("@/app/api/admin/newsletters/[id]/preview/route");
    const html = await preview(req(`/api/admin/newsletters/${n.id}/preview/?lang=ET`, { cookie: admin }), ctx(n.id));
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    const page = await html.text();
    expect(page).toContain("Septembri uudised on kohal");
    expect(page).toContain("/api/mail/unsubscribe/");
    const json = await (await preview(req(`/api/admin/newsletters/${n.id}/preview/?lang=RU&format=json`, { cookie: admin }), ctx(n.id))).json();
    expect(json.subject).toBe("Новинки сентября");
    expect((await preview(req(`/api/admin/newsletters/${ZERO}/preview/`, { cookie: admin }), ctx(ZERO))).status).toBe(404);
  });
});

/* ---------- the send ---------------------------------------------------------- */

describe("sendNewsletterBatch", () => {
  it("sends once to everybody who asked, in their language or Russian, with the link and the headers", async () => {
    await seedAudience();
    mockResend();
    const n = await createNewsletter(draftInput());

    const { progress, newsletter } = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 2, batchSize: 3 });
    expect(progress).toMatchObject({ done: true, sent: 4, failed: 0, left: 0, total: 4, status: "sent" });
    expect(newsletter.status).toBe("sent");
    expect(newsletter.sentAt).toBeTruthy();
    expect(newsletter.audienceCount).toBe(4);
    expect(newsletter.sentCount).toBe(4);

    expect(sent).toHaveLength(4);
    const to = sent.map((s) => s.to[0]).sort();
    expect(to).toEqual(["anna@example.com", "boris@example.com", "john@example.com", "kalev@example.com"]);
    const byTo = new Map(sent.map((s) => [s.to[0], s]));
    expect(byTo.get("kalev@example.com")!.subject).toBe("Septembri uudised");
    // no English text: the English reader gets the Russian letter, not nothing
    expect(byTo.get("john@example.com")!.subject).toBe("Новинки сентября");
    for (const s of sent) {
      expect(s.idempotencyKey).toBe(`news:${n.id}:${s.to[0]}`);
      expect(s.headers?.["List-Unsubscribe"]).toContain(`${BASE}/api/mail/unsubscribe/`);
      expect(s.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(s.html).toContain(`${BASE}/api/mail/unsubscribe/`);
      expect(s.text).toContain(`${BASE}/api/mail/unsubscribe/`);
    }
    // the rows say the same
    const rows = await query<{ email: string; lang: string; status: string; message_id: string }>(
      "select email, lang, status, message_id from newsletter_sends where newsletter_id = $1 order by email", [n.id]);
    expect(rows.map((r) => `${r.email}:${r.lang}:${r.status}`)).toEqual([
      "anna@example.com:RU:sent", "boris@example.com:RU:sent", "john@example.com:RU:sent", "kalev@example.com:ET:sent",
    ]);
    expect(rows.every((r) => /^msg_\d+$/.test(r.message_id))).toBe(true);
    // one journal line, in words
    const audit = (await listAudit()).find((r) => r.action === "newsletter.sent");
    expect(audit).toBeTruthy();
    expect((audit!.payload as { line: string }).line).toBe("Рассылка «Сентябрь»: отправлено 4, ошибок 0");
  });

  it("stops at the budget, resumes where it stopped, and never mails an address twice", async () => {
    await seedAudience();
    mockResend();
    const n = await createNewsletter(draftInput());

    // no time at all: the audience is frozen, nothing leaves
    const first = await sendNewsletterBatch(n.id, { budgetMs: 0 });
    expect(first.progress).toMatchObject({ done: false, sent: 0, failed: 0, left: 4, total: 4, status: "sending" });
    expect(sent).toHaveLength(0);
    // a subscriber who ticks the box now is not added — the list was frozen at the start
    await subscribe("late@example.com", "RU");

    // Resend asks for a pause: the rows stay queued, the call ends early
    for (const e of ["anna@example.com", "boris@example.com", "john@example.com", "kalev@example.com"]) answers.set(e, 429);
    const paused = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 2 });
    expect(paused.progress).toMatchObject({ done: false, left: 4, retryAfterMs: 1500 });
    answers.clear();
    sent.length = 0;

    const second = await sendNewsletterBatch(n.id, { perSecond: 1000, concurrency: 2, batchSize: 2 });
    expect(second.progress).toMatchObject({ done: true, sent: 4, failed: 0, left: 0, total: 4 });
    expect(sent.map((s) => s.to[0]).sort()).toEqual(["anna@example.com", "boris@example.com", "john@example.com", "kalev@example.com"]);

    // a third call is refused — the letter is history now
    await expect(sendNewsletterBatch(n.id)).rejects.toMatchObject({ code: "already_sent" });
    expect(sent).toHaveLength(4);
  });

  it("marks what Resend refused as failed and counts it in the journal line", async () => {
    await seedAudience();
    mockResend();
    answers.set("john@example.com", 422);
    answers.set("kalev@example.com", 500); // a 5xx is retried once and then given up on
    const n = await createNewsletter(draftInput());
    const { progress } = await sendNewsletterBatch(n.id, { perSecond: 1000 });
    expect(progress).toMatchObject({ done: true, sent: 2, failed: 2, left: 0 });
    const failed = await query<{ email: string; error: string }>(
      "select email, error from newsletter_sends where newsletter_id = $1 and status = 'failed' order by email", [n.id]);
    expect(failed.map((r) => r.email)).toEqual(["john@example.com", "kalev@example.com"]);
    expect(failed[0].error).toContain("nope 422");
    const audit = (await listAudit()).find((r) => r.action === "newsletter.sent");
    expect((audit!.payload as { line: string }).line).toBe("Рассылка «Сентябрь»: отправлено 2, ошибок 2");
  });

  it("refuses an empty letter, a letter with no subject, a letter with nobody to send to", async () => {
    mockResend();
    const empty = await createNewsletter(draftInput({ body: {} }));
    await expect(sendNewsletterBatch(empty.id)).rejects.toMatchObject({ code: "empty_body" });
    const noSubject = await createNewsletter(draftInput({ subject: {} }));
    await expect(sendNewsletterBatch(noSubject.id)).rejects.toMatchObject({ code: "no_subject" });
    await recordLogin("silent@example.com", "RU");
    const nobody = await createNewsletter(draftInput());
    await expect(sendNewsletterBatch(nobody.id)).rejects.toMatchObject({ code: "no_recipients" });
    await expect(sendNewsletterBatch(ZERO)).rejects.toMatchObject({ code: "not_found" });
    expect(sent).toHaveLength(0);
    // none of the refusals changed the letter
    expect((await getNewsletter(nobody.id))!.status).toBe("draft");
  });

  it("lets one batch run at a time, and takes over a lease that died", async () => {
    await seedAudience();
    mockResend();
    const n = await createNewsletter(draftInput());
    await query("update newsletters set status = 'sending', sending_at = now() where id = $1", [n.id]);
    await expect(sendNewsletterBatch(n.id)).rejects.toMatchObject({ code: "busy" });
    // a lease from ten minutes ago belongs to a call that is not coming back
    await query("update newsletters set sending_at = now() - interval '10 minutes' where id = $1", [n.id]);
    await query("insert into newsletter_sends (newsletter_id, email, lang) values ($1, 'anna@example.com', 'RU')", [n.id]);
    const { progress } = await sendNewsletterBatch(n.id, { perSecond: 1000 });
    expect(progress).toMatchObject({ done: true, sent: 1, total: 1 });
    expect(sent.map((s) => s.to[0])).toEqual(["anna@example.com"]);
    const [row] = await query<{ sending_at: unknown }>("select sending_at from newsletters where id = $1", [n.id]);
    expect(row.sending_at).toBeNull();
  });

  it("refuses to start without a Resend key — and the e2e sink door stays shut in production", async () => {
    await seedAudience();
    vi.stubGlobal("fetch", () => { throw new Error("must not dial out without a key"); });
    delete process.env.RESEND_API_KEY;
    const n = await createNewsletter(draftInput());
    expect(e2eSinkTransport()).toBe(false);
    await expect(sendNewsletterBatch(n.id)).rejects.toMatchObject({ code: "no_api_key" });
    expect((await getNewsletter(n.id))!.status).toBe("draft");

    // the flag alone is not enough
    process.env.E2E_BOOTSTRAP = "1";
    const nodeEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    expect(e2eSinkTransport()).toBe(false);
    await expect(sendNewsletterBatch(n.id)).rejects.toMatchObject({ code: "no_api_key" });
    vi.stubEnv("NODE_ENV", nodeEnv ?? "test");

    // outside production, with the flag: the sink is the transport
    expect(e2eSinkTransport()).toBe(true);
    const { progress } = await sendNewsletterBatch(n.id, { perSecond: 1000 });
    expect(progress).toMatchObject({ done: true, sent: 4, failed: 0 });
    const ids = await query<{ message_id: string }>("select distinct message_id from newsletter_sends where newsletter_id = $1", [n.id]);
    expect(ids.map((r) => r.message_id)).toEqual(["e2e-sink"]);
  });

  it("the send route loops to done and then answers 409; GET is 405", async () => {
    await seedAudience();
    mockResend();
    const n = await createNewsletter(draftInput());
    const { POST, GET } = await import("@/app/api/admin/newsletters/[id]/send/route");
    const res = await POST(req(`/api/admin/newsletters/${n.id}/send/`, { method: "POST", cookie: admin }), ctx(n.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, done: true, sent: 4, failed: 0, left: 0, total: 4 });
    expect(body.newsletter.status).toBe("sent");
    const again = await POST(req(`/api/admin/newsletters/${n.id}/send/`, { method: "POST", cookie: admin }), ctx(n.id));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("already_sent");
    expect((await POST(req(`/api/admin/newsletters/${ZERO}/send/`, { method: "POST", cookie: admin }), ctx(ZERO))).status).toBe(404);
    expect(GET().status).toBe(405);
  });

  it("the test route sends one [test] letter to the address typed, in the language asked for", async () => {
    mockResend();
    const n = await createNewsletter(draftInput());
    const { POST } = await import("@/app/api/admin/newsletters/[id]/test/route");
    const res = await POST(req(`/api/admin/newsletters/${n.id}/test/`, { method: "POST", cookie: admin, body: JSON.stringify({ to: "renat@example.com", lang: "ET" }) }), ctx(n.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, lang: "ET", to: "renat@example.com" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["renat@example.com"]);
    expect(sent[0].subject).toBe("[test] Septembri uudised");
    expect(sent[0].idempotencyKey).toBeNull();
    // English is not written: the test letter falls back to Russian and says so
    const en = await POST(req(`/api/admin/newsletters/${n.id}/test/`, { method: "POST", cookie: admin, body: JSON.stringify({ to: "renat@example.com", lang: "EN" }) }), ctx(n.id));
    expect((await en.json()).lang).toBe("RU");
    const bad = await POST(req(`/api/admin/newsletters/${n.id}/test/`, { method: "POST", cookie: admin, body: JSON.stringify({ to: "not-an-address" }) }), ctx(n.id));
    expect((await bad.json()).error).toBe("bad_email");
    delete process.env.RESEND_API_KEY;
    const off = await POST(req(`/api/admin/newsletters/${n.id}/test/`, { method: "POST", cookie: admin, body: JSON.stringify({ to: "renat@example.com" }) }), ctx(n.id));
    expect(off.status).toBe(503);
    expect((await off.json()).error).toBe("no_api_key");
  });
});

/* ---------- the assistant ------------------------------------------------------ */

describe("the newsletter AI task", () => {
  it("builds a prompt from the brief and the picked products, and refuses an empty brief", () => {
    const { system, user } = buildPrompt("newsletter", "RU", {
      brief: "Новинки сентября: Kevin.Murphy и скидка 10 % до воскресенья",
      products: [{ id: PRODUCT, brand: "System 4", name: "Bio Botanical Shampoo — шампунь", category: "Уход за волосами" }],
    });
    expect(user).toContain("Новинки сентября");
    expect(user).toContain(PRODUCT);
    expect(system).toMatch(/newsletter e-mail/);
    expect(system).toMatch(/Russian/);
    expect(system).toMatch(/data-product/);
    expect(() => buildPrompt("newsletter", "RU", { brief: "" })).toThrow(AiInputError);
  });

  it("the route hands back a subject and an allowlisted body, with cards only for the products offered", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          model: "gpt-4.1-mini",
          choices: [{
            message: {
              content: JSON.stringify({
                subject: "Новинки сентября",
                body: `<p>Привезли <strong>System 4</strong>.</p><p><a data-product="${PRODUCT}"></a></p><p><a data-product="invented-thing"></a></p><script>x</script>`,
              }),
            },
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    process.env.OPENAI_API_KEY = "sk-test";
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(new NextRequest(`${ORIGIN}/api/admin/ai/text/`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "rempireshop.com", cookie: admin },
      body: JSON.stringify({ task: "newsletter", lang: "RU", input: { brief: "новинки", products: [{ id: PRODUCT, brand: "System 4", name: "Bio Botanical Shampoo" }] } }),
    }));
    delete process.env.OPENAI_API_KEY;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text.subject).toBe("Новинки сентября");
    expect(body.text.body).toContain(`<a data-product="${PRODUCT}">`);
    expect(body.text.body).not.toContain("invented-thing");
    expect(body.text.body).not.toContain("<script");
  });
});
