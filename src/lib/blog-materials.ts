/**
 * The blog's materials library — what an article is written FROM (Dim,
 * 02.11.2026; canvas-banner/project/BlogNew and Flow).
 *
 * One library, three writers: the panel's «Новая статья» → «Материалы», the
 * Помощник, and Renat's Claude (list_materials / get_material in
 * src/lib/mcp/tools.ts). A material is one of four kinds:
 *
 *   pdf    a brand's PDF. Read IN THE BROWSER (public/shop2/app.js, pdf.js,
 *          lazy and panel-only): its text page by page, each page's heading,
 *          and the pictures the owner ticked, uploaded as ordinary blog photos.
 *          The PDF itself is never uploaded or stored — the server spends no
 *          CPU on it, and the shop never hands it out (sources are names only).
 *   image  photos from the phone, uploaded the usual way.
 *   link   a public web page, fetched by the server through the SSRF guard
 *          (src/lib/safe-fetch.ts) — its text only.
 *   text   text pasted in; `sample` marks one as «писать так же» — the tone
 *          and the length to copy, not facts to use.
 *
 * Storage: db/migrations/228_blog_materials.sql. Pictures are addresses of
 * our own bucket (blog/… keys) and nothing else; a page's heading is what
 * labels the photo page after it («HYDRATE-ME.WASH — фото»), so the writer can
 * put the right product's photo under the right heading.
 */
import { jsonbParam, query } from "@/lib/db";
import { keyFromUrl } from "@/lib/storage";

export type MaterialKind = "pdf" | "image" | "link" | "text";
export const MATERIAL_KINDS: readonly MaterialKind[] = ["pdf", "image", "link", "text"];

export interface MaterialImage {
  /** Short, unique inside its material — the draft names a picture by `<material>:<id>`. */
  id: string;
  url: string;
  w: number;
  h: number;
  /** The PDF page it came from; null for a photo. */
  page: number | null;
  /** «HYDRATE-ME.WASH — фото», or the photo's file name. */
  label: string;
}
export interface MaterialPage {
  n: number;
  heading: string;
  text: string;
}
export interface Material {
  id: string;
  kind: MaterialKind;
  name: string;
  text: string;
  pages: MaterialPage[];
  images: MaterialImage[];
  url: string | null;
  sample: boolean;
  pageCount: number | null;
  createdAt: string;
}

export const MATERIAL_LIMITS = {
  name: 200,
  text: 300_000,
  pages: 400,
  heading: 200,
  pageText: 20_000,
  images: 120,
  label: 160,
  url: 2000,
} as const;

export class MaterialError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const oneLine = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
/** Text with its line breaks — a PDF page or a pasted sample is paragraphs. */
const multiLine = (v: unknown, max: number) =>
  typeof v === "string"
    ? v.replace(/\r\n?/g, "\n").replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? c : " ")).replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)
    : "";
const posInt = (v: unknown, max = 100_000): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= max ? n : null;
};

/** A picture is ours or it is nothing: a blog/ object in this shop's bucket. */
export function isOurBlogImage(url: unknown): boolean {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
  const key = keyFromUrl(url);
  return !!key && key.startsWith("blog/");
}

const IMG_ID = /^[a-z0-9]{1,16}$/;
function cleanImages(raw: unknown, isOurs: (u: unknown) => boolean): MaterialImage[] {
  if (!Array.isArray(raw)) return [];
  const out: MaterialImage[] = [];
  const ids = new Set<string>();
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (!isOurs(o.url)) continue;
    const w = posInt(o.w), h = posInt(o.h);
    if (!w || !h) continue;
    let id = typeof o.id === "string" && IMG_ID.test(o.id) ? o.id : "i" + (out.length + 1);
    while (ids.has(id)) id = "i" + (out.length + 1) + Math.random().toString(36).slice(2, 5);
    ids.add(id);
    out.push({ id, url: String(o.url), w, h, page: posInt(o.page, 10_000), label: oneLine(o.label, MATERIAL_LIMITS.label) });
    if (out.length >= MATERIAL_LIMITS.images) break;
  }
  return out;
}
function cleanPages(raw: unknown): MaterialPage[] {
  if (!Array.isArray(raw)) return [];
  const out: MaterialPage[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const n = posInt(o.n, 10_000);
    if (!n) continue;
    out.push({ n, heading: oneLine(o.heading, MATERIAL_LIMITS.heading), text: multiLine(o.text, MATERIAL_LIMITS.pageText) });
    if (out.length >= MATERIAL_LIMITS.pages) break;
  }
  return out.sort((a, b) => a.n - b.n);
}

