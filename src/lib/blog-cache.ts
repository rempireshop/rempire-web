/**
 * One save, every language at once — the blog's copies on Vercel's CDN.
 *
 * «Изменения сначала видны по-русски, английский и остальные языки
 * подтягиваются довольно медленно» — Dim, 19.09.2026, checklist item
 * `blog-cover-frame`. Every public blog answer is kept by the CDN for a
 * minute and then served stale for minutes more while it refreshes behind
 * the reader: /api/blog/ and /api/blog/<slug>/ (`max-age=60,
 * stale-while-revalidate=600`), and the request-time pages
 * /shop2/{,et/,en/}blog/[<slug>/] (`s-maxage=60, stale-while-revalidate=300`,
 * src/lib/blog-page.ts). Those are separate copies, one per address — per
 * LANGUAGE — each on its own clock, and nothing told any of them that the
 * article had changed. So the language the owner happened to open first
 * after a save could come back new and the next one old, for up to a minute,
 * and then old once more on the first visit after that. The panel's own
 * bypass (blogFetchInit in app.js) only ever covered the tab that saved, and
 * even there it only skips a copy that has already gone stale.
 *
 * Now every one of those answers is filed under one tag, and every write that
 * changes what the public can see drops the tag: all three languages of the
 * article, the lists, and every other article's page (which lists this one
 * under «Другие статьи») are fetched fresh by the next reader, from the row.
 * One tag, not one per article, on purpose — an article's page shows the
 * other articles' titles and covers, so there is no copy a save cannot touch,
 * and a blog of a few dozen pages has no blast radius worth splitting.
 *
 * How the tag works on Vercel: a function's response carries
 * `Vercel-Cache-Tag` (the CDN files the copy under it and strips the header
 * before the browser sees it), and next/cache's revalidateTag() purges the
 * tag from the CDN — https://vercel.com/docs/caching/cdn-cache/purge. Nothing
 * changes for a reader between saves: the copies are cached exactly as long
 * as before. Locally and in tests there is no CDN; the header is inert.
 *
 * Why a tag of our own and not revalidatePath() for each language's address:
 * revalidatePath() drops Next's implicit `_N_T_<path>` tags, and Next writes
 * those onto a response only when it caches the route itself (ISR —
 * build/templates/app-route.js, `if (isIsr)`). These routes are
 * force-dynamic and cached by their own Cache-Control, so no path tag ever
 * reaches their CDN copies, and a list of paths would purge nothing.
 *
 * NOT covered, and cannot be: the static /shop2/{,et/,en/}blog/<slug>/
 * index.html a build prerendered. Vercel's static layer answers those per
 * deployment and no tag reaches them; the SPA re-reads the article from
 * /api/blog/<slug>/ over the top the moment it boots (blogSyncPost in
 * app.js), which is the copy this file keeps fresh. What a crawler or a
 * reader without scripts sees there waits for the next deploy, as before.
 */
import { revalidateTag } from "next/cache";

/** The tag every public blog answer is filed under. */
export const BLOG_CACHE_TAG = "blog";

/** The response header that files it — spread into a route's headers. */
export const BLOG_CACHE_HEADERS: Readonly<Record<string, string>> = { "Vercel-Cache-Tag": BLOG_CACHE_TAG };

/**
 * Drop every cached public blog answer — call after a write the public can
 * see (an edit to a published article, a publish, an unpublish, a delete).
 * Never throws: the row is already written by the time this runs, and a save
 * must not be reported as failed because a cache could not be told about it.
 */
export function refreshBlogCache(): void {
  try {
    revalidateTag(BLOG_CACHE_TAG);
  } catch (err) {
    /* Outside a request — a script, or a test that calls a route directly —
       next/cache has no store to record the purge in and says so by
       throwing; there is no CDN there either, so there is nothing to purge. */
    if (!/store missing/.test(String((err as Error)?.message))) {
      console.error("[blog-cache] could not refresh the blog's cached pages:", err);
    }
  }
}
