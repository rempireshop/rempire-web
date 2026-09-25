/**
 * «Обзор → Сделать сегодня» names who is waiting under two of its rows (admin
 * redesign 1a, screen 03; Dim 25.09.2026, q41): «отзыв ждёт проверки — Марина
 * К. · ★★★★★» and «заявка на партнёрство — Salon Olga OÜ». The first few names
 * ride on GET /api/admin/overview beside the counts (src/lib/overview-names.ts)
 * — the same predicates the counts use, newest first, four at most.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { getAttentionNames, OVERVIEW_NAMES_MAX } from "@/lib/overview-names";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

async function review(name: string, rating: number, status = "pending", minutesAgo = 0) {
  await query(
    `insert into reviews (product_id, name, rating, text, status, created_at)
     values ('p-1', $1, $2, 'Хорошо', $3, now() - ($4::int * interval '1 minute'))`,
    [name, rating, status, minutesAgo],
  );
}
async function asked(email: string, name: string | null, company: string | null, tier = "retail", minutesAgo = 0) {
  await query(
    `insert into customers (email, name, company, tier, pro_requested_at)
     values ($1, $2, $3, $4, now() - ($5::int * interval '1 minute'))`,
    [email, name, company, tier, minutesAgo],
  );
}

describe("the names under «отзыв ждёт проверки» and «заявка на партнёрство»", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    await exec("truncate reviews, customers restart identity cascade");
  });

  it("names the pending reviews with their stars, newest first, and nothing else", async () => {
    await review("Марина К.", 5, "pending", 1);
    await review("Old one", 4, "pending", 30);
    await review("Approved", 5, "approved", 0);
    const n = await getAttentionNames();
    expect(n.reviews).toEqual([
      { name: "Марина К.", rating: 5 },
      { name: "Old one", rating: 4 },
    ]);
  });

  it("names a partner request by its company, else the person, else the address — retail askers only", async () => {
    await asked("olga@salon.ee", "Olga", "Salon Olga OÜ", "retail", 1);
    await asked("jaan@example.com", "Jaan", null, "retail", 2);
    await asked("anon@example.com", null, null, "retail", 3);
    await asked("done@example.com", "Already", "Pro OÜ", "pro", 0);
    const n = await getAttentionNames();
    expect(n.partners.map((p) => p.name)).toEqual(["Salon Olga OÜ", "Jaan", "anon@example.com"]);
  });

  it("stops at four", async () => {
    for (let i = 0; i < 6; i++) await review(`R${i}`, 5, "pending", i);
    expect((await getAttentionNames()).reviews).toHaveLength(OVERVIEW_NAMES_MAX);
  });

  it("rides on GET /api/admin/overview", async () => {
    await review("Марина К.", 5);
    await asked("olga@salon.ee", "Olga", "Salon Olga OÜ");
    const { GET } = await import("@/app/api/admin/overview/route");
    const res = await GET(
      new Request("https://rempireshop.com/api/admin/overview/", { headers: { cookie: `${ADMIN_COOKIE}=${makeSessionToken()}` } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attention.reviewsPending).toBe(1);
    expect(body.attention.proRequests).toBe(1);
    expect(body.attentionNames).toEqual({
      reviews: [{ name: "Марина К.", rating: 5 }],
      partners: [{ name: "Salon Olga OÜ" }],
    });
  });
});
