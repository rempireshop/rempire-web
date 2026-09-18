#!/usr/bin/env node
/**
 * «Какую фиксированную цену доставки назначить по каждой стране» — the grid and
 * the arithmetic, from the documented, authenticated endpoint.
 *
 *   node tools/delivery-pricing.mjs                      # every country Montonio serves
 *   node tools/delivery-pricing.mjs --countries EE,LV,FI
 *   node tools/delivery-pricing.mjs --units 4            # «типичный заказ — 4 банки»
 *   node tools/delivery-pricing.mjs --flat EE=5.59,EU=12.90
 *   node tools/delivery-pricing.mjs --dry-run            # no keys: the SAMPLE, marked as one
 *
 * Read docs/delivery-pricing.md before Sunday. The short version:
 *
 * **It stops without keys.** That is the entire point of the file. The table
 * the shop bills from today was built from `contract-prices` — an undocumented,
 * unauthenticated endpoint that answers one subtype-blind `pickupPoint` price
 * where Montonio has separate `parcelMachine`, `parcelShop` and `postOffice`
 * rates (docs/montonio-shipping-audit.md § 3.1). Those numbers are plausible
 * and may be the parcel-shop tier charged for a locker; the error never reaches
 * the customer and lands entirely on the margin. A tool that quietly fell back
 * to the same endpoint would reproduce exactly the failure it exists to
 * correct, so it does not have a fallback. No keys → exit 2 and a sentence
 * saying what to go and get.
 *
 * `--dry-run` is not that fallback: it reads a committed sample of made-up
 * numbers in Montonio's documented shape, stamps ОБРАЗЕЦ on every screen and
 * every written line, and exists so the pipeline can be proved end to end
 * before the keys turn up.
 *
 * Auth, endpoint and the cm/kg units are the same as
 * tools/fetch-montonio-tariffs.mjs — Bearer HS256 JWT whose only claims are
 * `accessKey` and `exp`. Beware the unit trap next door:
 * `/shipping-methods/rates` takes CENTIMETRES via `items[].dimensionUnit`
 * while `POST /shipments` takes metres. Both are right; they really do differ.
 */
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  bandsFrom,
  buildGrid,
  candidates,
  CARRIER_CHOICE_COUNTRIES,
  DEFAULT_BANDS,
  emptyGridDiagnosis,
  eur,
  flatPriceEconomics,
  gridAlign,
  gridHeaders,
  gridRows,
  HOLE,
  kgFmt,
  KIND_LABELS,
  KINDS,
  mdTable,
  parseRatesResponse,
  perCarrierRows,
  plural,
  rateRequestBody,
  sensitivity,
  shippingZone,
  signedEur,
  table,
  VAT_EE,
  VAT_NOTE,
  zoneRollup,
} from "./lib/delivery-pricing.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARIFFS = path.join(ROOT, "src", "data", "montonio-tariffs.json");
const SAMPLE = path.join(ROOT, "tools", "lib", "delivery-pricing.sample.json");

const log = (...a) => console.log(...a);

/* ---------- arguments ------------------------------------------------------ */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, dflt = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};

if (has("--help") || has("-h")) {
  log(`
Цены доставки: сетка «страна × вес × способ» и что на ней зарабатывается.

  --countries EE,LV,FI     только эти страны (по умолчанию — все, что возит Montonio)
  --units N                типичный заказ: N единиц товара (по умолчанию 3)
  --heaviest N             самый тяжёлый реальный заказ: N единиц (по умолчанию — верхняя полка)
  --flat-locker EE=5.59,EU=12.90   проверить цены в колонке «Пакомат»; ключ — страна или зона
  --flat-courier EE=10.84,EU=22.29 то же для колонки «Курьер»
  --flat EE=5.59                   одно число в обе колонки (обычно не то, что нужно)
  --kind locker|courier    считать решение по одному способу (по умолчанию: пакомат и курьер)
  --rates-include-vat      в ответе Montonio НДС уже внутри (по умолчанию считаем, что нет)
  --out PATH               куда записать отчёт (по умолчанию output/delivery-pricing-<дата>.md)
  --dry-run                без ключей, на выдуманном образце — чтобы проверить сам инструмент
  --json                   ещё и machine-readable сетка рядом с отчётом

Нужно до запуска: MONTONIO_ACCESS_KEY, MONTONIO_SECRET_KEY, MONTONIO_ENV=live,
и включённые у Montonio перевозчики. Эндпоинт отвечает ТОЛЬКО про перевозчиков
с контрактом Montonio — у кого только прямой договор, того в ответе просто нет.
`);
  process.exit(0);
}

