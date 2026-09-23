/**
 * settings.shipping_parcel — the box and the first locker door, as stored.
 *
 * On 23.09.2026 the panel's «Коробка магазина» said 25 × 18 × 10 a day after
 * the code said 25 × 18 × 8: noteLockerSize() wrote the whole cleaned object
 * back on every label, so the defaults of the day the first label was printed
 * sat in the row as if the owner had typed them. 203 moves that frozen row to
 * the real carton; noteLockerSize() now writes `recent` alone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { getParcelSettings, noteLockerSize, PARCEL_DEFAULTS } from "@/lib/shipping/parcel";
import { setupDb, teardownDb } from "./helpers";

const MIGRATION_203 = "203_shipping_parcel_real_carton.sql";

type Row = { value: Record<string, unknown> };

async function row(): Promise<Record<string, unknown> | null> {
  const rows = await query<Row>("select value from settings where key = 'shipping_parcel'");
  return rows.length ? rows[0].value : null;
}

async function put(value: Record<string, unknown> | null): Promise<void> {
  await query("delete from settings where key = 'shipping_parcel'");
  if (value) {
    await query("insert into settings (key, value) values ('shipping_parcel', $1::jsonb)", [JSON.stringify(value)]);
  }
}

/** Forget that 203 ran and run the migrations again, as a deploy would. */
async function replay203(value: Record<string, unknown> | null): Promise<void> {
  await put(value);
  await query("delete from _migrations where name = $1", [MIGRATION_203]);
  await setupDb();
}

describe("203 over the row the old defaults froze", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("moves 25 × 18 × 10 to 8 cm and the door from M to S, and keeps the label history", async () => {
    await replay203({ length: 25, width: 18, height: 10, lockerSize: "M", recent: ["M", "S"] });
    expect(await row()).toEqual({ length: 25, width: 18, height: 8, lockerSize: "S", recent: ["M", "S"] });
  });

  it("leaves a carton the owner set to something else alone", async () => {
    const typed = { length: 30, width: 20, height: 10, lockerSize: "M", recent: [] };
    await replay203(typed);
    expect(await row()).toEqual(typed);
  });

  it("leaves a door the owner chose alone", async () => {
    await replay203({ length: 25, width: 18, height: 10, lockerSize: "L", recent: [] });
    expect(await row()).toEqual({ length: 25, width: 18, height: 8, lockerSize: "L", recent: [] });
  });

  it("does not invent a row where there is none", async () => {
    await replay203(null);
    expect(await row()).toBeNull();
    expect(await getParcelSettings()).toEqual({ ...PARCEL_DEFAULTS, recent: [] });
  });
});

describe("noteLockerSize writes the label history and nothing else", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  it("on a shop without a row, stores recent alone — the carton keeps following the code", async () => {
    await put(null);
    await noteLockerSize("S");
    expect(await row()).toEqual({ recent: ["S"] });
    expect(await getParcelSettings()).toEqual({ ...PARCEL_DEFAULTS, recent: ["S"] });
  });

  it("on a row the owner saved, keeps his carton and door and puts the new size first", async () => {
    await put({ length: 30, width: 20, height: 12, lockerSize: "M", recent: ["M"] });
    await noteLockerSize("L");
    expect(await row()).toEqual({ length: 30, width: 20, height: 12, lockerSize: "M", recent: ["L", "M"] });
  });
});
