/**
 * The two go-live helpers that talk to things this suite cannot reach —
 * tools/db-backup.mjs (Docker + the live Postgres) and
 * tools/montonio-webhook.mjs (Montonio's live API). Their decisions are pure
 * functions; the network half was run by hand on 23.09.2026 (a dump of a
 * throwaway Postgres 16, rows deleted, restored, counted).
 */
import { describe, expect, it } from "vitest";
import { backupName, majorOf, tablesWithData } from "../tools/db-backup.mjs";
import { checkUrl, EVENTS } from "../tools/montonio-webhook.mjs";

describe("db-backup", () => {
  it("reads the server's major version off show server_version_num", () => {
    expect(majorOf("170004\n")).toBe(17);
    expect(majorOf("160010")).toBe(16);
    expect(majorOf("")).toBeNull();
    expect(majorOf("oops")).toBeNull();
  });

  it("counts the tables a dump carries data for", () => {
    const list = [
      ";",
      "; Archive created at 2026-09-23 14:29:00 UTC",
      "215; 1259 16385 TABLE public orders postgres",
      "3321; 0 16385 TABLE DATA public orders postgres",
      "3322; 0 16390 TABLE DATA public settings postgres",
    ].join("\r\n");
    expect(tablesWithData(list)).toBe(2);
    expect(tablesWithData("")).toBe(0);
  });

  it("names the file by date and minute, so two dumps in a day do not collide", () => {
    expect(backupName(new Date(2026, 8, 23, 9, 5))).toBe("rempire-2026-09-23_0905.dump");
  });
});

describe("montonio-webhook", () => {
  it("takes only the shop's own notify path, over https, with the slash", () => {
    expect(checkUrl("https://rempireshop.diipsolutions.eu/api/shipping/notify/")).toBeNull();
    expect(checkUrl("https://rempireshop.com/api/shipping/notify/")).toBeNull();
    expect(checkUrl("https://rempireshop.com/api/shipping/notify")).toMatch(/slash/);
    expect(checkUrl("http://rempireshop.com/api/shipping/notify/")).toMatch(/https/);
    expect(checkUrl("not a url")).toMatch(/URL/);
  });

  it("subscribes to the three events the notify route reads", () => {
    expect(EVENTS).toEqual(["shipment.registered", "shipment.registrationFailed", "shipment.statusUpdated"]);
  });
});