const dryRun = has("--dry-run");
const ratesIncludeVat = has("--rates-include-vat");
const wantJson = has("--json");
const typicalUnits = Number(val("--units", "3")) || 3;
const heaviestUnitsArg = val("--heaviest", null);
const kindFilter = val("--kind", null);
const today = new Date().toISOString().slice(0, 10);
const outPath = path.resolve(ROOT, val("--out", path.join("output", `delivery-pricing-${today}.md`)));

/** `EE=5.59,EU=12.90` → { EE: 5.59, EU: 12.9 }. Keys may be a country or a zone. */
function parseFlat(spec) {
  const out = {};
  for (const part of String(spec || "").split(",")) {
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    const n = Number(String(v).replace(",", "."));
    if (Number.isFinite(n)) out[k.trim().toUpperCase()] = n;
  }
  return out;
}

/**
 * The rate screen has two columns — «Пакомат» and «Курьер» — and they hold
 * very different numbers (Estonia: 5.47 against 10.84). One `--flat` applied
 * to both would score a locker price against a courier cost and report a
 * disaster that is not happening, so each column gets its own flag. Bare
 * `--flat` fills both, for the case where he really is trying one number.
 */
const FLAT_BOTH = parseFlat(val("--flat", ""));
const FLAT = {
  locker: { ...FLAT_BOTH, ...parseFlat(val("--flat-locker", "")) },
  courier: { ...FLAT_BOTH, ...parseFlat(val("--flat-courier", "")) },
};
const flatFor = (kind, country) => FLAT[kind]?.[country] ?? FLAT[kind]?.[shippingZone(country)] ?? null;
const anyFlat = Object.keys(FLAT.locker).length || Object.keys(FLAT.courier).length;

/* ---------- keys, or a full stop ------------------------------------------- */

function montonioConfig() {
  const accessKey = process.env.MONTONIO_ACCESS_KEY?.trim();
  const secretKey = process.env.MONTONIO_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) return null;
  const env = process.env.MONTONIO_ENV?.trim() === "live" ? "live" : "sandbox";
  const base = env === "live" ? "https://shipping.montonio.com/api/v2" : "https://sandbox-shipping.montonio.com/api/v2";
  return { accessKey, secretKey, env, base };
}

function refuse() {
  console.error(`
ОСТАНОВ: нет ключей Montonio, а без них этот инструмент не работает.

Нужны обе переменные окружения:
  MONTONIO_ACCESS_KEY=...
  MONTONIO_SECRET_KEY=...
  MONTONIO_ENV=live          (иначе пойдёт запрос в песочницу — там цены не настоящие)

Почему нет запасного варианта. Сегодняшняя таблица цен собрана
tools/fetch-montonio-tariffs.mjs через contract-prices — эндпоинт без
документации и без авторизации, который отдаёт ОДНУ цену на «pickupPoint», а у
Montonio там три разных тарифа: parcelMachine, parcelShop, postOffice. То есть
за пакомат может быть посчитана цена пункта выдачи. Покупатель этого не увидит
никогда — разница вычитается из маржи. Инструмент, который молча свалился бы на
тот же эндпоинт, воспроизвёл бы ровно ту ошибку, ради которой он написан.

Что делать:
  1. partner.montonio.com → Shipping → включить перевозчиков, выпустить ключи.
  2. Прогнать ещё раз. Один запрос на страну на вес; 25 стран × 5 весов ≈ минута.

Проверить сам инструмент прямо сейчас, без ключей:
  node tools/delivery-pricing.mjs --dry-run
(выдуманные цифры в настоящей форме ответа Montonio, всё помечено ОБРАЗЕЦ).
`);
  process.exitCode = 2;
}

