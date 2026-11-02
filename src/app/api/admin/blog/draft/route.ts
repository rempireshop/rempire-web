/**
 * «Написать черновик» — an article written from the blog's materials (Dim,
 * 02.11.2026; canvas-banner/project/BlogNew → BlogDraft). Behind requireAdmin,
 * rate-limited in the same hourly bucket as every other «✨» text task.
 *
 * POST /api/admin/blog/draft/  { about, materials: [id…], showSources? }
 *   → { ok, post, placed: [{url,label,page}], unsure, trimmed: {used,total,trimmed} }
 *   The Russian article: OpenAI reads the materials' text — never all of a
 *   170-page catalogue: the pages its topic names and the ones paired with the
 *   ticked pictures, about 45 000 characters at most (selectMaterialText) — and
 *   writes title, excerpt and body; this route holds the body to the shop
 *   (src/lib/blog-draft.ts: products from the catalogue only, pictures from the
 *   materials only, five at most, the unsupported sentences marked) and saves
 *   it as a NEW DRAFT: its sources are the materials' names, its topic the
 *   model's pick (or the shop's guess), its cover the first picture placed.
 *
 * POST /api/admin/blog/draft/  { translate: <post id>, lang: "ET" | "EN" }
 *   → { ok, post, unsure }
 *   That draft into Estonian or English, every tag kept; the panel asks for
 *   both at once the moment the Russian is saved, and each writes only its
 *   own language (writePostLanguage). A post that is no longer a draft is not
 *   touched (`not_draft`).
 *
 * Nothing is ever published from here. Same model, same request shape and
 * the same JSON reader as src/app/api/admin/ai/text/route.ts (OPENAI_MODEL,
 * chat completions, response_format json_object, src/lib/ai-json.ts). Waiting
 * on OpenAI costs the function no CPU; one call is held to 55 s so the answer
 * always beats the 60-s function limit every other long admin route keeps.
 */
import { NextRequest, NextResponse } from "next/server";
import { extractJsonObject } from "@/lib/ai-json";
import { clientIp, rateLimit, rateLimitWaitS, requireAdmin } from "@/lib/auth";
import { BlogError, getPostById, upsertPost, writePostLanguage } from "@/lib/blog";
import {
  buildDraftPrompt, buildTranslatePrompt, draftProducts, pictureList, readDraftJson, shapeDraftBody, sourcesOf,
} from "@/lib/blog-draft";
import { getMaterials, materialImageIndex, selectMaterialText } from "@/lib/blog-materials";
import { productsNow, shopBody, shopPhotos } from "@/lib/mcp/tools";
import { chatParams, openaiModel } from "@/lib/openai-chat";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = openaiModel();
const CALL_MS = 55_000;
const RATE_MAX = 200;
const RATE_WINDOW_MS = 3_600_000;

