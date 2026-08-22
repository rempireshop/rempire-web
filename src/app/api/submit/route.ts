import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
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
 */

const MAX_BYTES = 100_000;

export async function POST(req: Request) {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  let body: {
    summary?: unknown;
    answers?: unknown;
    answered?: unknown;
    total?: unknown;
    round?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) {
    return NextResponse.json({ ok: false }, { status: 400 });
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
    return NextResponse.json({ ok: false }, { status: 502 });
  }
  return NextResponse.json({ ok: true, stored, telegram, email });
}
