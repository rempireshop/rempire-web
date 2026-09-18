/**
 * Every way Montonio says no, in the owner's own words.
 *
 * Why this file exists, and why it is one file for both halves of the API.
 *
 * On 18.09.2026 three refunds were refused and the panel showed one sentence —
 * «Montonio отказал в возврате — проверьте баланс в его панели» — for all
 * three. The balance is the one cause that cannot produce a refusal at all: a
 * refund with nothing behind it is answered **200 PENDING** and the reason
 * follows days later on the refund webhook. The five refusals that DO exist
 * each name themselves in the response body, each needs a different thing from
 * the owner, and every one of them was thrown away before it reached him.
 *
 * The same shape of mistake is one step away on the parcel side: a shipment
 * the carrier refuses (`registrationFailed`) is reported to the owner as
 * «Этикетка готова ✓».
 *
 * So: one vocabulary, three languages, and a rule that matters more than any
 * of the sentences below —
 *
 *   **a refusal this file does not recognise is shown in Montonio's own
 *   words, never in ours.** `unknown` quotes the API. A wrong confident
 *   sentence is worse than an untranslated true one, and this whole file is
 *   the bill for one wrong confident sentence.
 *
 * Sources, quoted verbatim in the tests (tests/montonio-problems.test.ts and
 * tests/montonio-docs-payloads.test.ts), read 18.09.2026:
 *
 *   · https://docs.montonio.com/api/stargate/guides/refunds
 *       — the five HTTP refusals, the five refund statuses, and the seven
 *         `refundStatusDescription` values;
 *   · https://docs.montonio.com/api/stargate/reference
 *       — `GET /orders/:orderUuid` → `availableForRefund`, `isRefundableType`;
 *   · https://docs.montonio.com/api/shipping-v2/guides/shipments
 *       — `registrationFailed`, «A common issue causing this is an incorrect
 *         receiver phone number», and `PATCH /shipments/{id}` as the repair;
 *   · https://docs.montonio.com/api/shipping-v2/reference
 *       — `constraints.parcelDimensionsRequired`, the carrierCode enum.
 *
 * Nothing here talks to the network, reads the database or decides anything.
 * It turns a string Montonio sent into a reason code and three sentences.
 */

export type MontonioLang = "RU" | "ET" | "EN";

/** One sentence in each of the shop's three languages. */
export type Trilingual = Record<MontonioLang, string>;

export const MONTONIO_LANGS: readonly MontonioLang[] = ["RU", "ET", "EN"] as const;

/** RU is the source language everywhere in this shop, so it is the fallback. */
export function pickLang(raw: unknown): MontonioLang {
  const s = String(raw ?? "").trim().toUpperCase();
  return s === "ET" || s === "EN" ? s : "RU";
}

/** House style, all three languages: «12,90 €» — comma decimal, thin gap. */
export function eur(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) + " €";
}

/* ---------- reading Montonio's own line ---------------------------------- */

/**
 * `montonioErrorText()` builds «HTTP 400 · <message>». Both halves are needed
 * here — the status tells a wrong access key (401) from a wrong secret key
 * (403) even when the body is empty — so they are pulled apart again rather
 * than passed around separately, because `PaymentError.detail` is the one
 * string that survives every throw in the payments module.
 */
export function splitMontonioDetail(detail: string | undefined | null): {
  status: number;
  message: string;
} {
  const raw = String(detail ?? "").trim();
  const m = /^HTTP\s+(\d{3})\s*(?:·\s*)?([\s\S]*)$/.exec(raw);
  if (!m) return { status: 0, message: raw };
  return { status: Number(m[1]), message: m[2].trim() };
}

/** `Refund amount [30] exceeds the total amount refundable [0]` → 30 and 0. */
function bracketNumbers(message: string): number[] {
  const out: number[] = [];
  const re = /\[\s*([0-9]+(?:[.,][0-9]+)?)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) out.push(Number(m[1].replace(",", ".")));
  return out;
}

/* ---------- refunds: the five documented HTTP refusals -------------------- */

/**
 * Montonio documents five refusals of `POST /refunds`. This adds one
 * distinction that the owner needs and Montonio prints for free: the
 * «exceeds the total amount refundable» message carries the refundable figure
 * in brackets, and **[0] is a different problem from [10]**. Zero means the
 * money has not settled yet or «Refundable bank payments» is off — nothing
 * about the amount typed in. A non-zero figure means exactly what it says.
 */
export type RefundRefusal =
  | "duplicate_key"
  | "nothing_refundable"
  | "exceeds_refundable"
  | "below_minimum"
  | "bad_access_key"
  | "bad_secret_key"
  | "unknown";

export interface RefundRefusalReading {
  reason: RefundRefusal;
  /** Montonio's own line, unchanged. Shown as-is for `unknown`. */
  montonio: string;
  status: number;
  /** The amount asked for, when Montonio printed it. */
  asked?: number;
  /** What Montonio says may still go back right now, when it printed it. */
  refundable?: number;
  messages: Trilingual;
}

