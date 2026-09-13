/**
 * Which language the admin assistant answers in.
 *
 * Dim, 13.09.2026 (Renat's acceptance run): «I am asking in english which
 * orders are waiting to be shipped and get russian answer». He typed English
 * into a Russian panel, and the prompt said, word for word, «Answer in
 * Russian» — because the language it was given was `S.lang`, the panel's own
 * language setting. The assistant did exactly what it was told.
 *
 * THE RULE, settled here: **the assistant answers in the language of the
 * question; when the question's own words do not say which language that is,
 * it answers in the panel's language.**
 *
 * Why this way round:
 *   · the panel's language is a setting about LABELS. It is chosen once and
 *     then left alone for months. The language the owner has just typed in is
 *     a live statement about the language he is reading in right now;
 *   · there is no version of «always the panel's language» that fixes what he
 *     hit. He wrote English, the panel was Russian, and any rule that ignores
 *     the question answers him in Russian again;
 *   · the worst case is bounded. A question whose language cannot be read —
 *     «Proraso 30 ml», «R-10042», «?» — falls back to the panel's language,
 *     which is precisely today's behaviour. So this can only ever agree with
 *     the old rule or improve on it, never do worse;
 *   · and it is decided HERE, in code, rather than left to the model. The
 *     model's own instinct is what produced the bug: it was told «Answer in
 *     Russian» and obeyed. A prompt is a request (the same reasoning as
 *     ./intent.ts). We read the language, then tell it which one.
 *
 * Deliberately NOT applied to the storefront chat (shopPrompt in ./route.ts):
 * there the customer has picked the site's language and the whole page around
 * the chat is written in it, so the site's language is the right answer and
 * the existing «ALWAYS answer in X» stands.
 *
 * No imports: a pure function over one string, tested without a network or a
 * database (tests/assistant-reply-lang.test.ts) — the same posture as
 * ./intent.ts and ./actions.ts.
 */

export type Lang3 = "RU" | "ET" | "EN";

/** A Cyrillic word of two letters or more — «в» alone is a typo, «вы» is Russian. */
const CYRILLIC_WORD = /[Ѐ-ӿ]{2,}/;

/* Estonian function words, and the shop words the owner actually types. Every
   one of them is checked against English first: «on», «see», «need», «tee»,
   «all» and «kit» are Estonian words that are ALSO ordinary English words, so
   none of them is in this list — a word that could be either is no evidence.
   The Estonian letters õ ä ö ü š ž are a second, weaker signal below. */
const ET_WORDS = new Set([
  "kas", "mis", "mida", "kes", "kus", "kuidas", "miks", "mitu", "kui", "palju",
  "milline", "millised", "minu", "mul", "mulle", "meie", "meil", "sinu", "teie",
  "ei", "ja", "või", "aga", "siis", "veel", "praegu", "täna", "homme", "eile",
  "kõik", "midagi", "palun", "vaja", "peab", "saab", "teha", "olen", "oleme",
  "tellimus", "tellimused", "tellimusi", "tellimust", "toode", "tooted", "tooteid",
  "laos", "otsas", "saatmist", "saatmise", "ootavad", "ootab", "näita", "näidake",
  "lisa", "muuda", "kirjuta", "saada", "hind", "hinda", "hinnad", "klient",
  "kliendid", "pood", "poes", "kaup", "kaupa", "üks", "kaks", "kolm", "raha",
  "müük", "müügi", "arve", "arved", "soodus", "sooduskood", "komplekt",
]);

/* English function words, and the same shop words in English. None of them is
   an Estonian word — that is the whole test for being on this list. */
const EN_WORDS = new Set([
  "what", "which", "who", "where", "when", "why", "how", "many", "much",
  "is", "are", "was", "were", "the", "this", "these", "those", "that",
  "and", "or", "but", "with", "for", "from", "of", "to", "into", "about",
  "my", "me", "mine", "our", "your", "you", "i", "it",
  "show", "tell", "give", "make", "add", "change", "write", "send", "open",
  "need", "want", "please", "can", "could", "should", "would", "do", "does",
  "did", "have", "has", "get", "put", "set",
  "order", "orders", "product", "products", "stock", "shipped", "shipping",
  "shipment", "waiting", "running", "low", "price", "prices", "customer",
  "customers", "sale", "sales", "today", "tomorrow", "yesterday", "week",
  "month", "revenue", "report", "article", "post", "discount", "coupon",
]);

/** õ ä ö ü š ž — Estonian's own letters, none of which English has. */
const ET_LETTERS = /[õäöüšž]/i;

/** Words, lower-cased, Latin and Cyrillic alike; digits and punctuation gone. */
function words(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
}

/**
 * The language to answer one message in.
 *
 * `panel` is the fallback — the panel's own language, what the route used to
 * use unconditionally — and it is what comes back whenever the message itself
 * says nothing about its language.
 *
 * Russian is decided by script and nothing else: this shop's brands and
 * product ids are Latin («Proraso», «kevin-muprhy-plumping-wash»), so a
 * Russian sentence routinely carries Latin words, while an English or Estonian
 * one never carries a Cyrillic one. One Cyrillic word of two letters or more
 * is therefore enough, and it is checked first.
 */
export function answerLang(message: unknown, panel: Lang3): Lang3 {
  const s = typeof message === "string" ? message : "";
  if (!s.trim()) return panel;
  if (CYRILLIC_WORD.test(s)) return "RU";

  let et = 0;
  let en = 0;
  for (const w of words(s)) {
    if (ET_WORDS.has(w)) et++;
    if (EN_WORDS.has(w)) en++;
  }
  if (et > en) return "ET";
  if (en > et) return "EN";
  // no function word either way (or exactly as many of each): the Estonian
  // letters are the last piece of evidence, and then the panel's own language
  if (ET_LETTERS.test(s)) return "ET";
  return panel;
}
