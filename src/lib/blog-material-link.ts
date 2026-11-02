/**
 * A material from a public address — one road for the panel's «Ссылка»
 * (POST /api/admin/blog/materials/ {kind:"link"}) and for Renat's Claude
 * (save_material with `url`, src/lib/mcp/tools.ts). Dim, 02.11.2026: Claude
 * in a chat can see the files Renat attaches but cannot hand their bytes to a
 * tool, so a PDF or a photo that is on the internet is fetched by the shop.
 *
 *   a page   its text (src/lib/safe-fetch.ts htmlToText) — kind "link", as before;
 *   a PDF    its text page by page, read here (src/lib/pdf-text.ts), never
 *            stored as a file — kind "pdf", no pictures (those need the phone:
 *            the panel reads a PDF's photo pages in the browser);
 *   a photo  re-encoded the way an upload is (src/lib/images.ts) into this
 *            shop's bucket under blog/ — kind "image".
 *
 * Every one goes through the SSRF guard, under its own size cap, and is
 * named by its HOST unless the caller names it: a page's title, a PDF's file
 * name and a photo's name are a stranger's words, and a name goes into the
 * Помощник's prompt and Claude's tool output (security review, 02.11.2026).
 * The address it came from stays on the row (`url`), and that is what has it
 * read as a third party's text everywhere (fromInternet).
 */
import { createMaterial, MaterialError, readMaterialInput, type Material, type MaterialKind } from "@/lib/blog-materials";
import { ImageError, processImage } from "@/lib/images";
import { pdfPages, PdfTextError } from "@/lib/pdf-text";
import { fetchPublicFile, SafeFetchError, type PublicFile } from "@/lib/safe-fetch";
import { mediaKey, publicUrl, putObject, storageConfigured, thumbKey } from "@/lib/storage";

export interface LinkMaterial {
  material: Material;
  host: string;
  /** What was at the address. */
  found: "page" | "pdf" | "image";
}

/** A refusal's code, one family per stage: link_* (the fetch), pdf_* (the reading), image_*, storage_not_configured. */
export class LinkMaterialError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function materialFromLink(
  rawUrl: string,
  opts: { name?: unknown; fetch?: (url: string) => Promise<PublicFile> } = {},
): Promise<LinkMaterial> {
  let file: PublicFile;
  try {
    file = await (opts.fetch ?? fetchPublicFile)(String(rawUrl || ""));
  } catch (err) {
    if (err instanceof SafeFetchError) throw new LinkMaterialError("link_" + err.code);
    throw err;
  }
  const host = new URL(file.url).hostname.replace(/^www\./, "");
  const named = typeof opts.name === "string" && opts.name.trim() ? opts.name : "";
  const save = async (kind: MaterialKind, fields: Record<string, unknown>) => {
    try {
      return await createMaterial(readMaterialInput({ kind, url: file.url, ...fields }));
    } catch (err) {
      if (err instanceof MaterialError) throw new LinkMaterialError(err.code === "empty" ? "link_empty" : err.code);
      throw err;
    }
  };

  if (file.kind === "page") {
    const material = await save("link", { name: named || host, text: file.text });
    return { material, host, found: "page" };
  }

  if (file.kind === "pdf") {
    let read;
    try {
      read = await pdfPages(file.bytes);
    } catch (err) {
      if (err instanceof PdfTextError) throw new LinkMaterialError("pdf_" + err.code);
      throw err;
    }
    const material = await save("pdf", { name: named || `${host} · PDF`, pages: read.pages, pageCount: read.pageCount });
    return { material, host, found: "pdf" };
  }

  if (!storageConfigured()) throw new LinkMaterialError("storage_not_configured");
  let img;
  try {
    img = await processImage(file.bytes);
  } catch (err) {
    if (err instanceof ImageError) throw new LinkMaterialError("image_" + err.code);
    throw err;
  }
  const key = mediaKey("blog", "link-" + host, null);
  const put = await putObject({ key, body: img.main, contentType: "image/webp" });
  await putObject({ key: thumbKey(key), body: img.thumb, contentType: "image/webp" });
  const material = await save("image", {
    name: named || `${host} · фото`,
    images: [{ id: "l1", url: put.url || publicUrl(key), w: img.width, h: img.height, page: null, label: host }],
  });
  return { material, host, found: "image" };
}

/** The panel's sentence for a refusal (bnewPostMaterial in public/shop2/app.js reads the same codes). */
export function linkErrorText(code: string): string {
  if (code === "link_not_https") return "Нужен адрес, который начинается с https://";
  if (code === "link_private_address" || code === "link_private_host" || code === "link_ip_host") return "Этот адрес читать нельзя — только открытые страницы в интернете.";
  if (code === "link_too_large") return "Файл по ссылке слишком большой: страница — до 2 МБ, PDF — до 20 МБ, фото — до 12 МБ.";
  if (code === "link_not_text" || code === "link_not_file") return "По этой ссылке не страница, не PDF и не фото.";
  if (code === "pdf_encrypted") return "PDF защищён паролем — его не прочитать.";
  if (code === "pdf_no_text" || code === "pdf_unreadable") return "В этом PDF нет текста, который можно прочитать (похоже на скан).";
  if (/^pdf_/.test(code)) return "PDF не получилось прочитать.";
  if (code === "storage_not_configured") return "Фото сохранить нельзя: хранилище фото не подключено.";
  if (/^image_/.test(code)) return "Фото по ссылке не получилось прочитать.";
  return "Страницу не получилось прочитать.";
}
