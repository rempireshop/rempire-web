/**
 * «Набор» or «промокод» — telling the two apart before the model gets to guess.
 *
 * Dim, 07.09.2026: «The "Beardset50" code was done by the assistant, although
 * I wanted to create an item set.» He asked for a SET and got a live promo
 * code. The words really do collide in the shop's own Russian:
 *
 *   · набор / комплект  — several products sold together at one price. It is
 *     a row in `bundles`, it has its own page in the shop, and the assistant
 *     reaches it with `propose_bundle` / `set_bundle`.
 *   · промокод / купон / код — a discount the customer types in the cart. It
 *     is a row in `promos`, it applies to the whole basket, and the assistant
 *     reaches it with `create_promo`.
 *
 * …and both of them are «сделай скидку на несколько товаров» in plain speech.
 * The shop has no third thing — no "discount on these three products" — so a
 * sentence that means one of the two and names neither is genuinely
 * ambiguous, and the only right answer is a question.
 *
 * This module is the deterministic half of the fix: a pure function over the
 * owner's own sentence, with no model in the loop, so the route can (a) tell
 * the model which of the two it is looking at and (b) refuse an action that
 * contradicts the words the owner actually used. The prompt does the rest —
 * but a prompt is a request, and a live promo code the owner never asked for
 * is worse than a question, so the refusal is code.
 *
 * No imports on purpose: tested as a pure function (tests/assistant-intent.test.ts),
 * same posture as sanitizeAction()'s own file.
 */

/**
 * What the owner's last message is about:
 *   "bundle" — it says «набор»/«комплект»: a promo code is the wrong answer.
 *   "promo"  — it says «промокод»/«купон»/«код»: a set is the wrong answer.
 *   "ask"    — it could be either (both words, or neither and a discount over
 *              several products): the assistant must ask, not choose.
 *   ""       — not about this at all; the model decides as before.
 */
export type DiscountIntent = "bundle" | "promo" | "ask" | "";

/* Cyrillic letters are not `\w`, so `\b` is useless here: «набор» inside
   «наборе» must match, «код» inside «штрихкод» must not. These two fragments
   are the boundary — a non-letter (or the edge) before, no letter after the
   stem plus its own ending. */
const BEFORE = "(?:^|[^\\p{L}])";
const AFTER = "(?![\\p{L}])";
const word = (body: string) => new RegExp(BEFORE + "(?:" + body + ")" + AFTER, "iu");

/** «набор», «наборчик», «в комплекте», «kit», «komplekt», «set» — a set, in three languages. */
export const SET_WORDS = word(
  "набор\\p{L}*|наборчик\\p{L}*|комплект\\p{L}*|сет|сета|сету|сетом|сеты|сетов|" +
  "komplekt\\p{L}*|pakett\\p{L}*|bundle\\p{L}*|kit|kits|set|sets",
);

/* «продавать вместе», «одной ценой» — a set named without the word. Kept
   deliberately short: «вместе» on its own is in far too many sentences. */
export const SET_PHRASES =
  /(?:продава\p{L}*|прода[йтю]\p{L}*|отдава\p{L}*|отда[йтю]\p{L}*)(?:\s+[\p{L}\p{N}]+){0,4}\s+вместе|одн(?:ой|ою)\s+ценой|в\s+одну\s+цену|одним\s+лотом/iu;

/** «промокод», «купон», «код на скидку», «kupong», «sooduskood», «coupon». */
export const PROMO_WORDS = word(
  "промокод\\p{L}*|промо-?код\\p{L}*|купон\\p{L}*|код\\p{L}*|" +
  "sooduskood\\p{L}*|kupong\\p{L}*|promo|promos|promocode\\p{L}*|coupon\\p{L}*|voucher\\p{L}*",
);

/** Anything that makes the sentence about a price coming down. */
const DISCOUNT =
  /скидк|скидо[кч]|дешевл|подешевле|уценк|распродаж|процент|%|снизь\s+цен|снизить\s+цен|сбрось\s+цен|allahindlus|soodus|discount/iu;

/**
 * «на несколько товаров», «на эти три», «на пару позиций» — the discount is
 * over more than one product, which is exactly where the two mechanisms
 * collide. One product («скидка на масло Proraso») is neither: that is
 * set_price, and it is not this module's business.
 */
const SEVERAL =
  /нескольк\p{L}*\s+(?:товар|позици|штук|вещ)|пар[уые]\s+(?:товар|позици|штук)|(?:дв[ае]|двух|три|трёх|трех|четыре|четырёх|четырех|пять|пяти|[2-9])\s+товар|(?:дв[ае]|двух|три|трёх|трех|четыре|четырёх|четырех|[2-9])\s+(?:позици|штук|разных)|эт(?:и|их)\s+(?:товар|позици|три|две|два)|групп\p{L}*\s+товар|сразу\s+на\s+нескольк|на\s+все\s+эти/iu;

