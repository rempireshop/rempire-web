/**
 * The names under two rows of «Обзор → Сделать сегодня» (admin redesign 1a,
 * screen 03; Dim, 25.09.2026, q41): «1 отзыв ждёт проверки — Марина К. ·
 * ★★★★★» and «1 заявка на партнёрство — Salon Olga OÜ». The counts have ridden
 * on GET /api/admin/overview since the panel had a first screen (qAttention in
 * src/lib/analytics.ts); the first few names ride beside them now, so the row
 * says WHO is waiting and not only how many.
 *
 * Two small reads over the same predicates qAttention counts by — the pending
 * reviews, and the retail customers who asked to become partners — newest
 * first, four each. Nothing else is asked for: the reviews and customers
 * screens keep their own loaders, and warming those in the background is what
 * 7301d1d had to revert. Each half fails soft to an empty list, so a problem
 * here can never take «Обзор» down with it; the row then simply has no second
 * line, as it had before.
 */
import { query } from "@/lib/db";

/** How many names a row carries — the row cuts the line with an ellipsis anyway. */
export const OVERVIEW_NAMES_MAX = 4;

export type AttentionNames = {
  /** Pending reviews: who wrote it and the stars they gave. */
  reviews: Array<{ name: string; rating: number }>;
  /** Partner requests: the salon's company name, else the person's name, else the address. */
  partners: Array<{ name: string }>;
};

const clip = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, 60);

async function reviewNames(): Promise<AttentionNames["reviews"]> {
  try {
    const rows = await query<{ name: string | null; rating: number | string | null }>(
      `select name, rating from reviews where status = 'pending' order by created_at desc limit $1`,
      [OVERVIEW_NAMES_MAX],
    );
    return rows
      .map((r) => ({ name: clip(r.name), rating: Math.min(5, Math.max(0, Math.round(Number(r.rating) || 0))) }))
      .filter((r) => r.name);
  } catch (err) {
    console.error("[overview-names] reviews failed:", err);
    return [];
  }
}

async function partnerNames(): Promise<AttentionNames["partners"]> {
  try {
    const rows = await query<{ company: string | null; name: string | null; email: string | null }>(
      `select company, name, email from customers
        where pro_requested_at is not null and tier = 'retail'
        order by pro_requested_at desc limit $1`,
      [OVERVIEW_NAMES_MAX],
    );
    return rows.map((r) => ({ name: clip(r.company) || clip(r.name) || clip(r.email) })).filter((r) => r.name);
  } catch (err) {
    console.error("[overview-names] partner requests failed:", err);
    return [];
  }
}

export async function getAttentionNames(): Promise<AttentionNames> {
  const [reviews, partners] = await Promise.all([reviewNames(), partnerNames()]);
  return { reviews, partners };
}