const REFUND_TEXT: Record<Exclude<RefundRefusal, "unknown">, (v: RefundRefusalReading) => Trilingual> = {
  /* 400 — Order uuid [...] already has a refund with same idempotency key.
     This is the one refusal that means the OPPOSITE of failure: our
     idempotency key is derived from the order, so the same key coming back
     refused says the first attempt went through. Pressing again is the wrong
     move; reloading the order is the right one.

     This wording is the one the route may use only when the amount really IS
     on the order — the refund route now reads Montonio's own refund list in
     the same breath and writes down anything it is missing. Until 19.09.2026
     it was said unconditionally, and the retry after a lost answer sent the
     owner to look at a list that was empty precisely because nothing had been
     recorded (F4). See duplicateKeyUnrecordedText() for the other half. */
  duplicate_key: () => ({
    RU:
      "Этот возврат уже принят Montonio — второй раз деньги не уйдут. " +
      "Сумма записана в заказ: закройте карточку и откройте заказ заново — она будет в списке возвратов. Кнопку больше не нажимайте.",
    ET:
      "Montonio on selle tagasimakse juba vastu võtnud — raha teist korda ei lähe. " +
      "Summa on tellimusele kirja pandud: sulgege kaart ja avage tellimus uuesti — see on tagasimaksete loendis. Ärge nuppu enam vajutage.",
    EN:
      "Montonio has already accepted this refund — the money will not go out twice. " +
      "The amount is on the order: close the card and open the order again and it will be in the refund list. Do not press the button again.",
  }),

  /* 400 — Refund amount [X] exceeds the total amount refundable [0].
     The refusal all three of 18.09.2026 almost certainly were. Both causes are
     on Montonio's side and neither is visible from here; both are named. */
  nothing_refundable: () => ({
    RU:
      "Montonio пока нечего возвращать по этому заказу: доступно к возврату 0 €. " +
      "Причины две, обе в Montonio. Первая — деньги ещё не дошли на счёт магазина, это занимает один рабочий день. " +
      "Вторая — в Partner System не включён продукт «Refundable bank payments», без него возврат по банковской ссылке не проходит никогда. " +
      "Проверьте оба пункта и повторите. Ничего не списано.",
    ET:
      "Montoniol ei ole selle tellimuse pealt veel midagi tagastada: tagastatav summa on 0 €. " +
      "Põhjuseid on kaks, mõlemad Montonio poolel. Esimene — raha ei ole veel poe kontole jõudnud, see võtab ühe tööpäeva. " +
      "Teine — Partner Systemis ei ole sisse lülitatud toode «Refundable bank payments», ilma selleta pangalingi tagasimakse ei õnnestu kunagi. " +
      "Kontrollige mõlemat ja proovige uuesti. Midagi ei ole maha kantud.",
    EN:
      "Montonio has nothing to refund on this order yet: available for refund is 0 €. " +
      "There are two causes, both on Montonio's side. One — the money has not reached the shop's settlement account, which takes one business day. " +
      "Two — the «Refundable bank payments» product is not switched on in the Partner System, and without it a bank-link refund never goes through. " +
      "Check both and try again. Nothing has been taken.",
  }),

  /* 400 — Refund amount [1000] exceeds the total amount refundable [10]. */
  exceeds_refundable: (v) => {
    const left = typeof v.refundable === "number" ? eur(v.refundable) : "0 €";
    const asked = typeof v.asked === "number" ? eur(v.asked) : "";
    return {
      RU:
        "Montonio готов вернуть по этому заказу не больше " + left +
        (asked ? ", а запрошено " + asked : "") +
        ". Введите сумму не больше " + left + " и повторите. Ничего не списано.",
      ET:
        "Montonio saab selle tellimuse pealt tagastada kõige rohkem " + left +
        (asked ? ", küsiti aga " + asked : "") +
        ". Sisestage summa kuni " + left + " ja proovige uuesti. Midagi ei ole maha kantud.",
      EN:
        "Montonio can send back at most " + left + " on this order" +
        (asked ? ", and " + asked + " was asked for" : "") +
        ". Enter an amount up to " + left + " and try again. Nothing has been taken.",
    };
  },

  /* 400 — amount is under the min allowed amount: 0.05EUR */
  below_minimum: () => ({
    RU:
      "Montonio не принимает возврат меньше 0,05 €. Введите сумму от 0,05 € — или верните остаток заказа целиком.",
    ET:
      "Montonio ei võta vastu tagasimakset, mis on alla 0,05 €. Sisestage vähemalt 0,05 € — või tagastage tellimuse jääk tervikuna.",
    EN:
      "Montonio does not accept a refund below 0.05 €. Enter at least 0.05 € — or send back the whole remainder of the order.",
  }),

  /* 401 — STORE_NOT_FOUND - double check your access key */
  bad_access_key: () => ({
    RU:
      "Montonio не узнал магазин (STORE_NOT_FOUND): не тот ключ доступа. " +
      "Обычно это ключи песочницы на боевом сайте или наоборот — ключ доступа и секретный ключ должны быть из одной среды. " +
      "Это не про заказ и не про покупателя: напишите Диму, ничего не списано.",
    ET:
      "Montonio ei tundnud poodi ära (STORE_NOT_FOUND): vale juurdepääsuvõti. " +
      "Tavaliselt on liivakasti võtmed päris saidil või vastupidi — juurdepääsuvõti ja salavõti peavad olema samast keskkonnast. " +
      "See ei ole tellimuse ega kliendi viga: kirjutage Dimile, midagi ei ole maha kantud.",
    EN:
      "Montonio did not recognise the store (STORE_NOT_FOUND): the access key is wrong. " +
      "Usually this is sandbox keys on the live site or the other way round — the access key and the secret key must be from the same environment. " +
      "This is not about the order or the customer: write to Dim, nothing has been taken.",
  }),

  /* 403 — INVALID_TOKEN - double check your secret key */
  bad_secret_key: () => ({
    RU:
      "Montonio отверг подпись запроса (INVALID_TOKEN): не тот секретный ключ. " +
      "Ключ доступа и секретный ключ должны быть одной парой из одной среды Montonio. " +
      "Это правит Дим на сервере, ничего не списано.",
    ET:
      "Montonio lükkas päringu allkirja tagasi (INVALID_TOKEN): vale salavõti. " +
      "Juurdepääsuvõti ja salavõti peavad olema üks paar ühest Montonio keskkonnast. " +
      "Selle parandab Dim serveris, midagi ei ole maha kantud.",
    EN:
      "Montonio rejected the request signature (INVALID_TOKEN): the secret key is wrong. " +
      "The access key and the secret key must be one pair from one Montonio environment. " +
      "Dim fixes this on the server, nothing has been taken.",
  }),
};

/** The refusal in Montonio's own words — what an unrecognised one says. */
function refundUnknownText(montonio: string): Trilingual {
  const said = montonio || "—";
  return {
    RU: "Montonio не принял возврат и назвал причину сам: «" + said + "». Ничего не списано. Покажите эту строку Диму.",
    ET: "Montonio ei võtnud tagasimakset vastu ja nimetas põhjuse ise: „" + said + "\". Midagi ei ole maha kantud. Näidake see rida Dimile.",
    EN: "Montonio did not accept the refund and named the reason itself: \"" + said + "\". Nothing has been taken. Show this line to Dim.",
  };
}

/**
 * «Первый возврат прошёл, но записать его не удалось» — the duplicate key
 * refused while the order's own refund list still has nothing in it.
 *
 * Never a guess: the refund route only reaches this wording when it has asked
 * `GET /orders/:orderUuid` and either could not read it or could not write
 * what it read. Telling the owner to go and look at a list that is empty is
 * how «Вернуть деньги» talked him into making a second refund with a different
 * amount (F4), so the sentence has to say the list is empty and that the
 * answer is in Montonio's own panel.
 */
function duplicateKeyUnrecordedText(): Trilingual {
  return {
    RU:
      "Этот возврат Montonio уже принял — второй раз деньги не уйдут. " +
      "Но записать его в заказ не удалось: в списке возвратов суммы пока нет, и это не значит, что деньги не ушли. " +
      "Другую сумму не вводите. Откройте заказ в панели Montonio и покажите его Диму.",
    ET:
      "Montonio on selle tagasimakse juba vastu võtnud — raha teist korda ei lähe. " +
      "Kuid seda ei õnnestunud tellimusele kirja panna: tagasimaksete loendis summat veel ei ole, ja see ei tähenda, et raha poleks läinud. " +
      "Ärge sisestage teist summat. Avage tellimus Montonio paneelis ja näidake see Dimile.",
    EN:
      "Montonio has already accepted this refund — the money will not go out twice. " +
      "But it could not be written onto the order: the refund list does not show it yet, and that does not mean the money stayed. " +
      "Do not enter a different amount. Open the order in Montonio's own panel and show it to Dim.",
  };
}

/**
 * Montonio's refusal of `POST /refunds` → a reason the owner can act on.
 *
 * `detail` is `PaymentError.detail` — «HTTP 400 · <Montonio's message>».
 * Matching is on Montonio's own wording, which is why the patterns look
 * verbose: they are the documented sentences, not invented codes. The HTTP
 * status is only consulted where the body may be empty (401/403).
 *
 * `recorded` is the caller's answer to the one question `duplicate_key`'s
 * sentence asks on the owner's behalf — is the amount on the order? The refund
 * route knows, because it has just read Montonio's refund list and written
 * down what was missing; nothing else calls this with a duplicate key.
 */
export function readRefundRefusal(
  detail: string | undefined | null,
  opts: { recorded?: boolean } = {},
): RefundRefusalReading {
  const { status, message } = splitMontonioDetail(detail);
  const line = String(detail ?? "").trim();
  const base: RefundRefusalReading = {
    reason: "unknown",
    montonio: line,
    status,
    messages: refundUnknownText(line),
  };

  if (/already has a refund with same idempotency key/i.test(message)) {
    base.reason = "duplicate_key";
  } else if (/exceeds the total amount refundable/i.test(message)) {
    const nums = bracketNumbers(message);
    /* «Refund amount [X] exceeds the total amount refundable [Y]» — the last
       bracket is Y, the first is X. A message that lost its brackets still
       classifies, it just cannot name the figures. */
    if (nums.length >= 2) {
      base.asked = nums[0];
      base.refundable = nums[nums.length - 1];
    } else if (nums.length === 1) {
      base.refundable = nums[0];
    }
    base.reason = base.refundable && base.refundable > 0 ? "exceeds_refundable" : "nothing_refundable";
  } else if (/under the min allowed amount/i.test(message)) {
    base.reason = "below_minimum";
  } else if (/STORE_NOT_FOUND/i.test(message) || status === 401) {
    base.reason = "bad_access_key";
  } else if (/INVALID_TOKEN/i.test(message) || status === 403) {
    base.reason = "bad_secret_key";
  }

  if (base.reason !== "unknown") base.messages = REFUND_TEXT[base.reason](base);
  if (base.reason === "duplicate_key" && !opts.recorded) base.messages = duplicateKeyUnrecordedText();
  return base;
}

