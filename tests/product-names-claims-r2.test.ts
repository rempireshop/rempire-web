/**
 * Product names and texts, second pass (09.10.2026, Dim's Estonian review and
 * the follow-ups of the SEO pack):
 *
 *   · every Kevin.Murphy name carries the maker's own product type, from the
 *     product's own text (the heading of its description);
 *   · a type tail reads the way people write and search it — «habemeõli»,
 *     «viimistluspasta», «beard oil», «styling paste» — not word for word
 *     («õli habemele», «oil for beard»): every head + fragment the catalogue
 *     uses is a whole entry in TAIL_EXACT (app.js and src/lib/product-name.ts,
 *     held equal by tests/product-name.test.ts), and NAME_FRAGS stays the
 *     fallback for a name the owner types tomorrow;
 *   · no disease or treatment claim is left in a product text, in any of the
 *     three languages — rewritten as what the product does cosmetically and
 *     who it is for («for blemish-prone skin», «склонной к несовершенствам»,
 *     «ebapuhtustele kalduvale nahale»).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TAIL_EXACT, translateProductName } from "@/lib/product-name";
import { CLAIMS, withoutMakerNames } from "./claim-words";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
type P = { id: string; brand: string; name: string };
const CATALOGUE = new Function(read("../public/shop/catalogue2.js") + "\nreturn CATALOGUE;")() as P[];
const MIN = JSON.parse(read("../src/data/catalogue.min.json")) as Array<{ id: string; n: string }>;
const load = (f: string, n: string) => new Function(read("../public/shop/" + f) + "\nreturn " + n + ";")() as Record<string, string>;
const TEXTS = { EN: load("content.js", "CONTENT"), RU: load("content.ru.js", "CONTENT_RU"), ET: load("content.et.js", "CONTENT_ET") };
const byId = (id: string) => CATALOGUE.find((p) => p.id === id)!;
const tailOf = (name: string) => (/ — ([а-яё][а-яё \-]*)$/i.exec(name) || [])[1] || "";

describe("Kevin.Murphy names", () => {
  const WANT: Record<string, [string, string, string]> = {
    "hair-resort-spray": ["Hair.Resort.Spray — текстурирующий спрей", "tekstuurisprei", "texture spray"],
    "rough-rider": ["Rough.Rider — глина для укладки", "viimistlussavi", "styling clay"],
    "kevin-murphy-killer-twirls": ["Killer.Twirls — крем для локонов", "lokikreem", "curl cream"],
    "easy-rider": ["Easy.Rider — крем против пушения", "krässuvastane kreem", "anti-frizz cream"],
    "killer-curls": ["Killer.Curls — крем для кудрявых волос", "lokkis juuste kreem", "curly hair cream"],
    "super-goo": ["Super.Goo — моделирующий гель", "vormiv geel", "sculpting gel"],
    "body-builder": ["Body.Builder — мусс для объёма", "kohevusvaht", "volumising mousse"],
    "kevin-murphy-full-again": ["Full.Again — уплотняющий лосьон", "tihendav losjoon", "thickening lotion"],
    "hair-resort": ["Hair.Resort — пляжный текстурайзер", "rannasoengu viimistlusvahend", "beach texturiser"],
    "kevin-murphy-re-store": ["RE.STORE — восстанавливающий очищающий уход", "taastav puhastav hooldus", "repairing cleansing treatment"],
    "kevin-murphy-smooth-again": ["SMOOTH.AGAIN — несмываемый разглаживающий уход", "silendav juustesse jäetav hooldus", "smoothing leave-in treatment"],
    "leave-in-repair": ["LEAVE-IN.REPAIR — несмываемый восстанавливающий уход", "taastav juustesse jäetav hooldus", "repairing leave-in treatment"],
    "anti-gravity": ["ANTI.GRAVITY — лосьон для объёма", "kohevuslosjoon", "volumising lotion"],
    "killer-waves": ["KILLER.WAVES — спрей для локонов", "lokisprei", "curl spray"],
  };

  it("every one carries a type now", () => {
    const bare = CATALOGUE.filter((p) => p.brand === "Kevin.Murphy" && !tailOf(p.name)).map((p) => p.name);
    expect(bare).toEqual([]);
  });

  it("the fourteen typed on 09.10.2026, in all three languages, in both copies of the catalogue", () => {
    const min = new Map(MIN.map((p) => [p.id, p.n]));
    for (const [id, [ru, et, en]] of Object.entries(WANT)) {
      expect(byId(id).name, id).toBe(ru);
      expect(min.get(id), id).toBe(ru);
      const head = ru.split(" — ")[0];
      expect(translateProductName(ru, "ET"), id).toBe(head + " — " + et);
      expect(translateProductName(ru, "EN"), id).toBe(head + " — " + en);
    }
  });

  it("the type comes from the product's own text, not from nowhere", () => {
    /* the word the type rests on, in the heading of the maker's English text */
    const MAKER: Record<string, RegExp> = {
      "hair-resort-spray": /TEXTURE SPRAY/, "rough-rider": /STYLING CLAY/, "kevin-murphy-killer-twirls": /CURL REFINING .*CRÈME/,
      "easy-rider": /ANTI FRIZZ CRÈME/, "killer-curls": /CRÈME FOR CURLY/, "super-goo": /SCULPTING GEL/,
      "body-builder": /VOLUMISING MOUSSE/, "kevin-murphy-full-again": /THICKENING LOTION/, "hair-resort": /BEACH TEXTURISER/,
      "kevin-murphy-re-store": /REPAIRING, CLEANSING TREATMENT/, "kevin-murphy-smooth-again": /SMOOTHING, ANTI-FRIZZ LEAVE-IN TREATMENT/,
      "leave-in-repair": /RESTORATIVE LEAVE-IN TREATMENT/, "anti-gravity": /LOTION FOR VOLUMISING/, "killer-waves": /WAVE ENHANCER/,
    };
    for (const [id, rx] of Object.entries(MAKER)) expect(TEXTS.EN[id], id).toMatch(rx);
  });
});

