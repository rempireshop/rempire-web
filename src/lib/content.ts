/**
 * `settings.content` — everything the shop says about itself, in one place.
 *
 * Before this module the company name lived in eight files, the phone number
 * in three, the opening hours nowhere at all, and two different OÜs were
 * trading on the same site (audit item 13). Every one of those strings is now
 * a field here: the footer, the announcement bar, the contact page, the legal
 * pages and the letters all read the same object, and the owner edits it in
 * «Настройки → Контент» or by asking the assistant.
 *
 * Three rules hold the design together:
 *
 *  1. **Defaults are the shipping values.** An empty database renders exactly
 *     what the site rendered before — `DEFAULT_CONTENT` is not a placeholder
 *     set, it is the current copy of the site lifted out of the templates.
 *  2. **Empty means «как было».** A blank field is not an empty footer line;
 *     it is «this one is not set», and the renderer falls back — a missing
 *     ET/EN string falls back to Russian, a blank announcement to the built-in
 *     free-shipping line, blank opening hours to no hours block at all. The
 *     same idea as `settings.hero === null`.
 *  3. **Nothing reaches the shop unsanitised.** `sanitizeContentPatch()` is the
 *     single door: it rebuilds the object field by field, so neither a
 *     prompt-injected assistant action nor a hand-written `PUT
 *     /api/admin/settings` can put HTML, a `javascript:` URL or a 4 MB string
 *     into a page that every visitor loads.
 *
 * Placeholders: the legal texts in `public/shop/legal*.js` carry
 * `{{legalName}}`, `{{regCode}}` and friends instead of a frozen company
 * identity. `resolvePlaceholders()` fills them in — the storefront does it at
 * render time, and anything server-side (prerender, mail) should call this
 * rather than reimplementing the substitution.
 */

/* ---------- shape -------------------------------------------------------- */

export const LANGS3 = ["RU", "ET", "EN"] as const;
export type Lang3 = (typeof LANGS3)[number];
export type Trilingual = Record<Lang3, string>;

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

export interface Company {
  legalName: string;
  regCode: string;
  vatNumber: string;
  address: string;
  email: string;
  phone: string;
  /** "" when the owner has not published a bank account. */
  iban: string;
  /** The bank behind the IBAN («Swedbank») — printed on company invoices next
   *  to it (src/lib/invoice-pdf.ts). "" until the owner fills it in. */
  bankName: string;
}

/** Per weekday: "" (not set), "closed", or "HH:MM–HH:MM". */
export type Hours = Record<Day, string> & { note: Trilingual };

export interface Social {
  instagram: string;
  tiktok: string;
  facebook: string;
  youtube: string;
}

export interface Announcement {
  on: boolean;
  /** The black strip above the header. Empty = the built-in shipping line. */
  text: Trilingual;
  /** Phone-width variant; empty = `text`. */
  short: Trilingual;
  /** Optional destination — a full URL, or "" for a strip that is not a link. */
  link: string;
}

export interface ShopContent {
  company: Company;
  hours: Hours;
  social: Social;
  announcement: Announcement;
  /** Intro paragraph of «Контакты»; the details below it come from `company`. */
  contactPage: Trilingual;
  /** One extra line under the legal line of every letter. Empty = none. */
  emailFooter: Trilingual;
  /** slug → replacement text. A slug that is absent keeps its built-in page. */
  legal: Record<string, Trilingual>;
}

/* ---------- defaults ----------------------------------------------------- */

function tri(ru: string, et: string, en: string): Trilingual {
  return { RU: ru, ET: et, EN: en };
}

const EMPTY: Trilingual = { RU: "", ET: "", EN: "" };

/**
 * `{EE}` / `{LV}` / `{FI}` / `{EU}` are filled in with the live free-shipping
 * thresholds by the storefront, so the default strip keeps saying the truth
 * after the shipping rules change. Owner-written text may use them too.
 */
