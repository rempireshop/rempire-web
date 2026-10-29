/**
 * «Что поправить на сайте» — the weekly letter about the shop's own content.
 *
 * Dim, 29.10.2026, before the handover: alerts reach him when something is
 * broken (GitHub and Vercel mail him a red check or a failed build); what is
 * merely not right — the owner's own words and choices — should not turn a
 * check red, and should not go unnoticed either. So once a week the daily cron
 * (runFlows, src/lib/flows.ts) looks for the things a panel edit can leave
 * behind and, when there is anything, writes one letter in Russian to the
 * shop's mailbox (RESEND_TO) with a copy to Dim (DEV_ALERT_TO, by default
 * info@diipsolutions.eu):
 *
 *   · Russian left in an Estonian or English description or Google text —
 *     saved before 29.10.2026, when the panel started refusing it (the soap
 *     and T-shirt texts of 27.10);
 *   · a set on sale that cannot be assembled — a part hidden or sold out
 *     (the Yumain line, 28.10);
 *   · a published article with no Estonian or English title — those pages
 *     show the Russian one;
 *   · an own product on sale with no photo — the shop shows the tower.
 *
 * Read-only. Never throws: a report that cannot be made is a report that does
 * not go out, logged. Nothing at all goes out in a week with nothing to say.
 */
import catalogueMin from "@/data/catalogue.min.json";
import { seoOffLanguage } from "@/lib/ai-prompts";
import { listBundles } from "@/lib/bundles";
import { listAllPosts } from "@/lib/blog";
import { listCustomProducts } from "@/lib/custom-products";
import { shopDay } from "@/lib/day";
import { sendMail } from "@/lib/mail";
import { getSettingRaw, setSetting } from "@/lib/orders";
import { getDescriptionOverrides } from "@/lib/product-descriptions";
import { getSeoOverrides } from "@/lib/product-seo";

export type ContentIssue = {
  kind: "desc_language" | "seo_language" | "set_cannot_assemble" | "post_untranslated" | "own_no_photo";
  /** A product id, a set id or a post slug. */
  id: string;
  /** What Renat recognises it by, in Russian. */
  name: string;
  /** The language or the part concerned. */
  detail: string;
};

type Min = { id: string; n: string; b: string };
const CATALOGUE = catalogueMin as Min[];
const nameOf = (id: string) => {
  const p = CATALOGUE.find((x) => x.id === id);
  return p ? `${p.b} ${p.n}` : id;
};
const whoOf = (id: string) => {
  const p = CATALOGUE.find((x) => x.id === id);
  return { name: p?.n ?? "", brand: p?.b ?? "" };
};
const LANG_RU: Record<string, string> = { ET: "эстонском", EN: "английском" };

/** Everything worth a line in the letter, today. */
export async function contentIssues(): Promise<ContentIssue[]> {
  const out: ContentIssue[] = [];

  const [descs, seos, sets, posts, own] = await Promise.all([
    getDescriptionOverrides(),
    getSeoOverrides(),
    listBundles({ activeOnly: true }),
    listAllPosts(),
    listCustomProducts({ activeOnly: true }),
  ]);
  const ownById = new Map(own.map((c) => [c.id, c]));
  const who = (id: string) => (ownById.has(id) ? { name: ownById.get(id)!.name, brand: ownById.get(id)!.brand } : whoOf(id));
  const label = (id: string) => (ownById.has(id) ? `${ownById.get(id)!.brand} ${ownById.get(id)!.name}`.trim() : nameOf(id));

  for (const [id, d] of Object.entries(descs)) {
    for (const lang of ["ET", "EN"] as const) {
      const text = d?.[lang];
      if (text && seoOffLanguage(text, lang, who(id))) out.push({ kind: "desc_language", id, name: label(id), detail: lang });
    }
  }
  for (const [id, s] of Object.entries(seos)) {
    for (const lang of ["ET", "EN"] as const) {
      const text = [s?.[lang]?.title, s?.[lang]?.desc].filter(Boolean).join("\n");
      if (text && seoOffLanguage(text, lang, who(id))) out.push({ kind: "seo_language", id, name: label(id), detail: lang });
    }
  }
  for (const b of sets) {
    if (b.stock !== "out") continue;
    const gone = b.items.filter((it) => (it as { stock?: string }).stock === "out").map((it) => nameOf(it.productId));
    out.push({ kind: "set_cannot_assemble", id: b.id, name: b.title.RU, detail: gone.join(", ") });
  }
  for (const p of posts) {
    if (p.status !== "published") continue;
    const missing = (["ET", "EN"] as const).filter((l) => !String(p.title?.[l] ?? "").trim());
    if (missing.length) out.push({ kind: "post_untranslated", id: p.slug, name: p.title?.RU || p.slug, detail: missing.join(", ") });
  }
  for (const c of own) {
    if (!(c.gallery ?? []).length) out.push({ kind: "own_no_photo", id: c.id, name: `${c.brand} ${c.name}`.trim(), detail: "" });
  }
  return out;
}