/**
 * The owner's own sentence → which of the two he means.
 *
 * Both words in one sentence is «ask», not «promo»: «сделай промокод на
 * наборы» can be a code that works on sets *or* a discounted set, and the
 * shop cannot scope a code to a category anyway — so the one extra question
 * is cheaper than either wrong guess.
 */
export function discountIntent(message: unknown): DiscountIntent {
  const s = typeof message === "string" ? message : "";
  if (!s.trim()) return "";
  const set = SET_WORDS.test(s) || SET_PHRASES.test(s);
  const promo = PROMO_WORDS.test(s);
  if (set && promo) return "ask";
  if (set) return "bundle";
  if (promo) return "promo";
  if (DISCOUNT.test(s) && SEVERAL.test(s)) return "ask";
  return "";
}

/* The three actions the collision actually bites on. The two switches —
   `toggle_promo` («выключи промокод SUVI10») and `toggle_bundles` («скрой
   наборы») — are deliberately NOT here: they change nothing that did not
   already exist, the owner named the thing he is switching, and a wrong one
   is visible and one tap away from being put back. Creating is the dangerous
   direction, and that is what is guarded. */
const BUNDLE_WRITES = new Set(["propose_bundle", "set_bundle"]);
const PROMO_WRITES = new Set(["create_promo"]);

/**
 * True when the action the model chose contradicts the words the owner used —
 * the route then drops the action and asks which of the two he meant.
 *
 * The asymmetry is deliberate and is the whole point: a `create_promo` for a
 * sentence that said «набор» is Dim's own bug, and it lands a live discount
 * code in the shop. A `propose_bundle` for a sentence that said «промокод»
 * only opens the set editor — still wrong, still refused, because a question
 * costs the owner one tap and a wrong guess costs him trust.
 */
export function intentConflicts(intent: DiscountIntent, actionType: unknown): boolean {
  const t = typeof actionType === "string" ? actionType : "";
  if (!t) return false;
  if (intent === "ask") return BUNDLE_WRITES.has(t) || PROMO_WRITES.has(t);
  if (intent === "bundle") return PROMO_WRITES.has(t);
  if (intent === "promo") return BUNDLE_WRITES.has(t);
  return false;
}

/** What the owner reads instead of the wrong action — his own language, never the model's words. */
export const ASK_WHICH_REPLY: Record<string, string> = {
  RU: "Уточните, что сделать: набор — несколько товаров продаются вместе по одной цене, у него своя страница в магазине; промокод — код на скидку, покупатель вводит его в корзине.",
  ET: "Täpsusta, mida teha: komplekt — mitu toodet müüakse koos ühe hinnaga ja sellel on poes oma leht; sooduskood — kood, mille klient sisestab ostukorvis.",
  EN: "Say which one: a set — several products sold together at one price, with its own page in the shop; a promo code — a code the customer enters in the cart.",
};

/** The key the panel draws its two chips from (`ask` in the response body). */
export const ASK_WHICH = "bundle_or_promo";

/**
 * The paragraph the admin prompt carries about these two, plus the line that
 * names what THIS message is. Lives here so the rule and its test sit beside
 * the classifier that enforces it.
 */
export function intentPromptBlock(intent: DiscountIntent): string {
  const head = `НАБОР or ПРОМОКОД — never guess between these two; they are different things and the owner's words for them collide.
  · a SET («набор», «комплект») is several products sold together at ONE price — propose_bundle for a new one, set_bundle for one that exists. It lives in «Товары → Наборы» and has its own page in the shop.
  · a PROMO CODE («промокод», «купон», «код») is a discount the customer TYPES IN THE CART — create_promo. It applies to the whole basket and cannot be limited to chosen products.
The shop has no third thing: there is no "discount on these three products". A discount over a few named products IS a set. So — the owner said «набор»/«комплект» → a set action, never create_promo; he said «промокод»/«купон»/«код» → create_promo, never a set; he said neither and asked for a discount over several products («сделай скидку на шампунь и кондиционер») → propose NO action and ask him in the reply which of the two he means, in one short sentence. A question is always better than the wrong one of these two.`;

  if (intent === "bundle") {
    return `${head}
THIS MESSAGE IS ABOUT A SET: it says «набор»/«комплект». If it asks for a change, that change is propose_bundle or set_bundle. create_promo is forbidden for this message.`;
  }
  if (intent === "promo") {
    return `${head}
THIS MESSAGE IS ABOUT A PROMO CODE: it says «промокод»/«купон»/«код». If it asks for a change, that change is create_promo. propose_bundle and set_bundle are forbidden for this message.`;
  }
  if (intent === "ask") {
    return `${head}
THIS MESSAGE COULD MEAN EITHER of the two. Do NOT choose: answer with no action at all and ask, in one short sentence, whether he wants a set («набор») or a promo code («промокод»).`;
  }
  return head;
}