/* ---------- refunds: what the WEBHOOK says days later --------------------- */

/**
 * `refundStatusDescription` on the refund webhook — the other half of the
 * story, and the half the panel has never shown.
 *
 * A refund Montonio cannot fund is `200 PENDING` at the counter and one of
 * these words on a webhook up to ten days later. Every value below is from the
 * refunds guide's own list; `OTHER` is Montonio's own catch-all and is kept
 * distinct from ours (`unknown`), which means «a word this shop has not been
 * taught» and prints Montonio's text.
 */
export type RefundStatusReason =
  | "insufficient_funds"
  | "exceeds_paid"
  | "declined"
  | "expired_or_cancelled_card"
  | "lost_or_stolen_card"
  | "expired"
  | "other"
  | "unknown";

const REFUND_DESCRIPTION: Record<string, RefundStatusReason> = {
  INSUFFICIENT_FUNDS: "insufficient_funds",
  REFUND_EXCEEDS_ORDER_PAID_AMOUNT: "exceeds_paid",
  DECLINED: "declined",
  EXPIRED_OR_CANCELLED_CARD: "expired_or_cancelled_card",
  LOST_OR_STOLEN_CARD: "lost_or_stolen_card",
  EXPIRED: "expired",
  OTHER: "other",
};

const REFUND_REASON_TEXT: Record<Exclude<RefundStatusReason, "unknown">, Trilingual> = {
  insufficient_funds: {
    RU:
      "На счёте магазина в Montonio не хватило денег на этот возврат. Montonio пробует сам — до 10 дней, " +
      "и если денег так и не будет, возврат отменится. Ничего нажимать не нужно: следующие оплаты покупателей пополнят счёт. " +
      "Если возврат срочный — пополните счёт в Montonio.",
    ET:
      "Poe kontol Montonios ei jätkunud selle tagasimakse jaoks raha. Montonio proovib ise — kuni 10 päeva, " +
      "ja kui raha ikka ei tule, tagasimakse tühistatakse. Midagi vajutada ei ole vaja: järgmised klientide maksed täidavad konto. " +
      "Kui tagasimakse on kiire — kandke Montonio kontole raha juurde.",
    EN:
      "The shop's Montonio account did not have enough money for this refund. Montonio keeps retrying by itself — for up to 10 days, " +
      "and if the money still is not there the refund is cancelled. Nothing to press: the next customer payments will top the account up. " +
      "If the refund is urgent, add money to the Montonio account.",
  },
  exceeds_paid: {
    RU:
      "Montonio считает, что возврат больше, чем по заказу было оплачено. Откройте заказ в Montonio и сверьте сумму оплаты с суммой возврата.",
    ET:
      "Montonio hinnangul on tagasimakse suurem kui tellimuse eest makstud summa. Avage tellimus Montonios ja võrrelge makstud summat tagasimakse summaga.",
    EN:
      "Montonio says the refund is larger than what was paid for the order. Open the order in Montonio and compare the paid amount with the refund amount.",
  },
  declined: {
    RU:
      "Банк покупателя отклонил возврат. Деньги остались в магазине. Свяжитесь с покупателем и верните другим способом — или напишите в поддержку Montonio.",
    ET:
      "Kliendi pank lükkas tagasimakse tagasi. Raha jäi poodi. Võtke kliendiga ühendust ja tagastage muul viisil — või kirjutage Montonio toele.",
    EN:
      "The customer's bank declined the refund. The money stayed with the shop. Contact the customer and refund another way — or write to Montonio support.",
  },
  expired_or_cancelled_card: {
    RU:
      "Карта покупателя просрочена или закрыта, вернуть на неё нельзя. Деньги остались в магазине — попросите у покупателя другие реквизиты.",
    ET:
      "Kliendi kaart on aegunud või suletud, sellele tagastada ei saa. Raha jäi poodi — küsige kliendilt teised andmed.",
    EN:
      "The customer's card has expired or been closed, so nothing can go back to it. The money stayed with the shop — ask the customer for other details.",
  },
  lost_or_stolen_card: {
    RU:
      "Карта покупателя заявлена как утерянная или украденная — банк возврат не примет. Деньги остались в магазине, нужны другие реквизиты покупателя.",
    ET:
      "Kliendi kaart on teatatud kadunuks või varastatuks — pank tagasimakset vastu ei võta. Raha jäi poodi, vaja on kliendi teisi andmeid.",
    EN:
      "The customer's card is reported lost or stolen — the bank will not accept the refund. The money stayed with the shop; other customer details are needed.",
  },
  expired: {
    RU:
      "Срок возврата истёк: Montonio ждал 10 дней и отменил его. Деньги остались в магазине — оформите возврат заново, когда на счёте будут деньги.",
    ET:
      "Tagasimakse tähtaeg sai läbi: Montonio ootas 10 päeva ja tühistas selle. Raha jäi poodi — vormistage tagasimakse uuesti, kui kontol on raha.",
    EN:
      "The refund timed out: Montonio waited 10 days and cancelled it. The money stayed with the shop — make the refund again once the account has funds.",
  },
  other: {
    RU:
      "Montonio не смог провести возврат и не назвал причину («OTHER»). Деньги остались в магазине. Откройте заказ в Montonio или напишите в его поддержку.",
    ET:
      "Montonio ei suutnud tagasimakset teha ega nimetanud põhjust („OTHER\"). Raha jäi poodi. Avage tellimus Montonios või kirjutage nende toele.",
    EN:
      "Montonio could not carry out the refund and gave no reason (\"OTHER\"). The money stayed with the shop. Open the order in Montonio or write to their support.",
  },
};

export interface RefundStatusReading {
  reason: RefundStatusReason;
  /** The word Montonio sent, unchanged. */
  montonio: string;
  messages: Trilingual;
}

/**
 * `refundStatusDescription` → a sentence. `null` (the documented value on a
 * successful refund) and an empty string both read as «nothing to say», which
 * the caller can spot by an empty `montonio`.
 */
export function readRefundStatusDescription(raw: unknown): RefundStatusReading {
  const said = String(raw ?? "").trim();
  const key = said.toUpperCase().replace(/[\s-]+/g, "_");
  const reason: RefundStatusReason | undefined = REFUND_DESCRIPTION[key];
  if (reason && reason !== "unknown") {
    return { reason, montonio: said, messages: REFUND_REASON_TEXT[reason] };
  }
  return {
    reason: "unknown",
    montonio: said,
    messages: {
      RU: said
        ? "Montonio отметил возврат как «" + said + "». Деньги пока не у покупателя — откройте заказ в Montonio."
        : "Montonio не назвал причину.",
      ET: said
        ? "Montonio märkis tagasimakse olekuga „" + said + "\". Raha ei ole veel kliendini jõudnud — avage tellimus Montonios."
        : "Montonio ei nimetanud põhjust.",
      EN: said
        ? "Montonio marked the refund as \"" + said + "\". The money is not with the customer yet — open the order in Montonio."
        : "Montonio gave no reason.",
    },
  };
}