export interface MaterialInput {
  kind: MaterialKind;
  name: string;
  text: string;
  pages: MaterialPage[];
  images: MaterialImage[];
  url: string | null;
  sample: boolean;
  pageCount: number | null;
}

/**
 * A material as the panel (or a script) sends it, cleaned — or refused.
 * `isOurs` decides which picture addresses are allowed (our bucket's blog/
 * objects; tests hand in their own).
 */
export function readMaterialInput(raw: unknown, isOurs: (u: unknown) => boolean = isOurBlogImage): MaterialInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MaterialError("bad_request");
  const o = raw as Record<string, unknown>;
  if (!MATERIAL_KINDS.includes(o.kind as MaterialKind)) throw new MaterialError("bad_kind");
  const kind = o.kind as MaterialKind;
  const name = oneLine(o.name, MATERIAL_LIMITS.name);
  if (!name) throw new MaterialError("name_required");
  const pages = kind === "pdf" ? cleanPages(o.pages) : [];
  const text = pages.length
    ? pages.map((p) => p.text).filter(Boolean).join("\n\n").slice(0, MATERIAL_LIMITS.text)
    : multiLine(o.text, MATERIAL_LIMITS.text);
  const images = kind === "pdf" || kind === "image" ? cleanImages(o.images, isOurs) : [];
  let url: string | null = null;
  if (kind === "link") {
    url = oneLine(o.url, MATERIAL_LIMITS.url);
    if (!/^https:\/\//i.test(url)) throw new MaterialError("bad_url");
  }
  if (kind === "image" && !images.length) throw new MaterialError("no_images");
  if ((kind === "text" || kind === "link") && !text) throw new MaterialError("empty");
  if (kind === "pdf" && !text && !images.length) throw new MaterialError("empty");
  return {
    kind, name, text, pages, images, url,
    sample: kind === "text" && o.sample === true,
    pageCount: kind === "pdf" ? posInt(o.pageCount, 10_000) : null,
  };
}

/* ---------- storage --------------------------------------------------------- */

interface Row {
  id: string; kind: MaterialKind; name: string; text: string; pages: unknown; images: unknown;
  url: string | null; sample: boolean; page_count: number | null; created_at: Date | string;
}
function toMaterial(r: Row): Material {
  return {
    id: r.id, kind: r.kind, name: r.name, text: r.text || "",
    pages: Array.isArray(r.pages) ? (r.pages as MaterialPage[]) : [],
    images: Array.isArray(r.images) ? (r.images as MaterialImage[]) : [],
    url: r.url, sample: !!r.sample, pageCount: r.page_count ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}
const COLS = "id, kind, name, text, pages, images, url, sample, page_count, created_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createMaterial(m: MaterialInput): Promise<Material> {
  const rows = await query<Row>(
    `insert into blog_materials (kind, name, text, pages, images, url, sample, page_count)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8) returning ${COLS}`,
    [m.kind, m.name, m.text, jsonbParam(m.pages), jsonbParam(m.images), m.url, m.sample, m.pageCount],
  );
  return toMaterial(rows[0]);
}

/** The newest first — the panel's library and Claude's list_materials. */
export async function listMaterials(limit = 100): Promise<Material[]> {
  const rows = await query<Row>(
    `select ${COLS} from blog_materials where deleted_at is null order by created_at desc limit $1`,
    [Math.min(300, Math.max(1, limit))],
  );
  return rows.map(toMaterial);
}

export async function getMaterial(id: string): Promise<Material | null> {
  if (!UUID_RE.test(String(id || ""))) return null;
  const rows = await query<Row>(`select ${COLS} from blog_materials where id = $1 and deleted_at is null`, [id]);
  return rows.length ? toMaterial(rows[0]) : null;
}

