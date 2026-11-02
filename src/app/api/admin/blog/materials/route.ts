/**
 * The blog's materials library (db/migrations/228_blog_materials.sql,
 * src/lib/blog-materials.ts) — what «Новая статья» → «Материалы» in the panel
 * reads and writes. Behind requireAdmin, every verb.
 *
 * GET    /api/admin/blog/materials/          → { ok, materials }   newest first, each with a short text
 * GET    /api/admin/blog/materials/?id=<id>  → { ok, material }    whole
 * POST   /api/admin/blog/materials/  { kind, name, text?, pages?, images?, sample?, pageCount? }
 *                                            → { ok, material }    a PDF read in the browser, photos, a text
 * POST   /api/admin/blog/materials/  { kind: "link", url }
 *                                            → { ok, material }    the page fetched here, through the SSRF
 *                                                                   guard (src/lib/safe-fetch.ts) — its text only
 * PATCH  /api/admin/blog/materials/  { id, name?, images? }
 *                                            → { ok, material }    more pages ticked, a better name
 * DELETE /api/admin/blog/materials/?id=<id>  → { ok }             gone from every list (the row stays)
 *
 * A PDF never travels here: the panel reads it on the phone (pdf.js) and
 * sends its text and the pictures it uploaded through /api/admin/upload/ —
 * no server CPU for a 170-page catalogue, and no file the shop could ever be
 * asked to hand out (Dim: sources are names only).
 */
import { requireAdmin } from "@/lib/auth";
import {
  createMaterial, deleteMaterial, getMaterial, listMaterials, MaterialError, readMaterialInput, updateMaterial,
} from "@/lib/blog-materials";
import { writeAuditSafe } from "@/lib/orders";
import { fetchPublicPage, SafeFetchError } from "@/lib/safe-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A link is one fetch of at most 10 s (FETCH_TIMEOUT_MS) — waiting, not work. */
export const maxDuration = 30;

const NO_STORE = { "cache-control": "no-store" } as const;
/** A 170-page catalogue's text in JSON is a few hundred kilobytes; Vercel takes 4.5 MB at most. */
const MAX_BYTES = 1_500_000;

function bad(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE });
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = (await req.text()) || "{}";
  } catch {
    return null;
  }
  if (raw.length > MAX_BYTES) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id) {
      const material = await getMaterial(id);
      return material ? Response.json({ ok: true, material }, { headers: NO_STORE }) : bad("not_found", 404);
    }
    // the list carries no full texts — a short one each, and every picture
    const materials = (await listMaterials(200)).map((m) => ({
      id: m.id, kind: m.kind, name: m.name, url: m.url, sample: m.sample, pageCount: m.pageCount,
      createdAt: m.createdAt, images: m.images, chars: m.text.length, short: m.text.slice(0, 300),
    }));
    return Response.json({ ok: true, materials }, { headers: NO_STORE });
  } catch (err) {
    console.error("admin/blog/materials GET failed", err);
    return bad("unavailable", 503);
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body) return bad("bad_request");
  try {
    if (body.kind === "link") {
      let page;
      try {
        page = await fetchPublicPage(String(body.url || ""));
      } catch (err) {
        if (err instanceof SafeFetchError) return bad("link_" + err.code, 422);
        throw err;
      }
      const host = new URL(page.url).hostname.replace(/^www\./, "");
      const input = readMaterialInput({
        kind: "link",
        url: page.url,
        name: typeof body.name === "string" && body.name.trim() ? body.name : (page.title ? `${host} — ${page.title}` : host),
        text: page.text,
      });
      const material = await createMaterial(input);
      await writeAuditSafe("admin", "blog.material", { id: material.id, kind: "link", host, chars: material.text.length });
      return Response.json({ ok: true, material }, { headers: NO_STORE });
    }
    const material = await createMaterial(readMaterialInput(body));
    await writeAuditSafe("admin", "blog.material", {
      id: material.id, kind: material.kind, chars: material.text.length, images: material.images.length, pages: material.pageCount,
    });
    return Response.json({ ok: true, material }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof MaterialError) return bad(err.code);
    console.error("admin/blog/materials POST failed", err);
    return bad("unavailable", 503);
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body || typeof body.id !== "string") return bad("bad_request");
  try {
    const material = await updateMaterial(body.id, { name: body.name, images: body.images });
    return material ? Response.json({ ok: true, material }, { headers: NO_STORE }) : bad("not_found", 404);
  } catch (err) {
    console.error("admin/blog/materials PATCH failed", err);
    return bad("unavailable", 503);
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") || "";
  try {
    return (await deleteMaterial(id)) ? Response.json({ ok: true }, { headers: NO_STORE }) : bad("not_found", 404);
  } catch (err) {
    console.error("admin/blog/materials DELETE failed", err);
    return bad("unavailable", 503);
  }
}
