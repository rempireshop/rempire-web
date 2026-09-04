#!/usr/bin/env node
/* i18n coverage report for the storefront.
 *
 *   npm run i18n:gaps            grouped list of untranslated fragments
 *   npm run i18n:gaps -- --all   also print the fragments the dictionary covers
 *   npm run i18n:gaps -- --json  machine-readable output
 *
 * How the shop translates (public/shop2/app.js): Russian is the source, every
 * template renders RU, and translateTree() rewrites the DOM afterwards. It
 * rewrites a text node when the node's whole trimmed value is a key in
 * UI[lang], or when it matches one of the UI_RX rules; the same is done for the
 * placeholder / aria-label / title / label attributes.
 *
 * So this tool reproduces that test statically:
 *   1. tokenise app.js and chat.js into string literals and code;
 *   2. re-join literals that are glued together with `+` into one chunk, with
 *       standing in for the interpolated expression — that is what the
 *      browser actually ends up with;
 *   3. cut each chunk into text nodes on tag boundaries, and pull out the four
 *      translatable attributes;
 *   4. test every fragment against the dictionary and the regex rules
 *      (a fragment with  is probed with sample values, so "от " + n + " €"
 *      is recognised as covered by /^от (\d.*)$/);
 *   5. group what is left by the function it lives in.
 *
 * Nothing is written; this only reports.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "public/shop2/app.js");
const CHAT = join(ROOT, "public/shop2/chat.js");

const CYR = /[А-Яа-яЁё]/;
const HOLE = "";

/* ---------- tokeniser ---------------------------------------------------- */
/* Strings, comments and regex literals only — enough to tell a quote that
   opens a literal from a quote inside a comment or a character class. */
function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  let codeFrom = 0;
  let codeLine = 1;
  const push = (t, v, l) => toks.push({ t, v, l });
  const flushCode = (end) => {
    if (end > codeFrom) push("code", src.slice(codeFrom, end), codeLine);
  };
  const regexAllowed = () => {
    for (let k = toks.length - 1; k >= 0; k--) {
      if (toks[k].t !== "code") return false; // a string cannot precede a regex
      const c = toks[k].v.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").trimEnd();
      if (!c) continue;
      const last = c[c.length - 1];
      if ("(,=:[!&|?{};+-*%~^<>".includes(last)) return true;
      return /\b(return|typeof|instanceof|in|of|new|delete|void|throw|do|else|case|yield|await)$/.test(c);
    }
    return true;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; }
      i += 2;
      continue;
    }
    if (c === "/" && regexAllowed()) {
      // a regex literal: skip it, character classes and all
      let j = i + 1, cls = false, ok = false;
      for (; j < src.length; j++) {
        const d = src[j];
        if (d === "\\") { j++; continue; }
        if (d === "\n") break;
        if (d === "[") cls = true;
        else if (d === "]") cls = false;
        else if (d === "/" && !cls) { ok = true; break; }
      }
      if (ok) { i = j + 1; while (/[a-z]/.test(src[i] || "")) i++; continue; }
    }
    if (c === '"' || c === "'" || c === "`") {
      flushCode(i);
      const startLine = line;
      let j = i + 1;
      let out = "";
      for (; j < src.length; j++) {
        const d = src[j];
        if (d === "\\") {
          const e = src[j + 1];
          out += e === "n" ? "\n" : e === "t" ? "\t" : e === "u" ? unescapeU(src, j) : e;
          if (e === "u") j += 5; else j++;
          continue;
        }
        if (d === c) break;
        if (d === "\n") { line++; if (c !== "`") break; }
        if (c === "`" && d === "$" && src[j + 1] === "{") {
          let depth = 1;
          j += 2;
          for (; j < src.length && depth; j++) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            else if (src[j] === "\n") line++;
          }
          j--;
          out += HOLE;
          continue;
        }
        out += d;
      }
      push("str", out, startLine);
      i = j + 1;
      codeFrom = i;
      codeLine = line;
      continue;
    }
    i++;
  }
  flushCode(src.length);
  return toks;
}
function unescapeU(src, j) {
  const hex = src.slice(j + 2, j + 6);
  return /^[0-9a-f]{4}$/i.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : "u";
}