/* ---------- a refund that is still PENDING -------------------------------- */

/**
 * The refunds guide: PENDING means «created and awaiting processing … if a
 * previous attempt failed (e.g. due to insufficient funds), the system will
 * retry automatically», and the help centre puts the clock at **10 days**,
 * after which «the refund will be canceled».
 *
 * So a pending refund is neither a success nor a failure, and the panel used
 * to show it as a success. These two constants are what makes it visible: past
 * the first, the panel says «ещё не у покупателя»; past the second, Montonio
 * has given up and the money is still the shop's.
 */
export const REFUND_PENDING_WATCH_HOURS = 24;
export const REFUND_PENDING_GIVEUP_DAYS = 10;

/** «Отправлен в Montonio, но ещё не у покупателя» — with the clock on it. */
export function refundPendingText(hoursOld: number): Trilingual {
  const days = Math.floor(Math.max(0, hoursOld) / 24);
  const overdue = days >= REFUND_PENDING_GIVEUP_DAYS;
  if (overdue) {
    return {
      RU:
        "Возврат висит в Montonio больше 10 дней — по их правилам он уже отменён, деньги остались в магазине. " +
        "Оформите возврат заново или верните покупателю вручную.",
      ET:
        "Tagasimakse on Montonios rippunud üle 10 päeva — nende reeglite järgi on see juba tühistatud, raha jäi poodi. " +
        "Vormistage tagasimakse uuesti või tagastage kliendile käsitsi.",
      EN:
        "The refund has been sitting at Montonio for more than 10 days — by their rules it is already cancelled and the money stayed with the shop. " +
        "Make the refund again, or pay the customer back by hand.",
    };
  }
  const left = Math.max(0, REFUND_PENDING_GIVEUP_DAYS - days);
  return {
    RU:
      "Montonio принял возврат, но деньги ещё не у покупателя. Обычно это один рабочий день. " +
      "Если на счёте магазина не хватает денег, Montonio будет пробовать ещё " + left + " дн. и потом отменит возврат. Повторно нажимать не нужно.",
    ET:
      "Montonio võttis tagasimakse vastu, aga raha ei ole veel kliendini jõudnud. Tavaliselt võtab see ühe tööpäeva. " +
      "Kui poe kontol raha ei jätku, proovib Montonio veel " + left + " päeva ja seejärel tühistab tagasimakse. Uuesti vajutada ei ole vaja.",
    EN:
      "Montonio accepted the refund, but the money is not with the customer yet. This normally takes one business day. " +
      "If the shop's account is short, Montonio will keep trying for another " + left + " days and then cancel the refund. No need to press again.",
  };
}

/* ---------- shipments: a parcel the carrier would not take ---------------- */

/**
 * A refused registration, by cause.
 *
 * Montonio's shipping API does not publish an error enum, so unlike the refund
 * list above this one is built from what the API demonstrably answers: the
 * `registrationFailed` status (documented, with «an incorrect receiver phone
 * number» named as the common cause), the carrierCode 400 whose message lists
 * the whole enum, the `parcelDimensionsRequired` constraint, and 401/403 from
 * the shared key pair. Everything else is `unknown` and quotes Montonio.
 *
 * `registration_failed` is the honest default for a `registrationFailed`
 * status with nothing else to go on: the carrier said no and Montonio did not
 * say why, which is itself the news — the parcel exists, unregistered, and
 * `PATCH /shipments/{id}` is the documented repair.
 */
export type ShipmentRefusal =
  | "registration_failed"
  | "bad_phone"
  | "bad_address"
  | "dimensions_required"
  | "bad_carrier_code"
  | "bad_point"
  | "bad_access_key"
  | "bad_secret_key"
  | "unknown";

export interface ShipmentRefusalReading {
  reason: ShipmentRefusal;
  montonio: string;
  status: number;
  messages: Trilingual;
}

const SHIPMENT_TEXT: Record<Exclude<ShipmentRefusal, "unknown">, Trilingual> = {
  registration_failed: {
    RU:
      "Перевозчик не принял посылку — этикетки нет. Отправление в Montonio есть, но не зарегистрировано: " +
      "второй раз кнопку жать бесполезно, посылка не задвоится и не поедет. " +
      "Чаще всего дело в телефоне или адресе получателя: проверьте их в заказе, исправьте у покупателя и напишите Диму — он отправит исправление в Montonio.",
    ET:
      "Vedaja ei võtnud pakki vastu — silti ei ole. Saadetis on Montonios olemas, kuid registreerimata: " +
      "nuppu teist korda vajutada ei ole mõtet, pakk ei dubleeru ega liigu. " +
      "Kõige sagedamini on asi saaja telefonis või aadressis: kontrollige neid tellimuses, täpsustage kliendiga ja kirjutage Dimile — tema saadab paranduse Montoniosse.",
    EN:
      "The carrier would not take the parcel — there is no label. The shipment exists at Montonio but is not registered: " +
      "pressing the button again does nothing, the parcel will neither double nor move. " +
      "The usual cause is the receiver's phone or address: check them on the order, confirm with the customer and write to Dim — he sends the correction to Montonio.",
  },
  bad_phone: {
    RU:
      "Перевозчик не принял телефон получателя — без него посылку не зарегистрировать (по этому номеру приходит СМС с кодом). " +
      "Уточните номер у покупателя, впишите его в заказ вместе с кодом страны и напишите Диму.",
    ET:
      "Vedaja ei võtnud saaja telefoninumbrit vastu — ilma selleta pakki registreerida ei saa (sellele numbrile tuleb koodiga SMS). " +
      "Täpsustage number kliendiga, kirjutage see koos riigikoodiga tellimusele ja andke Dimile teada.",
    EN:
      "The carrier rejected the receiver's phone number — without it the parcel cannot be registered (the collection SMS goes to that number). " +
      "Confirm the number with the customer, put it on the order together with its country code and tell Dim.",
  },
  bad_address: {
    RU:
      "Перевозчик не принял адрес получателя. Проверьте улицу, город и индекс в заказе — их формат должен подходить стране доставки — и напишите Диму.",
    ET:
      "Vedaja ei võtnud saaja aadressi vastu. Kontrollige tellimuses tänavat, linna ja sihtnumbrit — vorming peab sobima sihtriigiga — ja teatage Dimile.",
    EN:
      "The carrier rejected the receiver's address. Check the street, city and postcode on the order — the format must suit the destination country — and tell Dim.",
  },
  dimensions_required: {
    RU:
      "Этот перевозчик требует размеры коробки, а мы их не отправили. Измерьте посылку (длина, ширина, высота) и передайте Диму — он добавит размеры в отправление.",
    ET:
      "See vedaja nõuab pakendi mõõte, aga meie neid ei saatnud. Mõõtke pakk (pikkus, laius, kõrgus) ja andke Dimile teada — tema lisab mõõdud saadetisele.",
    EN:
      "This carrier requires the box dimensions and we did not send them. Measure the parcel (length, width, height) and give them to Dim — he adds them to the shipment.",
  },
  bad_carrier_code: {
    RU:
      "Montonio не знает такого перевозчика для этого заказа. Выберите другой способ доставки в заказе или напишите Диму — это настройка, а не ошибка покупателя.",
    ET:
      "Montonio ei tunne selle tellimuse jaoks sellist vedajat. Valige tellimuses teine tarneviis või kirjutage Dimile — see on seadistus, mitte kliendi viga.",
    EN:
      "Montonio does not know this carrier for this order. Choose a different delivery method on the order, or write to Dim — this is a setting, not a customer mistake.",
  },
  bad_point: {
    RU:
      "Пакомата из заказа у Montonio нет — возможно, его закрыли. Свяжитесь с покупателем и выберите другой пакомат, потом создайте этикетку заново.",
    ET:
      "Tellimuses olevat pakiautomaati Montoniol ei ole — võimalik, et see on suletud. Võtke kliendiga ühendust, valige teine pakiautomaat ja looge silt uuesti.",
    EN:
      "Montonio does not have the parcel machine from the order — it may have closed. Contact the customer, pick another parcel machine and create the label again.",
  },
  bad_access_key: {
    RU:
      "Montonio не узнал магазин: не тот ключ доступа. Посылка не создана и денег с магазина не списано. Это настройка на сервере — напишите Диму.",
    ET:
      "Montonio ei tundnud poodi ära: vale juurdepääsuvõti. Pakki ei loodud ja poelt raha maha ei võetud. See on serveri seadistus — kirjutage Dimile.",
    EN:
      "Montonio did not recognise the store: the access key is wrong. No parcel was created and the shop was not charged. This is a server setting — write to Dim.",
  },
  bad_secret_key: {
    RU:
      "Montonio отверг подпись запроса: не тот секретный ключ. Посылка не создана и денег не списано. Это настройка на сервере — напишите Диму.",
    ET:
      "Montonio lükkas päringu allkirja tagasi: vale salavõti. Pakki ei loodud ja raha maha ei võetud. See on serveri seadistus — kirjutage Dimile.",
    EN:
      "Montonio rejected the request signature: the secret key is wrong. No parcel was created and nothing was charged. This is a server setting — write to Dim.",
  },
};

