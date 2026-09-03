import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/auth";
import { forwardEmail, forwardTelegram } from "@/lib/notify";

/**
 * Design-prototype feedback from Renat.
 *
 * Always: stored as JSON in Vercel Blob (feedback/<timestamp>-<random>.json) —
 * the durable copy nothing can lose.
 * Optionally forwarded to Telegram + email via src/lib/notify.ts.
 * Forwarding failures never fail the request — storage is the contract.
 *
 * NB: clients must POST to "/api/feedback/" WITH the trailing slash
 * (next.config has trailingSlash: true; without it the POST 308s).
 *
 * Every accepted call sends a Telegram message and a Resend e-mail, so it is
 * limited the same way the review form is: five an hour per IP, the `website`
 * honeypot, and a body cap (audit H2).
 */

const MAX_BYTES = 20_000;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const MOOD_LABELS = {
  good: "Нравится",
  bad: "Не нравится",
  change: "Изменить",
} as const;

type Mood = keyof typeof MOOD_LABELS;

interface FeedbackElement {
  label?: string;
  snippet?: string;
  path?: string;
}

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function parseElement(v: unknown): FeedbackElement | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return undefined;
  }
  const raw = v as Record<string, unknown>;
  const el: FeedbackElement = {
    label: optionalString(raw.label),
    snippet: optionalString(raw.snippet),
    path: optionalString(raw.path),
  };
  return el.label || el.snippet || el.path ? el : undefined;
}

export async function POST(req: Request) {
  if (rateLimit("feedback", clientIp(req), RATE_MAX, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

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
    page?: unknown;
    direction?: unknown;
    section?: unknown;
    mood?: unknown;
    text?: unknown;
    element?: unknown;
    website?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // honeypot: a filled hidden field is a bot. Say thank you, do nothing.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true, stored: false, telegram: false, email: false });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || typeof body.page !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const page = body.page;
  const direction = optionalString(body.direction);
  const section = optionalString(body.section);
  const mood =
    typeof body.mood === "string" && body.mood in MOOD_LABELS
      ? (body.mood as Mood)
      : undefined;
  const element = parseElement(body.element);

  const receivedAt = new Date();
  const record = JSON.stringify(
    {
      receivedAt: receivedAt.toISOString(),
      page,
      direction,
      section,
      mood,
      text,
      element,
    },
    null,
    2,
  );

  let stored = false;
  try {
    const stamp = receivedAt.toISOString().replace(/[:.]/g, "-");
    await put(`feedback/${stamp}.json`, record, {
      access: "private", // store is private — reads require auth
      addRandomSuffix: true,
      contentType: "application/json",
    });
    stored = true;
  } catch (err) {
    console.error("blob store failed", err);
  }

  const message =
    "💬 Комментарий от Рената" +
    `\nСтраница: ${page}` +
    (direction ? ` · направление ${direction}` : "") +
    (section ? `\nБлок: ${section}` : "") +
    (element?.label ? `\nЭлемент: ${element.label}` : "") +
    (element?.snippet ? `\n«${element.snippet.slice(0, 120)}»` : "") +
    (mood ? `\nОценка: ${MOOD_LABELS[mood]}` : "") +
    `\n\n${text}`;

  const telegram = await forwardTelegram(message);
  const email = await forwardEmail(
    `REMPIRE — комментарий Рената (${receivedAt.toISOString().slice(0, 10)})`,
    message,
  );

  if (!stored && !telegram && !email) {
    // nothing durable happened — let the client show the retry line
    return NextResponse.json({ ok: false }, { status: 502 });
  }
  return NextResponse.json({ ok: true, stored, telegram, email });
}

export function GET() {
  return NextResponse.json({ ok: false }, { status: 405 });
}
