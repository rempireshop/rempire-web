/**
 * Every price in src/data/montonio-tariffs.json is gross, and both halves of
 * the script that writes it have to agree about that.
 *
 * Montonio answers ex-VAT on both endpoints — `pricePerParcel` on the public
 * contract-prices endpoint (its calculator prints «+VAT» under every figure)
 * and `rate` on the per-store `POST /shipping-methods/rates`, which the
 * reference never said either way and which Montonio confirmed on 22.09.2026.
 * src/lib/shipping/country-prices.ts bills the customer from `price` alone and
 * takes it as gross — «Every price here includes Estonian VAT» — so a row that
 * skips the conversion is not a rounding difference, it is a shelf price 24 %
 * under what the delivery costs.
 *
 * That is exactly what the keyed path used to do: `flatten()` stored the raw
 * `rate` and the overlay stamped `vatIncluded: false` on it, so the first run
 * with live Montonio keys would have quietly undercut every row it touched.
 * Nothing in the table shows it — an ex-VAT number is a plausible price — and
 * only a run with keys produces one, which is why it survived. Pinned here as
 * two things that must both hold: the script converts on every write path, and
 * the table it has already written is internally consistent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface Row {
  carrier: string;
  country: string;
  method: string;
  price: number;
  priceExVat?: number | null;
  vatIncluded?: boolean;
}

const SRC = readFileSync(fileURLToPath(new URL("../tools/fetch-montonio-tariffs.mjs", import.meta.url)), "utf8");
/* Read as text rather than imported, so the check is of the file on disk and
   not of whatever a bundler made of it. */
const TARIFFS = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/data/montonio-tariffs.json", import.meta.url)), "utf8"),
) as { vatRateEE: number; rates: Row[] };

const name = (r: Row) => `${r.carrier} ${r.country} ${r.method}`;

/** One top-level function of the script, from its own `function x(` to the next one. */
function section(fn: string): string {
  const start = SRC.indexOf(`function ${fn}(`);
  expect(start, `${fn}() is gone from tools/fetch-montonio-tariffs.mjs`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + "function ".length);
  const next = rest.search(/\n(?:async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the script converts to gross on every path that writes a row", () => {
  it("has one conversion, and both paths use it", () => {
    /* Changing VAT_EE moves every row, so it is stated once and read here
       rather than restated as a literal in two more places. */
    expect(SRC).toContain("const VAT_EE = 0.24;");
    expect(SRC).toContain("const withVat = (n) => round2(Number(n) * (1 + VAT_EE));");
  });

  it("the keyless path — contract prices — adds VAT and keeps the original", () => {
    const fn = section("contractPrice");
    expect(fn).toMatch(/price:\s*withVat\(/);
    expect(fn).toMatch(/priceExVat:\s*round2\(/);
    expect(fn).toMatch(/vatIncluded:\s*true/);
    /* The return leg is billed to the merchant off the same list and is ex-VAT
       for the same reason. */
    expect(fn).toMatch(/returnPrice:.*withVat\(/);
  });

  it("the keyed path — this store's live quote — does the same", () => {
    const fn = section("flatten");
    expect(fn, "flatten() stored the raw ex-VAT `rate` until 22.09.2026").toMatch(/price:\s*withVat\(/);
    expect(fn).toMatch(/priceExVat:\s*round2\(/);
    expect(fn).toMatch(/vatIncluded:\s*true/);
  });

  it("the overlay that writes those rows marks them gross", () => {
    const fn = section("main");
    expect(fn).toMatch(/vatIncluded:\s*true/);
    /* …and still says where the number came from, which is the only way to
       tell a live row from a contract-price row in the written file. */
    expect(fn).toMatch(/source:[\s\S]{0,200}live quote/);
    expect(fn).toMatch(/source:[\s\S]{0,200}fetched \$\{today\}/);
  });

  it("no path anywhere writes an ex-VAT number as `price`", () => {
    /* Guards a *third* write path being added later: every `price:` key in the
       script must be filled by withVat(), whatever function it sits in. */
    const written = [...SRC.matchAll(/\bprice:\s*(\w+)\(/g)].map((m) => m[1]);
    expect(written.length, "a write path was added or removed").toBe(2);
    expect(new Set(written)).toEqual(new Set(["withVat"]));
  });

  it("nothing claims a row is net", () => {
    expect(SRC, "`vatIncluded: false` means country-prices.ts undercharges").not.toMatch(/vatIncluded:\s*false/);
  });
});

describe("the table already on disk is gross throughout", () => {
  it("has rows to check", () => {
    expect(TARIFFS.rates.length).toBeGreaterThan(50);
    expect(TARIFFS.vatRateEE).toBe(0.24);
  });

  it("every row says so", () => {
    const net = TARIFFS.rates.filter((r) => r.vatIncluded !== true);
    expect(net.map(name)).toEqual([]);
  });

  it("and every row's arithmetic agrees with it", () => {
    /* Within a cent: `price` and `priceExVat` are each rounded to two places
       on the way in, so the pair can disagree by up to half a cent each. */
    const off = TARIFFS.rates
      .filter((r) => typeof r.priceExVat === "number")
      .filter((r) => Math.abs(r.price - (r.priceExVat as number) * (1 + TARIFFS.vatRateEE)) > 0.01)
      .map((r) => `${name(r)}: ${r.price} vs ${r.priceExVat} ex-VAT`);
    expect(off).toEqual([]);
  });

  it("keeps the ex-VAT original, so the conversion stays checkable", () => {
    const missing = TARIFFS.rates.filter((r) => r.priceExVat == null);
    expect(missing.map(name)).toEqual([]);
  });
});