function shipmentUnknownText(montonio: string): Trilingual {
  const said = montonio || "—";
  return {
    RU: "Перевозчик отказал и назвал причину сам: «" + said + "». Этикетки нет. Покажите эту строку Диму.",
    ET: "Vedaja keeldus ja nimetas põhjuse ise: „" + said + "\". Silti ei ole. Näidake see rida Dimile.",
    EN: "The carrier refused and named the reason itself: \"" + said + "\". There is no label. Show this line to Dim.",
  };
}

/**
 * Why a shipment was refused.
 *
 * `detail` is whatever survived: `MontonioShippingError.detail` («400 {json}»
 * from the transport, or a bare hint like «venipak/DE»), or the shipment's own
 * `status` when Montonio answered 200 with `registrationFailed`. Both are
 * scanned for the same words, because both are the carrier talking.
 */
export function readShipmentRefusal(detail: string | undefined | null): ShipmentRefusalReading {
  const line = String(detail ?? "").trim();
  const head = /^(\d{3})\b/.exec(line);
  const status = head ? Number(head[1]) : 0;
  const text = line;

  let reason: ShipmentRefusal = "unknown";
  if (/phone/i.test(text)) reason = "bad_phone";
  else if (/\b(length|width|height|dimension)/i.test(text)) reason = "dimensions_required";
  else if (/carrierCode must be one of|carrierCode/i.test(text)) reason = "bad_carrier_code";
  else if (/pickup\s*point|pickupPoint|point_unresolved/i.test(text)) reason = "bad_point";
  else if (/street|postal|postcode|locality|address/i.test(text)) reason = "bad_address";
  else if (/STORE_NOT_FOUND/i.test(text) || status === 401) reason = "bad_access_key";
  else if (/INVALID_TOKEN/i.test(text) || status === 403) reason = "bad_secret_key";
  else if (/registrationFailed/i.test(text)) reason = "registration_failed";

  return {
    reason,
    montonio: line,
    status,
    messages: reason === "unknown" ? shipmentUnknownText(line) : SHIPMENT_TEXT[reason],
  };
}

/* ---------- «Подключения»: what the shop believes it can do --------------- */

/**
 * Montonio's own name for a bank link, everywhere in both APIs: the key in
 * `GET /stores/payment-methods`, and the value of `paymentMethodType` on
 * `GET /orders/:orderUuid`. Our own orders store `bank | card | wallet`
 * instead (`PaymentMethodKind`), which is why the two are never compared
 * without being translated first.
 */
export const MONTONIO_BANK_METHOD = "paymentInitiation";

/**
 * A machine-readable list inside an owner-facing sentence.
 *
 * Addresses and event names are not translated — they are typed into
 * Montonio's form exactly as printed — so one separator serves all three
 * languages and `tools/i18n-gaps.mjs` has nothing to find.
 */
function listOf(items: readonly string[]): string {
  return items.filter(Boolean).join(", ") || "—";
}

/** « — https://…/api/shipping/notify/», or nothing when we do not know it. */
function urlTail(url: string): string {
  return url ? " — " + url : "";
}

/**
 * What the readiness probe found, reduced to the four things worth a row on
 * the owner's «Подключения» screen.
 *
 * `null` is not `false` anywhere here. «Мы не смогли спросить» and «выключено»
 * are different facts and the screen must not merge them: a grey row that says
 * «проверяем» is honest, a green one that is guessing is the bug this whole
 * branch is about.
 */
export interface ReadinessState {
  configured: boolean;
  env: "sandbox" | "live" | null;
  /**
   * What Montonio said about the keys themselves.
   *
   * `ok` — at least one read-only call came back 2xx, so the pair works.
   * `bad_access_key` — 401 `STORE_NOT_FOUND`. `bad_secret_key` — 403
   * `INVALID_TOKEN`. `refused` — some other refusal, quoted rather than
   * guessed at. `unreachable` — no answer at all. `null` — nothing to go on.
   *
   * This exists because on Sunday 21.09.2026 the owner pastes the live keys in
   * by hand, and until 19.09.2026 half a pair got him «Проверяем…» and «как
   * только пройдёт первая оплата» — which would never come, because
   * `POST /orders` answers 401 too (audit 18.09.2026, F14).
   */
  keys: "ok" | "bad_access_key" | "bad_secret_key" | "refused" | "unreachable" | null;
  /** The HTTP status behind `keys: "refused"`, so the row can quote it. */
  keyStatus?: number | null;
  /** `paymentInitiation` is in `GET /stores/payment-methods`. */
  bankPayments: boolean | null;
  /**
   * `isRefundableType` from a real paid order — the only signal there is.
   *
   * Only ever read from an order Montonio says was paid with
   * `paymentInitiation`; see `refundSampleMethod`.
   */
  refundableBankPayments: boolean | null;
  /**
   * How the sampled order was paid, in Montonio's own spelling, or `null` when
   * there was no order to sample.
   *
   * The reference: `isRefundableType` is true «if you enabled refunds in
   * montonio **(and the user paid with a refundable method)**». Cards and
   * wallets are refundable by default, bank links are a separate product — so
   * a card order answers about cards and says nothing at all about the switch
   * this screen exists for (audit 18.09.2026, F12).
   */
  refundSampleMethod: string | null;
  /** How many carriers `GET /carriers` names for this store. */
  carriers: number | null;
  /** `GET /webhooks` read properly: url, trailing slash and events. `null` = could not ask. */
  webhook: ReadinessWebhook | null;
  pendingRefunds: number;
  overdueRefunds: number;
}

/** The shape `readWebhookSetup()` (src/lib/shipping/montonio.ts) produces. */
export interface ReadinessWebhook {
  state: "ok" | "none" | "wrong_url" | "missing_events";
  /** The address Montonio has to be given — empty when PUBLIC_BASE_URL is unset. */
  expectedUrl: string;
  /** The addresses Montonio actually holds. */
  urls: string[];
  /** Required events the matching webhook does not carry. */
  missingEvents: string[];
}