export const DEFAULT_CONTENT: ShopContent = {
  company: {
    legalName: "Rempire Store OÜ",
    regCode: "12216136",
    vatNumber: "EE102723858",
    address: "Mardi 1, 10145 Tallinn",
    email: "info@rempireshop.com",
    phone: "+372 5623 7237",
    iban: "",
    bankName: "",
  },
  hours: {
    // Nobody has told us the salon's hours yet (docs/OPEN-QUESTIONS.md).
    // Blank is honest: no hours block until Renat fills one in.
    mon: "", tue: "", wed: "", thu: "", fri: "", sat: "", sun: "",
    note: EMPTY,
  },
  social: {
    instagram: "https://www.instagram.com/rempire.shop/",
    tiktok: "https://www.tiktok.com/@rempire.official",
    facebook: "https://www.facebook.com/Rempire.Official.Tallinn",
    youtube: "https://www.youtube.com/@rempire.official",
  },
  announcement: {
    on: true,
    text: tri(
      "Бесплатная доставка: Эстония от {EE} € · LV, LT от {LV} € · Финляндия от {FI} €",
      "Tasuta tarne: Eesti alates {EE} € · LV, LT alates {LV} € · Soome alates {FI} €",
      "Free delivery: Estonia from {EE} € · LV, LT from {LV} € · Finland from {FI} €",
    ),
    short: tri(
      "Бесплатная доставка по Эстонии от {EE} €",
      "Tasuta tarne Eestis alates {EE} €",
      "Free delivery in Estonia from {EE} €",
    ),
    link: "",
  },
  contactPage: tri(
    "Пишите или звоните — отвечаем в течение рабочего дня. По заказам, возврату и вопросам о товарах быстрее всего ответить на письмо.",
    "Kirjutage või helistage — vastame tööpäeva jooksul. Tellimuste, tagastuste ja tooteküsimuste puhul on e-kiri kõige kiirem.",
    "Write or call — we answer within the working day. For orders, returns and product questions e-mail is the fastest way to reach us.",
  ),
  emailFooter: EMPTY,
  legal: {},
};

/* ---------- limits ------------------------------------------------------- */