function bad(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

async function ask(key: string, system: string, user: string, maxTokens: number): Promise<{ parsed: unknown; cut: boolean } | { error: string }> {
  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CALL_MS),
      body: JSON.stringify({
        ...chatParams(MODEL, { maxTokens, temperature: 0.4 }),
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
  } catch (err) {
    console.error("[admin/blog/draft] openai fetch failed", err);
    return { error: "upstream" };
  }
  if (!r.ok) {
    console.error("[admin/blog/draft] openai error", r.status, (await r.text().catch(() => "")).slice(0, 300));
    return { error: "upstream" };
  }
  const data = await r.json().catch(() => null);
  const choice = data?.choices?.[0] ?? {};
  const got = extractJsonObject(choice.message?.content, { finishReason: choice.finish_reason });
  if (!got.value) return { error: "upstream" };
  return { parsed: got.value, cut: !!got.truncated || choice.finish_reason === "length" };
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (rateLimit("ai-text", clientIp(req), RATE_MAX, RATE_WINDOW_MS)) {
    const retryAfter = rateLimitWaitS("ai-text", clientIp(req));
    return bad("rate_limited", 429, { retryAfter });
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return bad("not_configured", 503);

  let body: Record<string, unknown>;
  try {
    const v = JSON.parse((await req.text()) || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return bad("bad_request");
    body = v as Record<string, unknown>;
  } catch {
    return bad("bad_request");
  }

  const { list } = await productsNow();
  const byId = new Map(list.map((p) => [p.id, p]));

  /* ---- ET or EN of a saved draft ---- */
  if (typeof body.translate === "string") {
    const lang = body.lang === "ET" || body.lang === "EN" ? body.lang : null;
    if (!lang) return bad("bad_lang");
    const post = await getPostById(body.translate);
    if (!post) return bad("not_found", 404);
    if (post.status !== "draft") return bad("not_draft", 409);
    const p = buildTranslatePrompt(lang, {
      title: post.title.RU, excerpt: post.excerpt.RU, body: post.body.RU, tags: post.tags,
      seoTitle: post.seoTitle.RU, seoDesc: post.seoDesc.RU,
    });
    const got = await ask(key, p.system, p.user, 9000);
    if ("error" in got) return bad(got.error, 502);
    if (got.cut) return bad("truncated", 502);
    const t = readDraftJson(got.parsed, lang);
    // the pictures the Russian carries are the materials' or the shop's — the same may stand here
    const photos = new Set([...shopPhotos(list), ...(await materialImageIndex()).keys()]);
    const shaped = shapeDraftBody(t.body, { shape: (h) => shopBody(h, lang, byId, photos) });
    if (!t.title || !shaped.html) return bad("upstream", 502);
    try {
      const saved = await writePostLanguage(post.id, lang, {
        title: t.title, excerpt: t.excerpt, body: shaped.html, seoTitle: t.seoTitle, seoDesc: t.seoDesc, tags: t.tags,
      });
      if (!saved) return bad("not_draft", 409);
      await writeAuditSafe("admin", "blog.draft_translate", { slug: saved.slug, lang });
      return NextResponse.json({ ok: true, post: saved, unsure: shaped.unsure }, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof BlogError) return bad(err.code);
      throw err;
    }
  }

  /* ---- the Russian article, from the materials ---- */
  const ids = Array.isArray(body.materials) ? body.materials.filter((x): x is string => typeof x === "string") : [];
  const materials = await getMaterials(ids);
  if (!materials.length) return bad("no_materials");
  const about = typeof body.about === "string" ? body.about.replace(/\s+/g, " ").trim().slice(0, 600) : "";
  const selected = selectMaterialText(materials, about);
  const pictures = pictureList(materials);

  // the shop's products the article may name: the pictures', the topic's, the pages' headings', the text's — shown ones only
  const products = draftProducts({ about, selected, pictures, list });
  const seen = new Set(products.map((p) => p.id));

  const prompt = buildDraftPrompt({ about, selected, pictures, products });
  const got = await ask(key, prompt.system, prompt.user, 9000);
  if ("error" in got) return bad(got.error, 502);
  if (got.cut) return bad("truncated", 502);
  const t = readDraftJson(got.parsed, "RU");

  const allowed = new Map([...byId].filter(([id]) => seen.has(id)));
  const photos = new Set(pictures.map((p) => p.image.url));
  const shaped = shapeDraftBody(t.body, { pictures, shape: (h) => shopBody(h, "RU", allowed, photos) });
  if (!t.title || !shaped.html) return bad("upstream", 502);

  const named = [...shaped.ids, ...t.products.filter((id) => allowed.has(id))];
  const productIds = [...new Set(named)].slice(0, 40);
  const cover = shaped.placed[0] ?? null;
  try {
    const post = await upsertPost({
      title: { RU: t.title }, excerpt: { RU: t.excerpt }, body: { RU: shaped.html },
      tags: t.tags, products: productIds,
      seoTitle: { RU: t.seoTitle }, seoDesc: { RU: t.seoDesc },
      // the model's pick of the five; none → the shop's own guess from the text
      ...(t.topic ? { topic: t.topic } : {}),
      sources: sourcesOf(materials),
      showSources: body.showSources === true,
      coverUrl: cover ? cover.url : null,
      coverAlt: cover ? { RU: cover.label } : undefined,
      coverW: cover ? cover.w : undefined,
      coverH: cover ? cover.h : undefined,
    });
    await writeAuditSafe("admin", "blog.draft_from_materials", {
      slug: post.slug, materials: materials.length, used: selected.used, total: selected.total,
      pictures: shaped.placed.length, products: productIds.length, unsure: shaped.unsure,
    });
    return NextResponse.json({
      ok: true,
      post,
      placed: shaped.placed.map((p) => ({ url: p.url, label: p.label, page: p.page })),
      unsure: shaped.unsure,
      trimmed: { used: selected.used, total: selected.total, trimmed: selected.trimmed },
    }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof BlogError) return bad(err.code);
    console.error("[admin/blog/draft] save failed", err);
    return bad("unavailable", 503);
  }
}
