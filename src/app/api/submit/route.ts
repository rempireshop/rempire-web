import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

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
const TELEGRAM_CHUNK = 3500; // API hard limit is 4096 chars per message

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
  const email = await forwardEmail(summary, receivedAt);

  if (!stored && !telegram && !email) {
    // nothing durable happened — let the client fall back to share/copy
    return NextResponse.json({ ok: false }, { status: 502 });
  }
  return NextResponse.json({ ok: true, stored, telegram, email });
}

async function forwardTelegram(summary: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const chunks = summary.match(
      new RegExp(`[\\s\\S]{1,${TELEGRAM_CHUNK}}`, "g"),
    ) ?? [summary];
    for (const text of chunks) {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        },
      );
      if (!res.ok) return false;
    }
    return true;
  } catch (err) {
    console.error("telegram forward failed", err);
    return false;
  }
}

async function forwardEmail(
  summary: string,
  receivedAt: Date,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "REMPIRE QA <onboarding@resend.dev>",
        to: [process.env.RESEND_TO ?? "dim.novare@gmail.com"],
        subject: `REMPIRE — ответы Рената (${receivedAt.toISOString().slice(0, 10)})`,
        text: summary,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("email forward failed", err);
    return false;
  }
}
