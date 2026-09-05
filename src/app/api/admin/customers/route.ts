/**
 * GET /api/admin/customers?q=&tier=&limit= — the «Клиенты» tab's list.
 *
 * `tier` — "" (everyone), "retail", "pro", or "pending" (asked for pro,
 * not yet decided — customers.pro_requested_at is not null and tier is
 * still 'retail'). `q` matches e-mail, name, phone or company.
 *
 * `?format=csv` answers the same rows as a CSV download instead of JSON —
 * see customersToCsv() in src/lib/loyalty.ts.
 *
 * POST /api/admin/customers — «+ Партнёр»: create-or-promote by e-mail.
 *
 *   { email, company?, phone?, name?, regCode?, lang?, tier?: "pro"|"retail" }
 *   → { ok, customer, created, promoted, mail: { sent, skipped?, reason? } }
 *
 * The row is created when the address has never signed in (so the partner
 * lands on salon prices at their first sign-in) and promoted in place when
 * it exists; what the owner typed wins, a blank field leaves the customer's
 * own value alone. A tier that actually flipped to pro sends the «Цены для
 * салонов включены» letter (src/lib/partner-mail.ts) in the customer's own
 * language — `lang` in the body only names the language of a row created
 * here — and a customer who was pro already gets no second one.
 * `tier: "retail"` only creates the row, sends nothing.
 */
import { isEmail, normalizeEmail } from "@/lib/customers";
import { requireAdmin } from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";
import { customersToCsv, listCustomersAdmin, upsertPartner } from "@/lib/loyalty";
import { sendPartnerWelcome } from "@/lib/partner-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_BYTES = 4_000;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const tierParam = url.searchParams.get("tier") ?? "";
  const tier = tierParam === "retail" || tierParam === "pro" || tierParam === "pending" ? tierParam : "";

  try {
    const customers = await listCustomersAdmin({
      q: url.searchParams.get("q") ?? undefined,
      tier,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });

    if (url.searchParams.get("format") === "csv") {
      return new Response(customersToCsv(customers), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="customers.csv"',
          "cache-control": "no-store",
        },
      });
    }

    return Response.json({ ok: true, customers }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/customers] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  /* `null` is valid JSON, and so is a bare number or an array — every field
     read below would throw on them. Same door as the [id] route's PATCH. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });
  }

  const email = normalizeEmail(body.email);
  if (!isEmail(email)) {
    return Response.json({ ok: false, error: "bad_email" }, { status: 400, headers: NO_STORE });
  }
  // anything but the two words is a typo, not a third tier
  if (body.tier !== undefined && body.tier !== "pro" && body.tier !== "retail") {
    return Response.json({ ok: false, error: "bad_tier" }, { status: 400, headers: NO_STORE });
  }
  const tier = body.tier === "retail" ? "retail" : "pro";

  try {
    const out = await upsertPartner({
      email,
      name: body.name,
      company: body.company,
      regCode: body.regCode ?? body.reg_code,
      phone: body.phone,
      lang: body.lang,
      tier,
    });
    if (!out) {
      return Response.json({ ok: false, error: "bad_email" }, { status: 400, headers: NO_STORE });
    }
    await writeAuditSafe("admin", out.promoted ? "customer.partner_added" : "customer.created", {
      id: out.customer.id,
      email: out.customer.email,
      created: out.created,
      tier,
    });

    let mail: { sent: boolean; skipped?: boolean; reason?: string } = { sent: false };
    if (out.promoted) {
      const res = await sendPartnerWelcome({
        email: out.customer.email,
        name: out.customer.name,
        lang: out.customer.lang,
        company: out.customer.company,
      });
      mail = { sent: res.ok, skipped: res.skipped, reason: res.reason };
    }

    return Response.json(
      { ok: true, customer: out.customer, created: out.created, promoted: out.promoted, mail },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[api/admin/customers] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