export interface ReadinessRow {
  key: string;
  /** Green dot. */
  ok: boolean;
  /** Grey rather than red — known to be unfinished, not known to be broken. */
  quiet?: boolean;
  name: Trilingual;
  sub: Trilingual;
}

/**
 * The rows, in three languages, built on the server.
 *
 * They live here rather than in `public/shop2/app.js` for one concrete reason:
 * these sentences are about **Montonio's** state, they change when Montonio
 * changes, and the storefront dictionary (RU source + ET/EN lookup tables)
 * cannot be kept in step with an API from inside a 1.3 MB file that four agents
 * edit. The panel prints `sub[<its language>]` and adds no literals of its own,
 * so `tools/i18n-gaps.mjs` stays at zero.
 *
 * Seven rows, in the order a thing has to be true before the next one can be:
 * the mode, the keys, bank payments, refunds on those payments, the carriers,
 * the parcel webhook, and anything stuck. `bankPayments` and `carriers` were
 * computed and thrown away until 19.09.2026 — the shop knew and did not say
 * (audit 18.09.2026, F14 and F29).
 */
export function montonioReadinessRows(state: ReadinessState): ReadinessRow[] {
  const rows: ReadinessRow[] = [];
  /* «Проверяем…» is only ever honest while an answer is still on its way, and
     these rows are only ever built from an answer that has arrived — so it
     survives as one defensive default and nothing more. Every row that used to
     print it forever because a probe had been refused now says what happened
     and what to do about it (audit 18.09.2026, F14). The panel shows no
     Montonio rows at all until the route has replied, which is where the
     genuine «loading» state lives (public/shop2/app.js, admIntegrationRows). */
  const CHECKING: Trilingual = { RU: "Проверяем…", ET: "Kontrollime…", EN: "Checking…" };

  if (!state.configured) {
    rows.push({
      key: "montonio",
      ok: false,
      name: { RU: "Montonio", ET: "Montonio", EN: "Montonio" },
      sub: {
        RU: "Ключи Montonio не заданы — магазин не может ни принимать оплату, ни создавать посылки. Это настройка на сервере, её делает Дим.",
        ET: "Montonio võtmeid ei ole määratud — pood ei saa makseid vastu võtta ega pakke luua. See on serveri seadistus, seda teeb Dim.",
        EN: "Montonio keys are not set — the shop can neither take payments nor create parcels. This is a server setting; Dim does it.",
      },
    });
    return rows;
  }

  const live = state.env === "live";
  rows.push({
    key: "env",
    ok: live,
    quiet: !live,
    name: { RU: "Montonio · режим", ET: "Montonio · režiim", EN: "Montonio · mode" },
    sub: live
      ? {
          RU: "Боевой режим: деньги настоящие, посылки настоящие.",
          ET: "Päris režiim: raha on päris ja pakid on päris.",
          EN: "Live mode: real money, real parcels.",
        }
      : {
          RU: "Песочница: деньги не настоящие, перевозчикам ничего не уходит, наклейки — пустышки. Перед открытием магазина нужно переключить на боевой режим и поставить боевые ключи.",
          ET: "Liivakast: raha ei ole päris, vedajatele ei lähe midagi, sildid on näidised. Enne poe avamist tuleb lülitada päris režiimi ja panna päris võtmed.",
          EN: "Sandbox: the money is not real, nothing reaches the carriers, the labels are dummies. Switch to live mode with live keys before the shop opens.",
        },
  });

  /* The keys themselves.
     On Sunday 21.09.2026 the owner pastes the live pair in by hand, and half a
     pair is worse than neither: `POST /orders` answers 401, so «как только
     пройдёт первая оплата» never arrives. Montonio names both halves itself —
     401 STORE_NOT_FOUND is the access key, 403 INVALID_TOKEN is the secret —
     and until 19.09.2026 five `.catch(() => null)` turned that into silence
     (audit 18.09.2026, F14). */
  const keys = state.keys;
  const keysBad = keys === "bad_access_key" || keys === "bad_secret_key" || keys === "refused";
  rows.push({
    key: "keys",
    ok: !keysBad,
    quiet: keys !== "ok",
    name: { RU: "Ключи Montonio", ET: "Montonio võtmed", EN: "Montonio keys" },
    sub:
      keys === "ok"
        ? {
            RU: "Ключи приняты: Montonio отвечает на запросы магазина. Проверяется каждый раз, когда вы открываете этот экран.",
            ET: "Võtmed on vastu võetud: Montonio vastab poe päringutele. Kontrollitakse iga kord, kui te selle ekraani avate.",
            EN: "The keys are accepted: Montonio answers the shop's requests. Checked every time you open this screen.",
          }
        : keys === "bad_access_key"
          ? {
              RU: "Montonio не узнал магазин (STORE_NOT_FOUND): не тот ключ доступа. Обычно это ключи песочницы на боевом сайте или наоборот — ключ доступа и секретный ключ должны быть из одной среды. Пока так, магазин не примет ни оплату, ни посылку. Это правит Дим на сервере.",
              ET: "Montonio ei tundnud poodi ära (STORE_NOT_FOUND): vale juurdepääsuvõti. Tavaliselt on liivakasti võtmed päris saidil või vastupidi — juurdepääsuvõti ja salavõti peavad olema samast keskkonnast. Seni ei võta pood vastu ei makset ega pakki. Selle parandab Dim serveris.",
              EN: "Montonio did not recognise the store (STORE_NOT_FOUND): the access key is wrong. Usually this is sandbox keys on the live site or the other way round — the access key and the secret key must be from the same environment. Until that is fixed the shop takes neither a payment nor a parcel. Dim fixes it on the server.",
            }
          : keys === "bad_secret_key"
            ? {
                RU: "Montonio отверг подпись запроса (INVALID_TOKEN): не тот секретный ключ. Ключ доступа и секретный ключ должны быть одной парой из одной среды Montonio. Пока так, магазин не примет ни оплату, ни посылку. Это правит Дим на сервере.",
                ET: "Montonio lükkas päringu allkirja tagasi (INVALID_TOKEN): vale salavõti. Juurdepääsuvõti ja salavõti peavad olema üks paar ühest Montonio keskkonnast. Seni ei võta pood vastu ei makset ega pakki. Selle parandab Dim serveris.",
                EN: "Montonio rejected the request signature (INVALID_TOKEN): the secret key is wrong. The access key and the secret key must be one pair from one Montonio environment. Until that is fixed the shop takes neither a payment nor a parcel. Dim fixes it on the server.",
              }
            : keys === "refused"
              ? {
                  /* An answer this file has not been taught is quoted, never
                     renamed — the rule at the head of this file. */
                  RU: "Montonio не пустил магазин к своим данным и ответил " + (state.keyStatus ?? "—") + ". Что именно ему не понравилось, он не сказал. Покажите эту строку Диму.",
                  ET: "Montonio ei lasknud poodi oma andmete juurde ja vastas " + (state.keyStatus ?? "—") + ". Mis talle täpselt ei sobinud, ta ei öelnud. Näidake see rida Dimile.",
                  EN: "Montonio would not let the shop at its data and answered " + (state.keyStatus ?? "—") + ". It did not say what it disliked. Show this line to Dim.",
                }
              : keys === "unreachable"
                ? {
                    RU: "Montonio сейчас не отвечает. Это может быть связь или работы на их стороне — ключи при этом могут быть в порядке. Откройте этот экран ещё раз через несколько минут.",
                    ET: "Montonio ei vasta praegu. See võib olla ühendus või nende poolne hooldus — võtmed võivad olla korras. Avage see ekraan mõne minuti pärast uuesti.",
                    EN: "Montonio is not answering right now. It may be the connection or work on their side — the keys themselves may be fine. Open this screen again in a few minutes.",
                  }
                : CHECKING,
  });

  /* Bank links are how most of this shop's customers pay, so «включено ли это
     вообще» is a row and not a field in a JSON blob nobody opens. */
  rows.push({
    key: "bank_payments",
    ok: state.bankPayments !== false,
    quiet: state.bankPayments === null,
    name: { RU: "Оплата банковской ссылкой", ET: "Maksmine pangalingiga", EN: "Payment by bank link" },
    sub:
      state.bankPayments === true
        ? {
            RU: "Включено: покупатель может заплатить из своего банка. Это основной способ оплаты в магазине.",
            ET: "Sisse lülitatud: klient saab maksta oma pangast. See on poe peamine makseviis.",
            EN: "On: a customer can pay from their own bank. This is the shop's main way of paying.",
          }
        : state.bankPayments === false
          ? {
              RU: "Банковские ссылки у Montonio не включены — на оплате покупатель увидит только карту. Включается в Partner System, продукт «Bank payments».",
              ET: "Pangalingid ei ole Montonios sisse lülitatud — maksmisel näeb klient ainult kaarti. Lülitatakse sisse Partner Systemis, toode «Bank payments».",
              EN: "Bank links are not switched on at Montonio — at checkout a customer will see only the card. Switch them on in the Partner System, product «Bank payments».",
            }
          : {
              RU: "Пока не знаем: список включённых способов оплаты у Montonio запросить не удалось. Если строка с ключами выше зелёная, откройте этот экран ещё раз через несколько минут.",
              ET: "Veel ei tea: Montoniolt ei õnnestunud sisse lülitatud makseviiside nimekirja küsida. Kui ülalolev võtmete rida on roheline, avage see ekraan mõne minuti pärast uuesti.",
              EN: "Not known yet: the list of enabled payment methods could not be fetched from Montonio. If the keys row above is green, open this screen again in a few minutes.",
            },
  });

  /* The row this screen exists for. «Bank payments» on and «Refundable bank
     payments» off is a shop that looks perfect until somebody asks for money
     back — and it cannot be discovered any other way, because Montonio has no
     endpoint for it.
     What it may NOT do is answer from the wrong order. The reference: «will be
     true if you enabled refunds in montonio (and the user paid with a
     refundable method)» — cards and wallets are refundable by default, so a
     card order says nothing at all about the bank-link product. The route now
     samples a bank order where there is one; where there is not, this row says
     which method it did see and waits (audit 18.09.2026, F12). */
  const refundable = state.refundableBankPayments;
  const sampleMethod = String(state.refundSampleMethod ?? "").trim();
  const notBankSample = !!sampleMethod && sampleMethod !== MONTONIO_BANK_METHOD;
  rows.push({
    key: "refunds",
    ok: refundable !== false,
    quiet: refundable === null,
    name: { RU: "Возврат денег покупателю", ET: "Raha tagastamine kliendile", EN: "Refunds to the customer" },
    sub:
      refundable === true
        ? {
            RU: "Возвраты включены: «Вернуть деньги» в карточке заказа работает. Деньги можно вернуть через один рабочий день после оплаты — раньше они ещё не дошли на счёт магазина.",
            ET: "Tagasimaksed on sisse lülitatud: tellimuse kaardil olev «Вернуть деньги» töötab. Raha saab tagastada ühe tööpäeva pärast makset — varem ei ole see poe kontole jõudnud.",
            EN: "Refunds are on: «Вернуть деньги» on the order card works. Money can go back one business day after the payment — before that it has not reached the shop's account.",
          }
        : refundable === false
          ? {
              RU: "Возвраты по банковским ссылкам ВЫКЛЮЧЕНЫ у Montonio. Оплата проходит, а вернуть деньги покупателю нельзя — ни отсюда, ни из панели Montonio. Включается в Partner System, продукт «Refundable bank payments», и только в боевом режиме.",
              ET: "Pangalinkide tagasimaksed on Montonios VÄLJA lülitatud. Maksed toimivad, aga raha kliendile tagastada ei saa — ei siit ega Montonio paneelist. Lülitatakse sisse Partner Systemis, toode «Refundable bank payments», ja ainult päris režiimis.",
              EN: "Refunds on bank links are OFF at Montonio. Payments work, but no money can go back to a customer — neither from here nor from Montonio's own panel. Switch it on in the Partner System, product «Refundable bank payments», and only in live mode.",
            }
          : notBankSample
            ? {
                /* F12: the probe used to take the newest paid order whatever
                   it was. A card order answers about CARDS — they are
                   refundable by default — so `true` there said nothing about
                   the one product this row is here for, and the row went green
                   and stayed green. */
                RU: "Пока не знаем: последний оплаченный заказ прошёл не банковской ссылкой, а способом «" + sampleMethod + "». Про карты Montonio почти всегда отвечает «вернуть можно», и про банковские ссылки это ничего не говорит. Ответ появится здесь после первой оплаты через банк.",
                ET: "Veel ei tea: viimane makstud tellimus ei tulnud pangalingiga, vaid viisiga «" + sampleMethod + "». Kaartide kohta vastab Montonio peaaegu alati «tagastada saab», ja pangalinkide kohta ei ütle see midagi. Vastus ilmub siia pärast esimest pangamakset.",
                EN: "Not known yet: the last paid order did not come through a bank link but by «" + sampleMethod + "». About cards Montonio almost always answers «refundable», and that says nothing about bank links. The answer will appear here after the first bank payment.",
              }
            : {
                RU: "Пока не знаем: у Montonio нет способа спросить об этом напрямую, ответ виден только по оплаченному заказу. Как только пройдёт первая оплата банковской ссылкой, эта строка скажет точно.",
                ET: "Veel ei tea: Montoniol ei ole võimalust seda otse küsida, vastus on näha ainult makstud tellimuse pealt. Kohe kui esimene pangalingi makse läbi läheb, ütleb see rida täpselt.",
                EN: "Not known yet: Montonio has no way to ask this directly — the answer only shows on a paid order. As soon as the first bank-link payment goes through, this row will say for certain.",
              },
  });

  /* What this store may actually book with. Computed since the screen was
     written and never shown (audit 18.09.2026, F14/F29): a carrier the
     checkout offers and this list does not name is a booking that fails on the
     first live order. */
  rows.push({
    key: "carriers",
    ok: state.carriers === null || state.carriers > 0,
    quiet: state.carriers === null,
    name: { RU: "Перевозчики у Montonio", ET: "Vedajad Montonios", EN: "Carriers at Montonio" },
    sub:
      state.carriers === null
        ? {
            RU: "Пока не знаем: список перевозчиков у Montonio запросить не удалось. Если строка с ключами выше зелёная, откройте этот экран ещё раз через несколько минут.",
            ET: "Veel ei tea: Montoniolt ei õnnestunud vedajate nimekirja küsida. Kui ülalolev võtmete rida on roheline, avage see ekraan mõne minuti pärast uuesti.",
            EN: "Not known yet: the list of carriers could not be fetched from Montonio. If the keys row above is green, open this screen again in a few minutes.",
          }
        : state.carriers > 0
          ? {
              RU: "Montonio назвал перевозчиков: " + state.carriers + ". Наклейка печатается из карточки заказа.",
              ET: "Montonio nimetas vedajaid: " + state.carriers + ". Silt prinditakse tellimuse kaardilt.",
              EN: "Montonio named " + state.carriers + " carriers. The label prints from the order card.",
            }
          : {
              RU: "Montonio не назвал ни одного перевозчика — посылку создать не получится. Перевозчики включаются в Partner System → Shipping, там же берётся договор Montonio или подключается свой.",
              ET: "Montonio ei nimetanud ühtegi vedajat — pakki ei õnnestu luua. Vedajad lülitatakse sisse Partner System → Shipping, sealsamas võetakse Montonio leping või ühendatakse enda oma.",
              EN: "Montonio named no carriers at all — a parcel cannot be created. Carriers are switched on in Partner System → Shipping, where you either take Montonio's own contract or connect your own.",
            },
  });

  /* Registered ≠ registered HERE.
     Until 19.09.2026 this row was green for `webhooks.length > 0`: url,
     trailing slash and events all discarded (audit 18.09.2026, F13). The
     likeliest day-one state after the domain move is the one that passed — a
     webhook still pointing at the old host — and a POST to the right path
     without the final slash is a 308 that never reaches the route. */
  const hook = state.webhook;
  const hookKnown = !!hook && !!hook.expectedUrl;
  const hookOk = !!hook && hook.state === "ok";
  rows.push({
    key: "ship_webhook",
    /* A webhook we could not check is not a webhook we know is wrong. */
    ok: !hook || hook.state === "ok",
    quiet: !hook || !hookKnown,
    name: { RU: "Montonio сообщает о посылках", ET: "Montonio teatab pakkidest", EN: "Montonio reports on parcels" },
    sub: !hook
      ? {
          RU: "Пока не знаем: список вебхуков у Montonio запросить не удалось. Если ключи выше в порядке, откройте этот экран ещё раз через несколько минут.",
          ET: "Veel ei tea: Montoniolt ei õnnestunud veebihaakide nimekirja küsida. Kui ülalolevad võtmed on korras, avage see ekraan mõne minuti pärast uuesti.",
          EN: "Not known yet: the list of webhooks could not be fetched from Montonio. If the keys above are fine, open this screen again in a few minutes.",
        }
      : hookOk && !hookKnown
        ? {
            /* PUBLIC_BASE_URL unset — there is a webhook and the events are
               right, but nothing to compare the address against, and saying
               «настроено» about an address we never read is exactly the class
               of claim this screen exists to stop. */
            RU: "Вебхук у Montonio есть и события отмечены верно, но проверить адрес не с чем: на сервере не задан адрес магазина. Это настройка на сервере, её делает Дим.",
            ET: "Montonios on veebihaak olemas ja sündmused on õigesti märgitud, aga aadressi ei ole millegagi võrrelda: serveris ei ole poe aadressi määratud. See on serveri seadistus, seda teeb Dim.",
            EN: "Montonio has a webhook and the events are ticked correctly, but there is nothing to check the address against: the shop's address is not set on the server. This is a server setting; Dim does it.",
          }
        : hookOk
          ? {
              RU: "Настроено: заказ сам станет «Доставлен», когда посылку заберут, и сам скажет, если перевозчик её не принял.",
              ET: "Seadistatud: tellimus muutub ise olekuks «Доставлен», kui pakk kätte saadakse, ja ütleb ise, kui vedaja seda vastu ei võtnud.",
              EN: "Set up: an order turns «Доставлен» by itself once the parcel is collected, and says so by itself if the carrier refused it.",
            }
          : hook.state === "none"
            ? {
                RU: "Montonio не знает, куда сообщать о посылках. Заказы не будут закрываться сами, а отказ перевозчика останется незамеченным. Адрес прописывается один раз: Partner System → Shipping → Webhooks" + urlTail(hook.expectedUrl) + ".",
                ET: "Montonio ei tea, kuhu pakkidest teatada. Tellimused ei sulgu ise ja vedaja keeldumine jääb märkamata. Aadress sisestatakse üks kord: Partner System → Shipping → Webhooks" + urlTail(hook.expectedUrl) + ".",
                EN: "Montonio does not know where to report parcels. Orders will not close by themselves and a carrier's refusal will go unnoticed. The address is entered once, in Partner System → Shipping → Webhooks" + urlTail(hook.expectedUrl) + ".",
              }
            : hook.state === "wrong_url"
              ? {
                  RU: "Montonio сообщает о посылках не сюда: у него записано «" + listOf(hook.urls) + "», а нужно «" + hook.expectedUrl + "». Адрес должен совпадать до последнего знака, включая слэш в конце. Пока так, заказы не будут закрываться сами. Исправляется в Partner System → Shipping → Webhooks.",
                  ET: "Montonio ei teata pakkidest siia: tal on kirjas „" + listOf(hook.urls) + "\", aga vaja on „" + hook.expectedUrl + "\". Aadress peab kattuma viimse märgini, kaasa arvatud kaldkriips lõpus. Seni ei sulgu tellimused ise. Parandatakse: Partner System → Shipping → Webhooks.",
                  EN: "Montonio does not report parcels here: it has \"" + listOf(hook.urls) + "\" written down, and it needs \"" + hook.expectedUrl + "\". The address must match to the last character, the trailing slash included. Until then orders will not close by themselves. Fix it in Partner System → Shipping → Webhooks.",
                }
              : {
                  RU: "Адрес записан верно, но у вебхука не отмечены события: " + listOf(hook.missingEvents) + ". Без них заказ не станет «Доставлен» сам, а отказ перевозчика не попадёт в журнал. Отмечаются там же: Partner System → Shipping → Webhooks.",
                  ET: "Aadress on õigesti kirjas, aga veebihaagil ei ole märgitud sündmusi: " + listOf(hook.missingEvents) + ". Ilma nendeta ei muutu tellimus ise olekuks «Доставлен» ja vedaja keeldumine ei jõua päevikusse. Märgitakse sealsamas: Partner System → Shipping → Webhooks.",
                  EN: "The address is right, but the webhook does not have these events ticked: " + listOf(hook.missingEvents) + ". Without them an order will not turn «Доставлен» by itself and a carrier's refusal will not reach the journal. Tick them in the same place: Partner System → Shipping → Webhooks.",
                },
  });

  if (state.pendingRefunds > 0) {
    const n = state.pendingRefunds;
    const over = state.overdueRefunds;
    rows.push({
      key: "pending_refunds",
      ok: over === 0,
      quiet: over === 0,
      name: { RU: "Возвраты в пути", ET: "Tagasimaksed teel", EN: "Refunds on the way" },
      sub: over
        ? {
            RU: "Возвратов ждут: " + n + ", из них " + over + " висят больше 10 дней — Montonio их уже отменил, деньги остались в магазине. Откройте эти заказы и верните деньги заново.",
            ET: "Ootel tagasimakseid: " + n + ", neist " + over + " on rippunud üle 10 päeva — Montonio on need juba tühistanud, raha jäi poodi. Avage need tellimused ja tehke tagasimakse uuesti.",
            EN: "Refunds waiting: " + n + ", of which " + over + " have been sitting for more than 10 days — Montonio has cancelled them and the money stayed with the shop. Open those orders and refund again.",
          }
        : {
            RU: "Возвратов ждут: " + n + ". Montonio их принял, но деньги ещё не у покупателей. Обычно это один рабочий день.",
            ET: "Ootel tagasimakseid: " + n + ". Montonio võttis need vastu, aga raha ei ole veel klientideni jõudnud. Tavaliselt võtab see ühe tööpäeva.",
            EN: "Refunds waiting: " + n + ". Montonio accepted them, but the money is not with the customers yet. This normally takes one business day.",
          },
    });
  }

  return rows;
}

/** The refusal for a shipment Montonio answered 200 `registrationFailed` for. */
export function shipmentRegistrationFailed(detail?: string | null): ShipmentRefusalReading {
  const reading = readShipmentRefusal(detail);
  if (reading.reason !== "unknown") return reading;
  return {
    reason: "registration_failed",
    montonio: String(detail ?? "registrationFailed"),
    status: reading.status,
    messages: SHIPMENT_TEXT.registration_failed,
  };
}