export async function getMaterials(ids: string[]): Promise<Material[]> {
  const ok = [...new Set(ids.filter((id) => UUID_RE.test(String(id || ""))))].slice(0, 30);
  if (!ok.length) return [];
  const rows = await query<Row>(`select ${COLS} from blog_materials where id = any($1::uuid[]) and deleted_at is null`, [ok]);
  const byId = new Map(rows.map((r) => [r.id, toMaterial(r)]));
  return ok.map((id) => byId.get(id)).filter((m): m is Material => !!m);
}

/** The pictures and the name can change after the fact (more pages ticked, a better name). */
export async function updateMaterial(id: string, patch: { name?: unknown; images?: unknown }, isOurs = isOurBlogImage): Promise<Material | null> {
  const was = await getMaterial(id);
  if (!was) return null;
  const name = patch.name === undefined ? was.name : oneLine(patch.name, MATERIAL_LIMITS.name) || was.name;
  const images = patch.images === undefined || (was.kind !== "pdf" && was.kind !== "image") ? was.images : cleanImages(patch.images, isOurs);
  const rows = await query<Row>(
    `update blog_materials set name = $2, images = $3::jsonb where id = $1 and deleted_at is null returning ${COLS}`,
    [id, name, jsonbParam(images)],
  );
  return rows.length ? toMaterial(rows[0]) : null;
}

/**
 * The material's pictures some article still shows — as its cover or inside
 * any language of its text — or another material still lists. Every post
 * row counts, a deleted one too: its row stays, and a picture taken from
 * under it would be a hole the day somebody brings it back. A plain
 * substring of the stored text, not a pattern (an address may hold «%» or
 * «_»), against the address exactly as the upload answered it — which is
 * exactly how every writer of a body (the draft, the editor, Claude) stores it.
 */
export async function picturesInUse(urls: string[], exceptMaterial = ""): Promise<Set<string>> {
  const used = new Set<string>();
  for (const url of [...new Set(urls)]) {
    // …and as an HTML attribute writes it, should the address ever carry an «&»
    const asAttr = url.replace(/&/g, "&amp;");
    const rows = await query<{ n: number }>(
      `select 1 as n from posts where cover_url = $1 or position($1 in body::text) > 0 or position($3 in body::text) > 0
       union all
       select 1 as n from blog_materials where deleted_at is null and id::text <> $2 and position($1 in images::text) > 0
       limit 1`,
      [url, exceptMaterial, asAttr],
    );
    if (rows.length) used.add(url);
  }
  return used;
}

export async function deleteMaterial(id: string): Promise<boolean> {
  if (!UUID_RE.test(String(id || ""))) return false;
  const rows = await query<{ id: string }>(
    "update blog_materials set deleted_at = now() where id = $1 and deleted_at is null returning id",
    [id],
  );
  return rows.length > 0;
}

/** Every picture address the library holds — what Claude's save_draft may use besides product photos. */
export async function materialImageIndex(): Promise<Map<string, MaterialImage>> {
  const out = new Map<string, MaterialImage>();
  for (const m of await listMaterials(300)) for (const img of m.images) out.set(img.url, img);
  return out;
}

/* ---------- what the writer reads ------------------------------------------ */

/** The word stems of «о чём статья»: lower case, five letters at most, three at least. */
export function topicStems(about: string): string[] {
  const stop = new Set(["для", "как", "что", "это", "или", "при", "под", "над", "без", "все", "всё", "его", "она", "они", "про", "котор", "этого", "чтобы", "какой", "какую", "какие", "более",
    "the", "and", "for", "how", "about", "which", "their", "with", "from", "that", "this", "what", "your", "kuidas", "ning"]);
  const words = String(about || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu) || [];
  const out: string[] = [];
  for (const w of words) {
    const clean = w.replace(/[.-]+$/, "");
    if (clean.length < 3) continue;
    // five letters: «волосы», «волос», «волосам» all meet at «волос»
    const stem = clean.length > 5 ? clean.slice(0, 5) : clean;
    if (stop.has(stem) || out.includes(stem)) continue;
    out.push(stem);
  }
  return out.slice(0, 20);
}
const hitsOf = (text: string, stems: string[]) => {
  const low = text.toLowerCase();
  let n = 0;
  for (const s of stems) if (low.includes(s)) n++;
  return n;
};