/** The general ceiling. Longer fields say so, one by one, below. */
export const MAX_STR = 300;
const MAX_URL = 300;
const MAX_PHONE = 30;
const MAX_CONTACT = 1200;
const MAX_LEGAL = 4000;

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s.]{1,180}(?:\.[^@\s.]{1,60}){1,4}$/;
const PHONE_RE = /^[+0-9][0-9 ()+\-.]{4,29}$/;
const REG_RE = /^[0-9]{4,20}$/;
const VAT_RE = /^[A-Z]{2}[0-9A-Z]{2,14}$/;
const HOURS_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const URL_RE = /^https?:\/\/[^\s"'<>]{3,290}$/i;

/* ---------- primitives --------------------------------------------------- */

/** One line: control characters gone, runs of space collapsed, trimmed, cut. */
function line(v: unknown, max = MAX_STR): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * A paragraph. Newlines survive (the contact page and a legal override are
 * written as prose), everything that could be read as markup does not — these
 * strings are inserted as text, and the one rule that must hold is that they
 * cannot stop being text.
 */
function para(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (ch) => (ch === "\n" ? "\n" : " "))
    .replace(/[<>]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function url(v: unknown): string {
  const s = line(v, MAX_URL);
  return URL_RE.test(s) ? s : "";
}

function email(v: unknown): string {
  const s = line(v, 190).toLowerCase();
  return EMAIL_RE.test(s) ? s : "";
}

function phone(v: unknown): string {
  const s = line(v, MAX_PHONE);
  return PHONE_RE.test(s) ? s : "";
}

/** Registration / KMKR codes are identifiers, not free text. */
function regCode(v: unknown): string {
  const s = line(v, 24).replace(/[\s-]/g, "");
  return REG_RE.test(s) ? s : "";
}

function vatNumber(v: unknown): string {
  const s = line(v, 24).replace(/[\s-]/g, "").toUpperCase();
  return VAT_RE.test(s) ? s : "";
}

/** IBAN as printed: letters, digits, optional spaces. */
function iban(v: unknown): string {
  const s = line(v, 42).toUpperCase();
  return /^[A-Z]{2}[0-9A-Z ]{10,40}$/.test(s) ? s.replace(/\s+/g, " ") : "";
}

/**
 * One weekday. "" (unset), "closed", or "HH:MM–HH:MM" — a hyphen or any dash
 * is accepted and normalised to the en dash the site prints.
 */
export function sanitizeHours(v: unknown): string {
  const s = line(v, 20).toLowerCase();
  if (!s) return "";
  if (/^(closed|suletud|выходной|закрыто|zakryto)$/.test(s)) return "closed";
  const m = s.split(/\s*[–—−-]\s*/);
  if (m.length !== 2) return "";
  if (!HOURS_RE.test(m[0]) || !HOURS_RE.test(m[1])) return "";
  return `${m[0]}–${m[1]}`;
}

/**
 * A trilingual field. Only the languages actually sent are rebuilt, so a patch
 * carrying `{RU: "…"}` does not wipe the Estonian the owner wrote last week.
 */
function triPatch(
  raw: unknown,
  max: number,
  prose = false,
): Partial<Trilingual> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Partial<Trilingual> = {};
  let seen = false;
  for (const lang of LANGS3) {
    if (!(lang in src)) continue;
    seen = true;
    out[lang] = prose ? para(src[lang], max) : line(src[lang], max);
  }
  return seen ? out : null;
}

/* ---------- the door ----------------------------------------------------- */

export type ContentPatch = {
  company?: Partial<Company>;
  hours?: Partial<Record<Day, string>> & { note?: Partial<Trilingual> };
  social?: Partial<Social>;
  announcement?: {
    on?: boolean;
    text?: Partial<Trilingual>;
    short?: Partial<Trilingual>;
    link?: string;
  };
  contactPage?: Partial<Trilingual>;
  emailFooter?: Partial<Trilingual>;
  legal?: Record<string, Partial<Trilingual>>;
};

const LEGAL_SLUGS = ["shipping", "returns", "terms", "contact", "privacy"];

/**
 * Everything a caller is allowed to change, rebuilt key by key. Absent keys
 * stay absent (this is a patch, not a document), invalid values are dropped
 * rather than corrected, and anything unrecognised never appears in the
 * result. Returns null when the patch changes nothing.
 */
export function sanitizeContentPatch(raw: unknown): ContentPatch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: ContentPatch = {};

  /* --- company --- */
  if (src.company && typeof src.company === "object" && !Array.isArray(src.company)) {
    const c = src.company as Record<string, unknown>;
    const co: Partial<Company> = {};
    if ("legalName" in c) co.legalName = line(c.legalName, 120);
    if ("regCode" in c) co.regCode = regCode(c.regCode);
    if ("vatNumber" in c) co.vatNumber = vatNumber(c.vatNumber);
    if ("address" in c) co.address = line(c.address, 200);
    if ("email" in c) co.email = email(c.email);
    if ("phone" in c) co.phone = phone(c.phone);
    if ("iban" in c) co.iban = iban(c.iban);
    if ("bankName" in c) co.bankName = line(c.bankName, 60);
    // a blank company name would erase the shop's identity from every page
    if (co.legalName === "") delete co.legalName;
    if (Object.keys(co).length) out.company = co;
  }

  /* --- hours --- */
  if (src.hours && typeof src.hours === "object" && !Array.isArray(src.hours)) {
    const h = src.hours as Record<string, unknown>;
    const ho: Partial<Record<Day, string>> & { note?: Partial<Trilingual> } = {};
    for (const d of DAYS) if (d in h) ho[d] = sanitizeHours(h[d]);
    const note = triPatch(h.note, MAX_STR);
    if (note) ho.note = note;
    if (Object.keys(ho).length) out.hours = ho;
  }

  /* --- social --- */
  if (src.social && typeof src.social === "object" && !Array.isArray(src.social)) {
    const s = src.social as Record<string, unknown>;
    const so: Partial<Social> = {};
    for (const k of ["instagram", "tiktok", "facebook", "youtube"] as const) {
      if (k in s) so[k] = url(s[k]);
    }
    if (Object.keys(so).length) out.social = so;
  }

  /* --- announcement --- */
  if (src.announcement && typeof src.announcement === "object" && !Array.isArray(src.announcement)) {
    const a = src.announcement as Record<string, unknown>;
    const an: NonNullable<ContentPatch["announcement"]> = {};
    if (typeof a.on === "boolean") an.on = a.on;
    const text = triPatch(a.text, MAX_STR);
    if (text) an.text = text;
    const short = triPatch(a.short, 120);
    if (short) an.short = short;
    if ("link" in a) an.link = url(a.link);
    if (Object.keys(an).length) out.announcement = an;
  }

  /* --- pages --- */
  const contact = triPatch(src.contactPage, MAX_CONTACT, true);
  if (contact) out.contactPage = contact;
  const foot = triPatch(src.emailFooter, MAX_STR);
  if (foot) out.emailFooter = foot;

  /* --- legal overrides --- */
  if (src.legal && typeof src.legal === "object" && !Array.isArray(src.legal)) {
    const l = src.legal as Record<string, unknown>;
    const lo: Record<string, Partial<Trilingual>> = {};
    for (const slug of LEGAL_SLUGS) {
      if (!(slug in l)) continue;
      const t = triPatch(l[slug], MAX_LEGAL, true);
      // an explicit {} — or a slug whose every language is blank — means
      // «вернуть встроенный текст», which merge() honours by dropping it
      lo[slug] = t ?? {};
    }
    if (Object.keys(lo).length) out.legal = lo;
  }

  return Object.keys(out).length ? out : null;
}

/* ---------- merge -------------------------------------------------------- */

function mergeTri(base: Trilingual, patch?: Partial<Trilingual>): Trilingual {
  if (!patch) return { ...base };
  return {
    RU: patch.RU ?? base.RU,
    ET: patch.ET ?? base.ET,
    EN: patch.EN ?? base.EN,
  };
}

