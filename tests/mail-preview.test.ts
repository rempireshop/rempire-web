/**
 * «Ещё → Маркетинг → Письма»: the preview is the letter, not a picture of one.
 *
 * Renat, 13.09.2026: «Name also in preview is "Mart" in e-mail it's "Renat".»
 * That one was the sample customer; this is the same fault in the birthday
 * card's number. The preview offered a flat 15 % while the shop sent whatever
 * «Скидка ко дню рождения» said — 10 % out of the box — so the owner read a
 * discount he was not giving, and the percent he had chosen himself never
 * appeared in his own preview.
 *
 * GET /api/admin/mail/preview/ is not admin-gated (see the route's own note),
 * so it is called here exactly as the panel's iframe calls it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const BASE = "https://test.rempireshop.com";

async function preview(qs: string): Promise<Response> {
  const { GET } = await import("@/app/api/admin/mail/preview/route");
  return GET(new Request(`${BASE}/api/admin/mail/preview/${qs}`));
}

async function setFlows(value: Record<string, unknown>): Promise<void> {
  await query(
    `insert into settings (key, value) values ('flows', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify(value)],
  );
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = BASE;
  await setupDb();
});

afterAll(async () => {
  await teardownDb();
});

beforeEach(async () => {
  await truncateAll();
});

describe("the birthday preview shows the percent the shop really sends", () => {
  it("reads settings.flows.birthdayPercent, not a number of its own", async () => {
    await setFlows({ birthday: true, birthdayPercent: 10 });
    const html = await (await preview("?template=birthday&lang=RU")).text();
    expect(html).toContain("10 %");
    expect(html).not.toContain("15 %");
  });

  it("follows the owner's own number wherever he puts it", async () => {
    await setFlows({ birthday: true, birthdayPercent: 25 });
    const html = await (await preview("?template=birthday&lang=RU")).text();
    expect(html).toContain("25 %");
  });

  /* The card beside the iframe fills the owner's `{percent}` from this feed
     while he types, so the two halves of one screen have to agree. */
  it("says the same number in the token samples the editor fills from", async () => {
    await setFlows({ birthday: true, birthdayPercent: 10 });
    const body = (await (await preview("?format=texts&lang=RU")).json()) as {
      samples: Record<string, Record<string, string>>;
    };
    expect(body.samples.birthday.percent).toBe("10");
  });

  it("falls back to the factory default when nothing is stored", async () => {
    // FLOW_DEFAULTS.birthdayPercent — what a shop that has never touched the
    // box actually sends
    const body = (await (await preview("?format=texts&lang=RU")).json()) as {
      samples: Record<string, Record<string, string>>;
    };
    expect(body.samples.birthday.percent).toBe("10");
  });
});