/** About 15–20 thousand tokens of Russian — what one draft may read. */
export const MATERIAL_BUDGET = 45_000;

export interface SelectedText {
  /** What the model reads, material by material. */
  blocks: Array<{ material: Material; text: string; sample: boolean }>;
  /** Characters read, and characters there were. */
  used: number;
  total: number;
  trimmed: boolean;
  /** The headings of the PDF pages read, best first — the products the writer is offered start here (draftProducts). */
  headings: string[];
}

/**
 * What of the materials goes to the writer — never all 131 000 characters of
 * a 170-page catalogue. In this order, while the budget lasts:
 *
 *   1. a sample («писать так же»), cut to 4 000 characters — tone, not facts;
 *   2. from a PDF: the text pages paired with the pictures the owner ticked,
 *      then the pages whose heading or text name the topic's words (the
 *      heading counts three times), best first; the rest is left out;
 *   3. a link's or a pasted text's own text, as it is.
 *
 * `trimmed` is what the panel says out loud («взяты страницы по теме …»).
 */
export function selectMaterialText(materials: Material[], about: string, budget = MATERIAL_BUDGET): SelectedText {
  const stems = topicStems(about);
  const blocks: SelectedText["blocks"] = [];
  const headings: string[] = [];
  let used = 0;
  let total = 0;
  const room = () => Math.max(0, budget - used);

  for (const m of materials.filter((x) => x.sample)) {
    total += m.text.length;
    const t = m.text.slice(0, Math.min(4000, room()));
    if (t) { blocks.push({ material: m, text: t, sample: true }); used += t.length; }
  }
  for (const m of materials.filter((x) => !x.sample)) {
    total += m.text.length;
    if (m.kind === "pdf" && m.pages.length) {
      const picked = new Set<number>();
      for (const img of m.images) {
        if (img.page == null) continue;
        // the text page before a photo page is the one about it
        const before = m.pages.filter((p) => p.n <= img.page! && p.text.length > 40).pop();
        if (before) picked.add(before.n);
      }
      const scored = m.pages
        .filter((p) => p.text)
        .map((p) => ({ p, score: (picked.has(p.n) ? 100 : 0) + hitsOf(p.heading, stems) * 3 + hitsOf(p.text, stems) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.p.n - b.p.n);
      // nothing named the topic at all: the first pages, in order — better than nothing
      const chosen = scored.length ? scored.map((x) => x.p) : m.pages.filter((p) => p.text);
      const parts: string[] = [];
      for (const p of chosen) {
        const piece = `[стр. ${p.n}${p.heading ? " · " + p.heading : ""}]\n${p.text}`;
        if (piece.length > room() - parts.join("\n\n").length) continue;
        parts.push(piece);
        if (p.heading && !headings.includes(p.heading)) headings.push(p.heading);
      }
      // back in page order, which is how the brand wrote them
      parts.sort((a, b) => Number(a.match(/^\[стр\. (\d+)/)?.[1]) - Number(b.match(/^\[стр\. (\d+)/)?.[1]));
      const t = parts.join("\n\n");
      if (t) { blocks.push({ material: m, text: t, sample: false }); used += t.length; }
      continue;
    }
    const t = m.text.slice(0, room());
    if (t) { blocks.push({ material: m, text: t, sample: false }); used += t.length; }
  }
  return { blocks, used, total, trimmed: used < total, headings };
}

/** One page of a material's text for Claude's get_material — `part` is 1-based. */
export const MATERIAL_PART = 12_000;
export function materialPart(m: Material, part: number): { text: string; part: number; parts: number } {
  const full = m.pages.length
    ? m.pages.map((p) => `[стр. ${p.n}${p.heading ? " · " + p.heading : ""}]\n${p.text}`).join("\n\n")
    : m.text;
  const parts = Math.max(1, Math.ceil(full.length / MATERIAL_PART));
  const n = Math.min(parts, Math.max(1, Math.trunc(part) || 1));
  return { text: full.slice((n - 1) * MATERIAL_PART, n * MATERIAL_PART), part: n, parts };
}