describe("type tails read as people write them", () => {
  /* Word-for-word endings: what NAME_FRAGS makes of «X для Y». A name may
     still end in one when it is the natural phrase — none does today. */
  const ET_TAILS = [" soengu jaoks", " habemele", " juustele", " näole", " peanahale", " raseerimiseks"];
  const EN_TAILS = [" for styling", " for beard", " for hair", " for face", " for scalp", " for shaving"];
  const ALLOWED: Record<string, string> = {};

  it("no catalogue name ends in a word-for-word fragment, in Estonian or English", () => {
    const bad: string[] = [];
    for (const p of CATALOGUE) {
      if (ALLOWED[p.id]) continue;
      const et = translateProductName(p.name, "ET"), en = translateProductName(p.name, "EN");
      if (ET_TAILS.some((t) => et.endsWith(t))) bad.push(p.id + " ET «" + et + "»");
      if (EN_TAILS.some((t) => en.endsWith(t))) bad.push(p.id + " EN «" + en + "»");
    }
    expect(bad).toEqual([]);
  });

  it("no Estonian or English name keeps a Russian word", () => {
    const bad = CATALOGUE.flatMap((p) => (["ET", "EN"] as const)
      .map((l) => [l, translateProductName(p.name, l)] as const)
      .filter(([, n]) => /[А-Яа-яЁё]/.test(n))
      .map(([l, n]) => p.id + " " + l + " «" + n + "»"));
    expect(bad).toEqual([]);
  });

  it("every head + fragment tail the catalogue uses is a whole entry", () => {
    const missing = [...new Set(CATALOGUE.map((p) => tailOf(p.name)).filter((t) => t.includes(" ")))]
      .filter((t) => !Object.prototype.hasOwnProperty.call(TAIL_EXACT, t.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it("the compounds, as Dim's review asked", () => {
    const et = (ru: string) => translateProductName("X — " + ru, "ET").slice(4);
    const en = (ru: string) => translateProductName("X — " + ru, "EN").slice(4);
    expect([et("масло для бороды"), en("масло для бороды")]).toEqual(["habemeõli", "beard oil"]);
    expect([et("бальзам для бороды"), en("бальзам для бороды")]).toEqual(["habemepalsam", "beard balm"]);
    expect([et("паста для укладки"), en("паста для укладки")]).toEqual(["viimistluspasta", "styling paste"]);
    expect([et("воск для укладки"), en("воск для укладки")]).toEqual(["juuksevaha", "styling wax"]);
    expect([et("гель для бритья"), en("гель для бритья")]).toEqual(["raseerimisgeel", "shaving gel"]);
    expect([et("сыворотка для кожи головы"), en("сыворотка для кожи головы")]).toEqual(["peanahaseerum", "scalp serum"]);
    expect([et("тоник для кожи головы"), en("тоник для кожи головы")]).toEqual(["peanahatoonik", "scalp tonic"]);
    expect([et("крем для лица"), en("крем для лица")]).toEqual(["näokreem", "face cream"]);
    // …and a pair the tables have never seen still falls back to the fragments
    expect(en("маска для бороды")).toBe("mask for beard");
  });
});

describe("product texts make no disease or treatment claims", () => {
  /* the word list is shared with the shop's own meta descriptions
     (tests/claim-words.ts, tests/product-meta.test.ts) */
  /* Left as they are, on purpose:
     · the NUMB serum numbs the skin for a tattoo session — that is what the
       product is; whether the shop sells and words it so is the owner's call;
     · Body.Mass names the maker's donation to people with chemo-related hair
       loss (HairToStay) — a charity note, not a claim about the product;
     · «Vital Cure» / «Oil Cure» are the maker's product names. */
  const ALLOWED = new Set(["yumain-numb-serum-instant-pain-relief-for-tattoos", "kevin-murphy-body-mass"]);
  const plain = withoutMakerNames;

  it("in any language, for any product", () => {
    const bad: string[] = [];
    for (const [lang, texts] of Object.entries(TEXTS)) {
      for (const [id, html] of Object.entries(texts)) {
        if (ALLOWED.has(id)) continue;
        const s = plain(html);
        for (const rx of CLAIMS) {
          const m = rx.exec(s);
          if (m) bad.push(`${lang} ${id}: «${s.slice(Math.max(0, m.index - 40), m.index + 40)}»`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps who the product is for", () => {
    expect(TEXTS.EN["anua-heartleaf-pore-control-cleansing-oil"]).toContain("suitable for blemish-prone and sensitive skin");
    expect(TEXTS.RU["anua-heartleaf-pore-control-cleansing-oil"]).toContain("кожи, склонной к несовершенствам");
    expect(TEXTS.ET["anua-heartleaf-pore-control-cleansing-oil"]).toContain("ebapuhtustele kalduvale nahale");
    expect(TEXTS.EN["gummy-sheet-mask-madecassoside-sticker"]).toContain("suited to blemish-prone skin");
    expect(TEXTS.RU["davines-calming-shampoo"]).toContain("успокаивающим действием");
    expect(TEXTS.ET["davines-energizing-shampoo"]).toContain("hapratele ja nõrgenenud juustele");
  });

  it("the System 4 headings stay claim-free", () => {
    const s4 = CATALOGUE.filter((p) => p.brand === "System 4").map((p) => p.id);
    for (const id of s4) {
      for (const [lang, texts] of Object.entries(TEXTS)) {
        const head = (/<strong>[\s\S]*?<\/strong>(?:<br>)?([^<]*)/.exec(texts[id] || "") || [])[1] || "";
        expect(head, `${id} ${lang}`).not.toMatch(/therapeut|терапевт|лечеб|terapeut|ravitoime|antisept|антисепт|desinf|дезинф/i);
      }
    }
  });
});
