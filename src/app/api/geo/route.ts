import { NextRequest, NextResponse } from "next/server";

// Vercel stamps the visitor's country onto every request; the static shop
// can't see request headers, so this tiny endpoint hands it to the client.
// Used only to pick a default language on the very first visit.
export async function GET(req: NextRequest) {
  const country = req.headers.get("x-vercel-ip-country") ?? "";
  return NextResponse.json(
    { country },
    { headers: { "cache-control": "private, max-age=3600" } },
  );
}
