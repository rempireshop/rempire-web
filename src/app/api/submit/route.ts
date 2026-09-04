import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/auth";
import { forwardEmail, forwardTelegram } from "@/lib/notify";

/**
 * Questionnaire submissions.
 *
 * Always: stored as JSON in Vercel Blob (qa/<timestamp>-<random>.json) —
 * the durable copy nothing can lose.
 * Optionally forwarded, each gated on env config:
 *  - Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *  - Email:    RESEND_API_KEY (+ optional RESEND_FROM / RESEND_TO)
 * Forwarding failures never fail the request — storage is the contract.
 *
 * Every accepted call costs a Telegram message and a Resend send, on the shop's
 * own sending domain. Five an hour per IP, plus the same `website` honeypot the
 * review form uses, plus a body cap — this route is answered by one person, a
 * few times (audit H2).
 */

/* One questionnaire, fully filled in, is a few kilobytes. */
const MAX_BYTES = 100_000;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  if (rateLimit("submit", clientIp(req), RATE_MAX, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let body: {
    summary?: unknown;
    answers?: unknown;
    answered?: unknown;
    total?: unknown;
    round?: unknown;
    website?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and body.website below throws — a 500 from a four-byte
     body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  /* A bot that filled the hidden field is thanked and ignored: telling it what
     gave it away only helps it come back. Nothing is stored, nothing is sent. */
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true, stored: false, telegram: false, email: false });
  }
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  // раунд опроса: только цифры/буквы, иначе не пускаем в имя файла
  const round =
    typeof body.round === "string" && /^[a-z0-9-]{1,12}$/i.test(body.round)
      ? body.round
      : "1";

  const receivedAt = new Date();
  const record = JSON.stringify(
    {
      receivedAt: receivedAt.toISOString(),
      round,
      answered: body.answered,
      total: body.total,
      summary,
      answers: body.answers,
    },
    null,
    2,
  );

  let stored = false;
  try {
    const stamp = receivedAt.toISOString().replace(/[:.]/g, "-");
    await put(`qa/round${round}-${stamp}.json`, record, {
      access: "private", // store rempire-qa is private — reads require auth
      addRandomSuffix: true,
      contentType: "application/json",
    });
    stored = true;
  } catch (err) {
    console.error("blob store failed", err);
  }

  const telegram = await forwardTelegram(summary);
  const email = await forwardEmail(
    `REMPIRE — ответы Рената (${receivedAt.toISOString().slice(0, 10)})`,
    summary,
  );

  if (!stored && !telegram && !email) {
    // nothing durable happened — let the client fall back to share/copy
    return NextResponse.json({ ok: false, error: "not_stored" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, stored, telegram, email });
}
