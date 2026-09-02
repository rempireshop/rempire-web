import { NextRequest, NextResponse } from "next/server";
import catalogue from "@/data/catalogue.min.json";

/* The shop chat's brain. Rule-based fallback lives in the client
   (public/shop2/chat.js); when OPENAI_API_KEY is set on Vercel this route
   takes over. The key never leaves the server. */

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

type Msg = { role: "user" | "assistant"; content: string };

const LANG_NAME: Record<string, string> = { RU: "Russian", ET: "Estonian", EN: "English" };

function systemPrompt(lang: string) {
  const lines = (catalogue as Array<{ id: string; b: string; n: string; c: string; p: number; s: string }>)
    .map((p) => `${p.id}|${p.b}|${p.n}|${p.c}|${p.p}€|${p.s}`)
    .join("\n");
  return `You are the shopping assistant of REMPIRE — a premium men's grooming e-shop run by the Rempire barbershop in Tallinn (Mardi 1). You help pick products, explain differences, and assemble sets within a budget.

Answer in ${LANG_NAME[lang] ?? "Russian"}. Be warm, brief, concrete — like a good barber recommending what he actually uses. Never invent products, prices or claims. Only discuss the shop and its products; politely steer other topics back.

CATALOGUE (id|brand|name|category|price|stock; stock: in/low/out — never recommend "out"):
${lines}

Respond ONLY with JSON: {"reply": "<your answer>", "product_ids": ["<up to 4 catalogue ids to show as cards>"]}. product_ids may be empty. The reply must not repeat prices of the shown cards (the cards show them).`;
}

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.OPENAI_API_KEY) });
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ enabled: false }, { status: 503 });

  let body: { messages?: Msg[]; lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const history = (body.messages ?? [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  if (!history.length) return NextResponse.json({ error: "empty" }, { status: 400 });

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: systemPrompt(body.lang ?? "RU") }, ...history],
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error("openai error", r.status, detail.slice(0, 300));
    return NextResponse.json({ error: "upstream" }, { status: 502 });
  }
  const data = await r.json();
  let parsed: { reply?: string; product_ids?: string[] } = {};
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  } catch {
    parsed = { reply: data.choices?.[0]?.message?.content ?? "" };
  }
  const known = new Set((catalogue as Array<{ id: string }>).map((p) => p.id));
  const ids = (parsed.product_ids ?? []).filter((id) => known.has(id)).slice(0, 4);
  return NextResponse.json({ reply: parsed.reply ?? "", product_ids: ids });
}