/**
 * Stored value + defaults → the document every reader gets. The stored value
 * goes through the sanitiser on the way in, so a row hand-edited in the
 * database cannot serve HTML to a shopper either.
 */
export function mergeContent(...patches: Array<unknown>): ShopContent {
  let out: ShopContent = {
    company: { ...DEFAULT_CONTENT.company },
    hours: { ...DEFAULT_CONTENT.hours, note: { ...DEFAULT_CONTENT.hours.note } },
    social: { ...DEFAULT_CONTENT.social },
    announcement: {
      ...DEFAULT_CONTENT.announcement,
      text: { ...DEFAULT_CONTENT.announcement.text },
      short: { ...DEFAULT_CONTENT.announcement.short },
    },
    contactPage: { ...DEFAULT_CONTENT.contactPage },
    emailFooter: { ...DEFAULT_CONTENT.emailFooter },
    legal: {},
  };

  for (const raw of patches) {
    const p = sanitizeContentPatch(raw);
    if (!p) continue;
    out = {
      company: { ...out.company, ...p.company },
      hours: (() => {
        const h: Hours = { ...out.hours, note: mergeTri(out.hours.note, p.hours?.note) };
        for (const d of DAYS) if (p.hours && d in p.hours) h[d] = p.hours[d] as string;
        return h;
      })(),
      social: { ...out.social, ...p.social },
      announcement: {
        on: p.announcement?.on ?? out.announcement.on,
        text: mergeTri(out.announcement.text, p.announcement?.text),
        short: mergeTri(out.announcement.short, p.announcement?.short),
        link: p.announcement?.link ?? out.announcement.link,
      },
      contactPage: mergeTri(out.contactPage, p.contactPage),
      emailFooter: mergeTri(out.emailFooter, p.emailFooter),
      legal: (() => {
        const l: Record<string, Trilingual> = { ...out.legal };
        for (const [slug, t] of Object.entries(p.legal ?? {})) {
          const next = mergeTri(l[slug] ?? EMPTY, t);
          // every language blank = no override, so the built-in page comes back
          if (next.RU || next.ET || next.EN) l[slug] = next;
          else delete l[slug];
        }
        return l;
      })(),
    };
  }
  return out;
}

/* ---------- readers ------------------------------------------------------ */

/** The text in the asked-for language, falling back to Russian. */
export function pickLang(t: Trilingual | undefined, lang: string): string {
  if (!t) return "";
  const key = String(lang).toUpperCase();
  const l = (LANGS3 as readonly string[]).includes(key) ? (key as Lang3) : "RU";
  return t[l] || t.RU || "";
}

const PLACEHOLDERS = [
  "legalName",
  "regCode",
  "vatNumber",
  "address",
  "email",
  "phone",
  "iban",
  "bankName",
] as const;

/**
 * `{{legalName}}` and friends → the current company details. Used by the
 * storefront on the legal pages, and available to anything server-side that
 * renders the same texts (prerender, mail).
 */
export function resolvePlaceholders(text: string, content: ShopContent): string {
  if (!text || text.indexOf("{{") < 0) return text;
  return text.replace(/\{\{([a-zA-Z]{1,20})\}\}/g, (whole, key: string) => {
    return (PLACEHOLDERS as readonly string[]).includes(key)
      ? content.company[key as (typeof PLACEHOLDERS)[number]]
      : whole;
  });
}

/**
 * What the admin assistant is told about the shop it is editing. Trimmed hard:
 * it is the owner's own text coming back through a browser and landing inside
 * a prompt, so nothing here may look like structure.
 */
export function briefContent(content: ShopContent): string {
  const clean = (v: string, max = 120) =>
    String(v || "").replace(/[`\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const c = content.company;
  const days = DAYS.filter((d) => content.hours[d]).map((d) => `${d} ${content.hours[d]}`);
  const socials = (Object.keys(content.social) as Array<keyof Social>)
    .filter((k) => content.social[k])
    .map((k) => k);
  const ann = content.announcement;
  return [
    `company: ${clean(c.legalName)} | reg ${clean(c.regCode, 20)} | KMKR ${clean(c.vatNumber, 20)}`,
    `address: ${clean(c.address)}`,
    `email: ${clean(c.email)} | phone: ${clean(c.phone, 30)}`,
    `hours: ${days.length ? days.join(", ") : "(not set)"}`,
    `social: ${socials.length ? socials.join(", ") : "(none)"}`,
    `announcement: ${ann.on ? "on" : "off"} | RU "${clean(ann.text.RU, 140)}"`,
    `contact page RU: "${clean(content.contactPage.RU, 160)}"`,
  ].join("\n");
}