/** The letter, in Russian — what is wrong and where to put it right. */
export function contentLetter(issues: ContentIssue[]): { subject: string; text: string } {
  const by = (k: ContentIssue["kind"]) => issues.filter((i) => i.kind === k);
  const block = (head: string, list: ContentIssue[], line: (i: ContentIssue) => string) =>
    list.length ? [head, ...list.map((i) => "  — " + line(i)), ""] : [];
  const text = [
    "Еженедельная проверка сайта. Всё ниже работает, но выглядит не так, как задумано.",
    "",
    ...block("Русские слова в эстонском или английском описании (Товары → товар → «Описание»):", by("desc_language"),
      (i) => `${i.name} — в ${LANG_RU[i.detail]} тексте`),
    ...block("Русские слова в тексте для Google (Товары → товар → «Для Google»):", by("seo_language"),
      (i) => `${i.name} — в ${LANG_RU[i.detail]} тексте`),
    ...block("Наборы, которые сейчас не собрать — покупатель видит «нет в наличии» (Товары → Наборы):", by("set_cannot_assemble"),
      (i) => `«${i.name}»${i.detail ? ": нет — " + i.detail : ""}. Верните товар или выключите набор.`),
    ...block("Статьи без эстонского или английского заголовка — там показан русский (Блог):", by("post_untranslated"),
      (i) => `«${i.name}» — нет: ${i.detail}`),
    ...block("Свои товары без фото — в магазине вместо фото башня (Товары → товар → «Фото»):", by("own_no_photo"),
      (i) => i.name),
    "Письмо приходит раз в неделю, только если есть что поправить.",
  ].join("\n");
  return { subject: `REMPIRE — что поправить на сайте: ${issues.length}`, text };
}

/** Where the copy goes: Dim's support address (29.10.2026), unless set otherwise. */
const devAlertTo = () => (process.env.DEV_ALERT_TO ?? "info@diipsolutions.eu").trim();

/**
 * Once a week, on Monday (the shop's own day, src/lib/day.ts), and once only
 * however often the cron runs that day: the week's mark is a settings row.
 */
export async function runContentReport(now: number = Date.now()): Promise<{ sent: boolean; issues: number; reason?: string }> {
  try {
    const day = shopDay(now);
    if (new Date(day + "T12:00:00Z").getUTCDay() !== 1) return { sent: false, issues: 0, reason: "not_monday" };
    const mark = await getSettingRaw("content_report_day");
    if (mark.found && mark.value === day) return { sent: false, issues: 0, reason: "already" };
    const issues = await contentIssues();
    await setSetting("content_report_day", day);
    if (!issues.length) return { sent: false, issues: 0, reason: "nothing" };
    const { subject, text } = contentLetter(issues);
    const to = [(process.env.RESEND_TO ?? "").trim(), devAlertTo()].filter(Boolean);
    const res = await sendMail({ to, subject, text, tags: { template: "content-report" } });
    return { sent: !!res.ok, issues: issues.length, reason: res.ok ? undefined : res.error };
  } catch (err) {
    console.error("[content-report] could not be made:", err);
    return { sent: false, issues: 0, reason: "error" };
  }
}