/* ---------- HS256 JWT, same as tools/fetch-montonio-tariffs.mjs ------------ */

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signHs256(payload, secret, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = b64url(Buffer.from(JSON.stringify(body)));
  const input = `${header}.${claims}`;
  return `${input}.${b64url(createHmac("sha256", secret).update(input).digest())}`;
}

/** One country, one band. Returns the parsed body, or null with the reason logged. */
async function askMontonio(config, country, band) {
  const token = signHs256({ accessKey: config.accessKey }, config.secretKey, 3600);
  const res = await fetch(`${config.base}/shipping-methods/rates`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(rateRequestBody(country, band)),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/* ---------- main ----------------------------------------------------------- */

async function main() {
  const config = dryRun ? null : montonioConfig();
  if (!dryRun && !config) return refuse();

  const bands = bandsFrom(DEFAULT_BANDS);
  const typicalBand = nearestBand(bands, typicalUnits);
  const heaviestBand = heaviestUnitsArg === null ? bands.length - 1 : nearestBand(bands, Number(heaviestUnitsArg));
  /* «Обычный заказ больше самого большого» is not a thing, and taken literally
     it would make «без убытка» cheaper than «по типичному» — a table that
     reads like nonsense, from two flags that each looked reasonable. */
  if (heaviestBand < typicalBand) {
    console.error(
      `--heaviest ${heaviestUnitsArg} меньше, чем --units ${typicalUnits}: ` +
        "самый большой заказ не может быть меньше обычного. Поправить одно из двух.",
    );
    process.exitCode = 2;
    return;
  }

  const tariffs = JSON.parse(await readFile(TARIFFS, "utf8"));
  const served = [...new Set((tariffs.rates ?? []).map((r) => String(r.country).toUpperCase()))].sort();
  const notServed = tariffs.notServed ?? [];

  let countries = (val("--countries", "") || "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  /* ---------- gather the answers ---------- */
  const answers = {};
  const failures = [];
  let stamp;

  if (dryRun) {
    const sample = JSON.parse(await readFile(SAMPLE, "utf8"));
    const available = Object.keys(sample.responses);
    countries = countries.length ? countries.filter((c) => available.includes(c)) : available;
    if (!countries.length) {
      console.error(`--dry-run: образец знает только ${available.join(", ")}. Других стран в нём нет.`);
      process.exitCode = 2;
      return;
    }
    for (const c of countries) {
      answers[c] = {};
      for (let i = 0; i < bands.length; i++) {
        const body = sample.responses[c]?.[String(i)];
        if (body) answers[c][i] = parseRatesResponse(body, { country: c });
      }
    }
    stamp = "ОБРАЗЕЦ — ВЫДУМАННЫЕ ЦИФРЫ, НЕ ЦЕНЫ MONTONIO";
    log(`\n${"#".repeat(78)}\n#  ${stamp}\n#  Форма ответа — из документации Montonio; сами цены ничего не значат.\n#  Запустить по-настоящему: выставить ключи и убрать --dry-run.\n${"#".repeat(78)}`);
  } else {
    countries = countries.length ? countries : served;
    log(`Montonio ${config.env}: спрашиваю ${countries.length} стран × ${bands.length} весов…`);
    if (config.env !== "live") {
      log("ВНИМАНИЕ: MONTONIO_ENV не «live». Песочница отдаёт неживые цены — решение по ним принимать нельзя.");
    }
    for (const c of countries) {
      answers[c] = {};
      for (let i = 0; i < bands.length; i++) {
        try {
          answers[c][i] = parseRatesResponse(await askMontonio(config, c, bands[i]), { country: c });
        } catch (err) {
          failures.push({ country: c, band: bands[i].short, why: err.message });
          log(`  ${c} ${bands[i].short}: не ответил — ${err.message}`);
        }
      }
      const got = Object.keys(answers[c]).length;
      log(`  ${c}: ${got}/${bands.length} весов, строк ${Object.values(answers[c]).reduce((n, p) => n + p.rows.length, 0)}`);
    }
    stamp = `живые цены этого магазина, ${config.env}, ${today}`;
    const anything = Object.values(answers).some((byBand) => Object.values(byBand).some((p) => p.rows.length));
    if (!anything) {
      const diag = emptyGridDiagnosis({
        failures,
        asked: countries.length * bands.length,
        env: config.env,
        base: config.base,
      });
      console.error(diag.text);
      process.exitCode = 3;
      return;
    }
    if (failures.length) {
      log(`\nВНИМАНИЕ: ${failures.length} из ${countries.length * bands.length} запросов не прошли — в сетке будут дыры.`);
      log("Это дыры, а не нули. Список — в конце отчёта.");
    }
  }

  const grid = buildGrid({ countries, bands, answers, ratesIncludeVat, vatRate: VAT_EE });
  /* A typo in --kind would otherwise filter everything away and print an empty
     run that looks like «Montonio ничего не отдал». Say which words exist. */
  if (kindFilter && !KINDS.includes(kindFilter)) {
    console.error(`--kind «${kindFilter}» не бывает. Есть: ${KINDS.join(", ")}.`);
    process.exitCode = 2;
    return;
  }
  const kinds = kindFilter ? KINDS.filter((k) => k === kindFilter) : KINDS;
  /* «Пункт выдачи» and «Почта» have no column on the rate screen — the panel
     prices «Пакомат» and «Курьер» and nothing else — so they appear in the
     grid as facts and never in the «какую цену ставить» table, which would be
     a recommendation for a box that does not exist. */
  const decisionKinds = kinds.filter((k) => k === "locker" || k === "courier");
  if (kindFilter && !decisionKinds.length) {
    log(`\nЗамечание: у «${KIND_LABELS[kindFilter] ?? kindFilter}» нет своей колонки на экране тарифов,`);
    log("поэтому ниже будет только себестоимость, без раздела «какую цену ставить».");
  }

  /* ---------- print ---------- */
  const out = [];
  const say = (s = "") => {
    log(s);
    out.push(s);
  };

  say("");
  say(`ЦЕНЫ ДОСТАВКИ — сетка и арифметика. ${today}`);
  say(`Источник: POST /shipping-methods/rates — ${stamp}`);
  say(`Типичный заказ принят за ${bands[typicalBand].label}; самый тяжёлый — ${bands[heaviestBand].label}.`);
  say(VAT_NOTE);
  say(
    ratesIncludeVat
      ? "Сейчас: --rates-include-vat, то есть цифры Montonio берутся как есть."
      : `Сейчас: к цифрам Montonio добавлено ${Math.round(VAT_EE * 100)} % НДС, чтобы сравнивать с витриной.`,
  );
  say("");
  say(`«${HOLE}» — Montonio не назвал цену. Это НЕ ноль и НЕ бесплатно: у магазина нет`);
  say("контракта на этого перевозчика в этой стране, либо маршрута нет вообще.");

  /* ---------- 1. the grid ---------- */
  for (const kind of kinds) {
    const rows = gridRows(grid, kind);
    if (rows.every((r) => r.slice(1, -1).every((c) => c === HOLE))) continue;
    say("");
    say(`— ${KIND_LABELS[kind] ?? kind}: во что обходится посылка (€, с НДС) —`);
    say("");
    say(table(gridHeaders(grid), rows, gridAlign(grid)));
  }

  /* ---------- 1b. every carrier, where the shopper is the one choosing ------
     The basis grid above shows ONE carrier per country — the one whose price
     the country's cell has to cover. Under «Пакомат» in EE, LV, LT and FI that
     is not the whole story: the checkout draws a chip per carrier, the shopper
     taps one, and the panel keeps a cell per carrier. One country number there
     is exactly how nine of fourteen pairs were sold below cost in September. */
  if (kinds.includes("locker")) {
    for (const country of countries) {
      if (!CARRIER_CHOICE_COUNTRIES.includes(country)) continue;
      const rows = perCarrierRows({ country, kind: "locker", grid, answersByBand: answers[country] }).carriers;
      if (rows.length < 2) continue;
      say("");
      say(`— ${country}, Пакомат: покупатель выбирает перевозчика сам, у каждого своя цена —`);
      say("");
      say(
        table(
          ["Перевозчик", ...bands.map((b) => b.short), ""],
          rows.map((r) => [r.carrier, ...r.perBand.map(eur), r.chipOnly ? "только фишка" : ""]),
          ["l", ...bands.map(() => "r"), "l"],
        ),
      );
    }
  }

  /* ---------- 2. what Montonio will actually bill the box as ---------- */
  const chargeRows = [];
  for (let i = 0; i < bands.length; i++) {
    const c = countries.map((cc) => grid.chargeable[cc]?.[i]).find(Boolean);
    if (!c) continue;
    chargeRows.push([
      bands[i].short,
      `${bands[i].box.join("×")} см`,
      kgFmt(c.actualKg),
      kgFmt(c.volumetricKg),
      kgFmt(c.chargeableKg),
      c.volumetricKg !== null && c.actualKg !== null && c.volumetricKg > c.actualKg ? "платим за КОРОБКУ" : "платим за вес",
    ]);
  }
  if (chargeRows.length) {
    say("");
    say("— за что Montonio берёт деньги (его собственный расчёт, calculationDetails) —");
    say("");
    say(table(["Полка", "коробка", "вес", "объёмный", "тарифный", "что решает"], chargeRows, ["l", "l", "r", "r", "r", "l"]));
    say("");
    say("Объёмный вес = габариты ÷ 5000. Он больше настоящего — значит цену задаёт");
    say("коробка, а не содержимое, и «сколько банок в заказе» перестаёт влиять.");
  }

  /* ---------- 3. the decision, per country ---------- */
  for (const kind of decisionKinds) {
    const lines = [];
    for (const country of countries) {
      const cand = candidates({ country, kind, grid, typicalBand, heaviestBand });
      if (!cand || (cand.typical === null && cand.safe === null)) continue;
      const flat = flatFor(kind, country);
      const econ = flatPriceEconomics({ flat, country, kind, grid, heaviestBand });
      lines.push([
        country,
        shippingZone(country),
        eur(cand.typicalCost),
        eur(cand.safeCost),
        eur(cand.typical),
        eur(cand.middle),
        eur(cand.safe),
        flat === null ? HOLE : eur(flat),
        flat === null ? HOLE : signedEur(econ.atHeaviest?.margin ?? null),
        flat === null ? HOLE : (econ.losesFromLabel ?? "не теряет"),
      ]);
    }
    if (!lines.length) continue;
    say("");
    say(`— ${KIND_LABELS[kind] ?? kind}: какую цену ставить —`);
    say("");
    say(
      table(
        ["Страна", "зона", "себест. типичн.", "себест. макс.", "по типичному", "середина", "без убытка", "у вас", "на макс.", "теряет с"],
        lines,
        ["l", "l", "r", "r", "r", "r", "r", "r", "r", "l"],
      ),
    );
    say("");
    say("«по типичному» — окупает заказ из " + bands[typicalBand].short + ", всё что тяжелее уходит в минус.");
    say(`«без убытка» — окупает заказ из ${bands[heaviestBand].short}; за него платят мелкие, которых большинство.`);
    say("«середина» — ровно между ними. Это и есть ставка, и её делает человек, а не скрипт.");
    if (heaviestBand < bands.length - 1) {
      const skipped = bands.slice(heaviestBand + 1).map((b) => b.short).join(", ");
      say(`Полки ${skipped} в сетке показаны, но в решении не участвуют — сказано, что таких`);
      say("заказов не бывает (--heaviest). Если бывают, цифры выше занижены.");
    }
    if (anyFlat) {
      say("«у вас» — то, что передано в --flat-*; «на макс.» — что остаётся на самом тяжёлом заказе,");
      say("«теряет с» — с какого размера заказа эта цена перестаёт окупаться.");
    }
  }

  /* ---------- 4. zones ---------- */
  for (const kind of decisionKinds) {
    for (const zone of ["EU"]) {
      const roll = zoneRollup({ zone, kind, grid, heaviestBand });
      if (!roll.members.length || roll.breakEvenAll === null) continue;
      const rows = roll.perBand.map((p) => [
        p.band.short,
        p.cheapest ? `${p.cheapest.country} ${eur(p.cheapest.gross)}` : HOLE,
        p.dearest ? `${p.dearest.country} ${eur(p.dearest.gross)}` : HOLE,
        /* With one priced country the cheapest and the dearest are the same row,
           and «0.00 €» would read as «все страны стоят одинаково». They do not;
           there is simply nothing to spread. */
        p.priced > 1 && p.dearest && p.cheapest ? eur(p.dearest.gross - p.cheapest.gross) : HOLE,
        p.holes.length ? p.holes.join(" ") : HOLE,
      ]);
      const n = roll.members.length;
      say("");
      say(`— зона ${zone}, ${KIND_LABELS[kind] ?? kind}: одна цена на ${n} ${plural(n, ["страну", "страны", "стран"])} —`);
      say("");
      say(table(["Полка", "дешевле всех", "дороже всех", "разброс", "без цены"], rows, ["l", "l", "l", "r", "l"]));
      say("");
      say(`Цена зоны обязана покрывать САМУЮ дорогую страну в ней: ${eur(roll.breakEvenAll)}`);
      say(`(${roll.worst.country}, ${roll.worst.carrier}). Округлённо по правилу магазина: ${eur(roll.suggestedX9)}.`);
      const flat = FLAT[kind]?.[zone] ?? null;
      if (flat !== null) {
        const losers = roll.perBand
          .flatMap((p) => (p.dearest && p.dearest.gross > flat ? [`${p.dearest.country} ${p.band.short} ${signedEur(flat - p.dearest.gross)}`] : []));
        say(
          losers.length
            ? `При ${eur(flat)} в минус уходят: ${losers.join(", ")}.`
            : `При ${eur(flat)} в этой зоне ничего не теряется.`,
        );
      }
      if (roll.perBand.some((p) => p.holes.length)) {
        say("Страны в колонке «без цены» не участвуют в расчёте зоны — туда посылку");
        say("может быть вообще не на чем отправить. Проверить отдельно, не ставить цену наугад.");
      }
    }
  }

  /* ---------- 5. how much the weight guess matters ---------- */
  for (const kind of decisionKinds) {
    const rows = [];
    for (const country of countries) {
      const s = sensitivity({ country, kind, grid });
      if (!s.rows.length) continue;
      rows.push([country, eur(s.lo), eur(s.hi), eur(s.spread), s.ratio ? `×${s.ratio.toFixed(1)}` : HOLE, s.verdict]);
    }
    if (!rows.length) continue;
    say("");
    say(`— ${KIND_LABELS[kind] ?? kind}: насколько ответ зависит от догадки о весе —`);
    say("");
    say(table(["Страна", "самый лёгкий", "самый тяжёлый", "разница", "во сколько раз", "вывод"], rows, ["l", "r", "r", "r", "r", "l"]));
    say("");
    say("Вес НИКТО не мерил: в каталоге 220 товаров и ни у одного нет веса и габаритов.");
    say(`Тут взято: ${bands[typicalBand].units} ${plural(bands[typicalBand].units, ["единица", "единицы", "единиц"])} → ${kgFmt(bands[typicalBand].kg)}.`);
    say("Это формула estimateWeightKg() из src/lib/shipping/montonio.ts — оценка магазина,");
    say("а не выдуманная здесь. Montonio при этом объявляется коробка (declaredWeightKg),");
    say("одна и та же на каждой посылке: вес заказа мы не считаем. Другое число — --units N;");
    say("таблица выше говорит, насколько сильно от него зависит ответ.");
  }

  /* ---------- 6. the holes, named ---------- */
  const holeLines = [];
  for (const country of countries) {
    for (const kind of kinds) {
      const missing = grid.bands.filter((_, i) => !grid.cells[country]?.[i]?.[kind]).length;
      if (missing === grid.bands.length) holeLines.push(`${country} · ${KIND_LABELS[kind] ?? kind}: Montonio не дал цены ни на одном весе`);
      else if (missing) holeLines.push(`${country} · ${KIND_LABELS[kind] ?? kind}: нет цены на ${missing} из ${grid.bands.length} весов`);
    }
  }
  if (holeLines.length || grid.notes.length || failures.length || notServed.length) {
    say("");
    say("— дыры и оговорки —");
    say("");
    for (const l of holeLines) say(`  ${l}`);
    for (const n of grid.notes) say(`  ${n.country} ${grid.bands[n.band].short}: ${n.note}`);
    for (const f of failures) say(`  ${f.country} ${f.band}: запрос не прошёл — ${f.why}`);
    if (notServed.length) say(`  Montonio не возит вообще: ${notServed.join(", ")} — цены для них не существует.`);
    say("");
    say("Ни одна из этих строк не означает «бесплатно». Если у страны нет цены ни на");
    say("одном весе — скорее всего у магазина не включён перевозчик. Эндпоинт отдаёт");
    say("только перевозчиков с контрактом Montonio; с прямым договором в ответ не попадают.");
  }

  /* ---------- write ----------
     A failed write must not throw away the run. Every table is already on the
     screen by now, and on Sunday morning a stack trace where the answer should
     be would read as «ничего не получилось» — so the failure is reported as
     what it is (a file that could not be opened) and the exit stays 0, because
     the work was done. */
  try {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, toMarkdown(out, { grid, stamp, dryRun, today, kinds, decisionKinds, typicalBand, heaviestBand, bands }), "utf8");
    say("");
    say(`Записано: ${shortPath(outPath)}`);
    if (wantJson) {
      const jsonPath = outPath.replace(/\.md$/, "") + ".json";
      await writeFile(jsonPath, JSON.stringify({ stamp, dryRun, today, grid }, null, 2) + "\n", "utf8");
      say(`Записано: ${shortPath(jsonPath)}`);
    }
  } catch (err) {
    log("");
    log(`Не удалось записать отчёт в ${outPath} — ${err.message}`);
    log("Всё посчитано и напечатано выше; можно скопировать прямо с экрана или");
    log("указать другой путь через --out.");
  }
  if (dryRun) {
    say("");
    say("Ещё раз: это ОБРАЗЕЦ. Ни одна цифра выше не пришла от Montonio.");
  }
}

/** Repo-relative when the file is inside the repo, absolute when `--out` points elsewhere. */
function shortPath(p) {
  const rel = path.relative(ROOT, p);
  return rel.startsWith("..") ? p : rel;
}

/** The band whose unit count is closest to `units` — «типичный заказ» lands on a real shelf. */
function nearestBand(bands, units) {
  const n = Number(units);
  if (!Number.isFinite(n)) return 0;
  let best = 0;
  for (let i = 1; i < bands.length; i++) {
    if (Math.abs(bands[i].units - n) < Math.abs(bands[best].units - n)) best = i;
  }
  return best;
}

/**
 * The written file. Same numbers as the terminal, in Markdown, plus the header
 * that says what they are — a file outlives the terminal it was printed in, so
 * the ОБРАЗЕЦ stamp has to travel with it.
 */
function toMarkdown(lines, { grid, stamp, dryRun, today, kinds, bands, typicalBand, heaviestBand }) {
  const head = [
    `# Цены доставки — ${today}`,
    "",
    dryRun
      ? "> **ОБРАЗЕЦ. НЕ НАСТОЯЩИЕ ЦЕНЫ.** Файл собран из выдуманных цифр в документированной\n> форме ответа Montonio, чтобы проверить сам инструмент. Ни одну из этих цен нельзя\n> ставить в панель. Настоящий отчёт получается запуском с живыми ключами и без `--dry-run`."
      : `> Источник: \`POST /shipping-methods/rates\` — ${stamp}. Эти цены названы Montonio\n> для ЭТОГО магазина: его план, его включённые перевозчики.`,
    "",
    `Типичный заказ принят за **${bands[typicalBand].label}**, самый тяжёлый — **${bands[heaviestBand].label}**.`,
    "",
    `> ${VAT_NOTE}`,
    "",
    `«${HOLE}» — цены нет. Это не ноль и не «бесплатно».`,
    "",
  ];

  const body = [];
  for (const kind of kinds) {
    const rows = gridRows(grid, kind);
    if (rows.every((r) => r.slice(1, -1).every((c) => c === HOLE))) continue;
    body.push(`## ${KIND_LABELS[kind] ?? kind} — себестоимость, € с НДС`, "", mdTable(gridHeaders(grid), rows, gridAlign(grid)), "");
  }

  /* The terminal transcript verbatim underneath, inside a code fence: the
     tables above are readable in a browser, and everything the run said —
     the verdicts, the holes, the caveats — is preserved word for word rather
     than summarised into something subtly different. */
  return [...head, ...body, "## Полный вывод запуска", "", "```", ...lines, "```", ""].join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