/* Two string literals joined by `+ … +` end up as one string in the DOM. */
function chunks(toks) {
  const out = [];
  let cur = null;
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").trim();
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t === "str") {
      const before = k > 0 && toks[k - 1].t === "code" ? strip(toks[k - 1].v) : "";
      // `{ RU: "…", ET: "…", EN: "…" }` — the RU branch of a per-language map
      // is already localised next to itself, so it is not a gap
      if (!cur && /\bRU\s*:$/.test(before)) continue;
      if (cur) cur.v += tk.v;
      else cur = { v: (before.endsWith("+") ? HOLE : "") + tk.v, l: tk.l };
      const next = toks[k + 1];
      const glue = next && next.t === "code" ? strip(next.v) : "";
      if (glue === "+") continue;                                  // "a" + "b"
      if (/^\+[\s\S]*\+$/.test(glue) && toks[k + 2] && toks[k + 2].t === "str") {
        cur.v += HOLE;                                             // "a" + x + "b"
        continue;
      }
      if (glue.startsWith("+")) cur.v += HOLE;                     // "a" + x;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ---------- the dictionary as the shop sees it --------------------------- */
function readDict(src) {
  const start = src.indexOf("var UI = {");
  const rxStart = src.indexOf("var UI_RX = [");
  const dictBlock = src.slice(start, rxStart);
  const etAt = dictBlock.indexOf("ET: {");
  const enAt = dictBlock.indexOf("EN: {");
  // a key is a literal followed by a colon; a value is anything else
  const parseKeys = (block) => {
    const toks = tokenize(block).filter((t) => t.t !== "code" || t.v.trim());
    const keys = new Set();
    const dupes = [];
    for (let k = 0; k < toks.length; k++) {
      if (toks[k].t !== "str") continue;
      const after = (toks[k + 1] && toks[k + 1].t === "code" ? toks[k + 1].v : "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!after.startsWith(":")) continue;
      if (keys.has(toks[k].v)) dupes.push(toks[k].v);
      keys.add(toks[k].v);
    }
    return { keys, dupes };
  };
  const et = parseKeys(dictBlock.slice(etAt, enAt));
  const en = parseKeys(dictBlock.slice(enAt));
  const rxBlock = src.slice(rxStart, src.indexOf("var NAME_TAILS", rxStart));
  const rules = [];
  const rxLine = /\[\s*\/(\^[\s\S]*?)\/\s*,/g;
  let m;
  while ((m = rxLine.exec(rxBlock))) {
    try { rules.push(new RegExp(m[1])); } catch { /* ignore */ }
  }
  return { et: et.keys, en: en.keys, rules, dupes: { ET: et.dupes, EN: en.dupes } };
}

/* ---------- HTML → the text nodes translateTree() would walk ------------- */
const TR_ATTRS = ["placeholder", "aria-label", "title", "label"];
function fragments(html) {
  const out = [];
  const attrRx = new RegExp(`(${TR_ATTRS.join("|")})\\s*=\\s*("([^"]*)"|'([^']*)')`, "gi");
  let m;
  while ((m = attrRx.exec(html))) {
    const v = (m[3] !== undefined ? m[3] : m[4]).trim();
    if (v && CYR.test(v)) out.push({ text: v, kind: m[1].toLowerCase() });
  }
  /* A chunk can begin or end in the middle of a tag (the markup was cut at a
     string-literal boundary). Drop those halves, or their attributes read as
     visible text. */
  let body = html;
  const lt = body.indexOf("<");
  const gt = body.indexOf(">");
  if (gt >= 0 && (lt < 0 || gt < lt)) body = body.slice(gt + 1);
  const lastLt = body.lastIndexOf("<");
  const lastGt = body.lastIndexOf(">");
  if (lastLt >= 0 && lastLt > lastGt) body = body.slice(0, lastLt);
  // strip tags; each gap between tags is one text node
  const parts = body.split(/<[^>]*>/);
  for (const p of parts) {
    const t = p.replace(/&nbsp;/g, " ").trim();
    if (t && CYR.test(t)) out.push({ text: t, kind: "text" });
  }
  return out;
}

/* A fragment carrying  is a runtime string; probe a few shapes so the
   regex rules get a fair test. */
/* Sample values a hole can take at runtime. The first four are also the set
   used for fragments with three or four holes, so keep the common shapes —
   a count, a plural word, a sum, a point count — at the front. */
const PROBES = ["59", "товаров", "12,90 €", "469 точек", "Omniva", "31.12.2026", "R-100042", "Товар", "12"];
function candidates(text) {
  const parts = text.split(HOLE);
  if (parts.length === 1) return [text];
  if (parts.length > 5) return PROBES.map((p) => parts.join(p));
  const probes = parts.length > 3 ? PROBES.slice(0, 4) : PROBES;
  let acc = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const next = [];
    for (const a of acc) for (const p of probes) next.push(a + p + parts[i]);
    acc = next;
  }
  return acc;
}
function covered(text, dict, rules) {
  if (dict.has(text)) return "key";
  for (const c of candidates(text)) for (const r of rules) if (r.test(c)) return "rx";
  return null;
}

/* ---------- deliberately Russian ----------------------------------------
   Checked by hand and left alone: either the string never reaches the DOM as
   a text node of its own, or it is Russian on purpose. Keeping the list here
   (instead of dropping the strings silently) means the next run still shows
   them, with the reason. */
const INTENTIONAL = [
  [/^(Русский|Eesti|English)$/, "language menu — each language names itself"],
  [/^(шампунь|кондиционер|маска|паста|спрей|воск|гель|пудра|масло|бальзам|сыворотка|тоник|крем|пенка|лосьон|патчи)$/,
    "product-type key used for matching (TYPE_MATES / NAME_TAILS), never rendered"],
  [/^(товар|товара|товаров|точка|точки|точек|раздел|раздела|разделов|заказ|заказа|заказов|балл|балла|баллов)$/,
    "plural word form — pl() glues it to a number, the composed string is translated"],
  [/^[А-ЯЁ]\. [А-ЯЁ][а-яё]+$/, "demo customer name in the admin — names are not translated"],
  [/^от$/, "price prefix — glued to the amount, «от 12,90 €» is covered by a UI_RX rule"],
  [/^Напиши SEO title/, "prompt text sent to the model, never shown to anyone"],
  // integration: stock_moves.ref free text — a fixed "who moved this" tag
  // shown only in the ledger's own history row, same "Russian by decision"
  // convention as every other free-text audit/note field in this file
  [/^(помощник|сканер|панель)$/, "stock_moves.ref tag (applyStockAction/scanner buttons) — shown in the moves history row, Russian by convention like a note field"],
  [/^отмена начисления$/, "loyalty ledger note on an assistant-driven points undo — free-text note field, Russian by convention"],
  // integration: montonioSourceLabel()'s two branches — a ternary with no
  // "+" involved, so each string is its own fragment here; the rendered
  // sentence is always this label plus a price, covered by the UI_RX rules
  // /^тариф Montonio \(live\): (.+)$/ and /^тариф Montonio \(прайс-лист\): (.+)$/
  [/^тариф Montonio \((live|прайс-лист)\):$/, "prefix half of montonioHint()/montonioCarrierHint()'s sentence — see the two UI_RX rules for the whole thing"],
];
/* Fragments that are only half of a string the shop assembles at runtime: the
   extractor cuts at the string-literal boundary, the browser does not. Each
   one was checked by hand against the key or rule that covers the whole
   rendered node — that key/rule is named in the note. */
const ASSEMBLED = [
  [/^из $/, "half of «5 из 100» — rule /^(\\d+) из (\\d+)$/"],
  [/^Скидка$/, "«Скидка» on its own is a key; with a code it is rule /^Скидка · (.+)$/"],
  [/^Показаны первые 24 из /, "rules /^Показаны первые 24 из (\\d+)( по запросу «(.+)»)?$/"],
  // integration: admin «Склад» search — same two-hole chunking artifact as
  // the catalogue's own "24" case just above, only the shown-count differs
  [/^Показаны первые 60 из /, "rules /^Показаны первые 60 из (\\d+)( по запросу «(.+)»)?$/, plus the shared /^(\\d+) товар… по запросу «(.+)»$/"],
  [/^по запросу «$/, "tail of the goods-list count — same two rules"],
  [/^Заканчиваются .* Срочно: /, "rule /^Заканчиваются (\\d+) товар… Могу собрать заказ…$/"],
  [/^\. Могу собрать заказ поставщику/, "tail of the same assistant answer — same rule"],
  [/^Купить через $/, "key «Купить через» — the hole is the Apple/Google Pay logo markup"],
  [/^Популярные запросы: $/, "key «Популярные запросы:» — the hole is the chip markup"],
  [/^Пакомат по умолчанию — $/, "rule /^Пакомат по умолчанию — (\\d+) точк…$/"],
  [/^Тарифы — прайс-листы перевозчиков/, "the FI and EU variants are both full dictionary keys"],
  [/^Сейчас: пакомат Эстония /, "rule /^Сейчас: пакомат Эстония … docs\\/shipping\\.md\\.$/"],
  [/^\. За пределами Эстонии значения/, "tail of the same note — same rule"],
  [/^Пришлите фото и цену/, "key — the hole is the aiGo() button markup"],
  [/^За неделю 412 посетителей/, "key — the hole is the aiGo() button markup"],
  [/^Письма магазин шлёт сам/, "key — the hole is the aiGo() button markup"],
  [/^Вот что подключено к магазину/, "key — the hole is the aiGo() button markup"],
  [/^Отправки ждут 2 заказа/, "key — the hole is the aiGo() button markup"],
  [/^Напишите нам — поможем подобрать замену: $/, "key — the hole is the phone/e-mail link markup"],
  // integration: orderDetailSrv's POS-channel chip — the ternary literals
  // inside break the "+"-only glue heuristic, but the rendered node is
  // always one whole runtime string, and one of these three plain keys:
  // «Салон», «Салон · Терминал», «Салон · Наличные» (payment words reuse the
  // existing capitalised POS-button keys, not a separate lowercase copy)
  [/^Салон/, "keys «Салон» / «Салон · Терминал» / «Салон · Наличные» (orderDetailSrv)"],
  // integration: admStockHTML's «Сканировать» button — icon("scan") returns
  // an inline <svg>, a sibling element, not text; the hole here is that
  // element, not a runtime value glued into the same text node. «Сканировать»
  // on its own is already a real key (used since the storefront pass).
  [/^(Сканировать|Приёмка)$/, "keys «Сканировать» / «Приёмка» — the hole is the icon's <svg>, a separate element, not text"],
];
function assembled(text) {
  if (!text.includes(HOLE)) return null;
  const flat = text.split(HOLE).join(" ");
  for (const [rx, why] of ASSEMBLED) {
    if (rx.test(flat)) return "assembled at runtime: " + why;
    for (const seg of text.split(HOLE)) if (rx.test(seg)) return "assembled at runtime: " + why;
  }
  return null;
}

/* chat.js is not covered by the app.js dictionary at all — it carries its own
   RU/ET/EN table. Only two things there are not gaps. */
function chatWhy(fr, fn) {
  if (fn === "match") return INTENTIONAL[1][1];
  if (fr.kind === "aria-label") {
    return "written in Russian in the markup, then set from T by paintLabels() on load and on every open";
  }
  return null;
}

/* Whole functions whose Russian output is deliberate. */
const INTENTIONAL_FNS = {
  actionText: "change-log line in Renat's private admin journal — Russian by decision",
  admCancelLine: "change-log line in Renat's private admin journal — Russian by decision",
  // админка: the draft the assistant writes for «Написать клиенту» is a letter
  // TO the customer, so it stays in the customer's language, not the panel's
  admOrderDraft: "the draft letter to the customer — written in the customer's language, not the panel's",
  shipActionText: "change-log line in Renat's private admin journal — Russian by decision",
  contentActionText: "change-log line in Renat's private admin journal — Russian by decision",
  promoActionText: "change-log line in Renat's private admin journal — Russian by decision",
  // integration: data tables, never rendered as their own text node — a
  // per-letter transliteration map (blogSlugify()) and a month-name array
  // whose only reader is monthLabelRu(), itself only ever called from the
  // already-exempted actionText() above
  BLOG_TRANSLIT: "transliteration table (blogSlugify()) — object keys/values, never rendered",
  MONTH_RU: "month names for monthLabelRu(), consumed only by the exempted actionText() above",
};
function intentional(text, fn) {
  if (INTENTIONAL_FNS[fn]) return INTENTIONAL_FNS[fn];
  const a = assembled(text);
  if (a) return a;
  for (const [rx, why] of INTENTIONAL) if (rx.test(text)) return why;
  return null;
}

/* ---------- which function does a line belong to ------------------------- */
function fnIndex(src) {
  const lines = src.split("\n");
  const marks = [];
  lines.forEach((l, i) => {
    // top level of the IIFE only — an inner `var rows = [` is not a region
    let m = l.match(/^ {2}function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (!m) m = l.match(/^ {2}var\s+([A-Za-z0-9_$]+)\s*=\s*(?:function|\{|\[)/);
    if (m) marks.push([i + 1, m[1]]);
  });
  return (line) => {
    let name = "(top level)";
    for (const [ln, n] of marks) { if (ln > line) break; name = n; }
    return name;
  };
}

/* Coarse buckets so the report reads like the shop, not like the file. */
const REGION_RULES = [
  [/^(screenCheckout|shipField|shipMsg|shipMissing|shipRequired|shipBad|shipEmpty|failStep|coHead|deliveryPicker|carrierLabel|pointField|pointRows|pointSheet|patchPointList|pointsArrived|payNow|payMark|orderErrText|orderPayload|clearOrderState|finishDemo|emailMsg|patchEmail|patchShip|SHIP_MSG|ORDER_ERRS|BANK_CODES|PAYS|BANKS|SHIP_ERR)$/, "Checkout"],
  [/^(screenProduct|acc|variantPicker|complementsFor|descFor|colourRu|COLOUR_RU|splitVariants|reviewsFor|reviewsHTML|dbReviewsHTML|reviewFormHTML|reviewReady|sendReview|REV_ERR|videoHTML|videoOf|patchPdp|media)$/, "Product page (PDP)"],
  [/^(screenSearch|searchResults|stem)$/, "Search"],
  [/^(screenAccount|acctIdx)$/, "Account"],
  [/^(screenCatalog|filtered|subcatsFor|SUBCATS|activeChips|fcountLabel|moreHTML|showLabel|filterDrawer|patchCatalog|cardHTML|plural|points|pl)$/, "Catalogue and filters"],
  [/^(screenHome|rail|spread|heroDefault|heroHTML|heroSlideHTML|heroT|heroArt|heroUrl|heroGoAttr|heroProduct|BANNERS|bannerProduct|screenBrands|brands|BRAND_LOGOS|screenInfo|legalFor)$/, "Home, brands, info"],
  [/^(cartBody|cartFoot|cartDrawer|upsellHTML|rebuildCart|patchCart|addToCart|addBundleToCart|addGiftToCart|lineTitle|lineNoteHTML|lineLabel|lineVariant|LINE_KIND|freebarText|COUNTRY_SHORT)$/, "Cart"],
  [/^(screenBundles|screenBundle|bundleCardHTML|bundleGridHTML|bundleStack|bundleItemName|bundlesForCatalog|screenGift|giftTileHTML|giftEmailBad|applyGiftCode|giftAmount|GIFT_AMOUNTS)$/, "Sets and gift cards"],
  [/^(headerHTML|patchHeader|botnavHTML|patchNav|NAVITEMS|footer|ftrSec|intro|identLogo|shareProduct|toast|paintToast|screenDone|doneState|setHead|fitTitle|setAltTags|render|go|goCat|goBrand|navTo|routeFromPath|openDrawer|closeDrawers)$/, "Shell: header, nav, footer, routing"],
  [/^(SHIP|SHIP_RULES|DELIVERY|CARRIER_NAMES|CARRIERS_BY_COUNTRY|COUNTRIES|shipMethodLabel|shipPrice|machinesFor|demoPoints|applyShipRules|loadShipRules|deliveryFor|carriersFor|SHIP_WORD)$/, "Delivery data"],
];
function regionOf(fn, file) {
  if (file === "chat.js") return "Chat widget (chat.js)";
  for (const [rx, name] of REGION_RULES) if (rx.test(fn)) return name;
  if (/^(adm|screenAdmin|ADM_|goods|hero|gal|media|MEDIA|mail|MAIL|srv|SRV|order|ORDER_STATES|fake|kpi|setupBlock|demo|DEMO|confirmCard|actionText|adminAnswer|askAdminAI|probeAdm|pushOverride|FLOW_NAMES|moderateReview|loadAdminReviews|REV_TABS|upBusyText|upFail|uploadPhoto|TAB_LABEL|aiGo|UP\b|GAL|checkAdmin|loadServerOverrides|adoptServer|SRV_STATES|MAX_PHOTOS|HERO_)/i.test(fn)) return "Admin panel";
  return "Other";
}

/* ---------- run ---------------------------------------------------------- */
const appSrc = readFileSync(APP, "utf8");
const chatSrc = readFileSync(CHAT, "utf8");
const dict = readDict(appSrc);

const dictStart = appSrc.indexOf("var UI = {");
const dictEnd = appSrc.indexOf("function trName");
const dictFromLine = appSrc.slice(0, dictStart).split("\n").length;
const dictToLine = appSrc.slice(0, dictEnd).split("\n").length;

/* chat.js keeps its own RU/ET/EN table; that block is not a gap. */
const chatT = chatSrc.indexOf("var T = {");
const chatTEnd = chatSrc.indexOf("var CATS_KW", chatT);
const chatFrom = chatSrc.slice(0, chatT).split("\n").length;
const chatTo = chatSrc.slice(0, chatTEnd).split("\n").length;

const files = [
  { name: "app.js", src: appSrc, skip: (l) => l >= dictFromLine && l <= dictToLine },
  { name: "chat.js", src: chatSrc, skip: (l) => l >= chatFrom && l <= chatTo },
];

const rows = [];
const seen = new Map();
for (const f of files) {
  const whichFn = fnIndex(f.src);
  for (const ch of chunks(tokenize(f.src))) {
    if (f.skip(ch.l)) continue;
    if (!CYR.test(ch.v)) continue;
    for (const fr of fragments(ch.v)) {
      const fn = whichFn(ch.l);
      const key = f.name + "|" + fr.text + "|" + fr.kind;
      /* translateTree() walks hdrSlot / bodySlot / navSlot / ovl only, and
         chat.js appends its root straight to document.body — so the app.js
         dictionary never reaches it. Its own T table is the only cover. */
      const et = f.name === "chat.js" ? null : covered(fr.text, dict.et, dict.rules);
      const en = f.name === "chat.js" ? null : covered(fr.text, dict.en, dict.rules);
      const rec = seen.get(key) || {
        text: fr.text, kind: fr.kind, et, en,
        // chat.js has no dictionary cover, so only its truly internal words
        // (the product-type keys its matcher uses) are excused there
        why: f.name === "chat.js" ? chatWhy(fr, fn) : intentional(fr.text, fn),
        region: regionOf(fn, f.name), fn, file: f.name, lines: [],
      };
      rec.lines.push(ch.l);
      if (!seen.has(key)) { seen.set(key, rec); rows.push(rec); }
    }
  }
}

const untranslated = rows.filter((r) => !r.et || !r.en);
const missing = untranslated.filter((r) => !r.why);
const kept = untranslated.filter((r) => r.why);
const args = process.argv.slice(2);
if (args.includes("--json")) {
  console.log(JSON.stringify({
    total: rows.length, missing: missing.length, intentional: kept.length,
    rows: args.includes("--all") ? rows : missing,
  }, null, 2));
  process.exit(0);
}

const show = args.includes("--all") ? rows : missing;
const byRegion = new Map();
for (const r of show) {
  if (!byRegion.has(r.region)) byRegion.set(r.region, []);
  byRegion.get(r.region).push(r);
}
const order = [...byRegion.keys()].sort((a, b) => byRegion.get(b).length - byRegion.get(a).length);

const vis = (s) => s.replace(new RegExp(HOLE, "g"), "{…}");
console.log("i18n coverage — public/shop2/app.js + chat.js");
console.log(`dictionary: ${dict.et.size} ET keys · ${dict.en.size} EN keys · ${dict.rules.length} UI_RX rules`);
console.log(`visible Russian fragments outside the dictionary: ${rows.length}`);
console.log(`untranslated: ${missing.length}   ·   deliberately Russian: ${kept.length}`);
for (const region of order) {
  const list = byRegion.get(region);
  console.log(`\n── ${region} (${list.length}) ${"─".repeat(Math.max(0, 46 - region.length))}`);
  for (const r of list.sort((a, b) => a.lines[0] - b.lines[0])) {
    const mark = r.et && r.en ? "ok " : !r.et && !r.en ? "   " : r.et ? "EN " : "ET ";
    const tag = r.kind === "text" ? "" : ` [@${r.kind}]`;
    console.log(`  ${mark}${r.file}:${r.lines[0]} ${r.fn}${tag}  «${vis(r.text)}»`);
  }
}
if (kept.length) {
  console.log(`\n-- deliberately Russian (${kept.length}) ------------------------`);
  const byWhy = new Map();
  for (const r of kept) {
    if (!byWhy.has(r.why)) byWhy.set(r.why, []);
    byWhy.get(r.why).push(vis(r.text));
  }
  for (const [why, list] of byWhy) console.log(`  ${why}\n    ${list.join(" · ")}`);
}
for (const lang of ["ET", "EN"]) {
  const d = dict.dupes[lang];
  if (d.length) console.log(`\n${lang} duplicate keys (the later value silently wins): ${d.join(" | ")}`);
}
const gap = [...dict.et].filter((k) => !dict.en.has(k)).concat([...dict.en].filter((k) => !dict.et.has(k)));
console.log(`\nET/EN key parity: ${gap.length ? "MISMATCH — " + gap.join(" | ") : "ok (identical key sets)"}`);
if (!missing.length) console.log("No untranslated interface strings.");
