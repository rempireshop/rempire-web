/**
 * The panel's half of the order notifications — the parts that are decisions,
 * not plumbing.
 *
 * Renat, 20.09.2026: «Notifications about order on the phone, through app
 * would be nice — apple and android.» There is no app and there does not need
 * to be: «Админка» already lives on his Home Screen (panel-install in /test),
 * and that is precisely the condition iOS puts on Web Push.
 *
 * Three things here can be got wrong silently, so all three are pinned:
 *
 *   1. **iOS.** Safari will not even ASK for permission from an ordinary tab —
 *      `Notification.requestPermission()` resolves to `default` and nothing
 *      happens. A button that does nothing is worse than no button, so the
 *      screen has to detect a non-installed iPhone and say what to do instead.
 *   2. **Whose phone.** Permission belongs to a device, not to the shop. The
 *      screen shows THIS device first, with its own one button, and the other
 *      devices below as a list that can only be switched off from here —
 *      before that split existed, pressing «включить» on the laptop and
 *      hearing the iPhone ring was the obvious reading.
 *   3. **No keys, no switch.** With `VAPID_*` unset the route writes nothing
 *      and answers `not_configured`. Offering the button anyway would make a
 *      promise the server cannot keep.
 *
 * The panel is a static bundle no unit test can execute, so these read the
 * source the way the other app.js guards do — and the translator half runs
 * for real, because a run-time-assembled string is exactly what `i18n-gaps`
 * cannot see.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

function decl(name: string): string {
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const start = src.indexOf(`var ${name} = ${open}`);
    if (start < 0) continue;
    let depth = 0;
    for (let i = src.indexOf(open, start); i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close && --depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`public/shop2/app.js no longer declares ${name}`);
}

describe("an iPhone that is not installed is told so, not given a dead button", () => {
  const html = slice("admSetPushHTML");

  it("checks for the Home Screen, not merely for iOS", () => {
    expect(html).toContain("pushIOS() && !pushStandalone()");
    /* …and it returns there: the button below must not be reachable */
    const at = html.indexOf("pushIOS() && !pushStandalone()");
    expect(html.slice(at, at + 400)).toContain("return");
  });

  it("standalone is read both ways, because iOS reports it in its own", () => {
    const fn = slice("pushStandalone");
    expect(fn).toContain("navigator.standalone === true");
    expect(fn).toContain('matchMedia("(display-mode: standalone)")');
  });

  it("says what to do — the share sheet, by name", () => {
    expect(html).toContain("Поделиться");
    expect(html).toContain("На экран «Домой»");
  });
});

describe("the switch is only offered when the server can keep the promise", () => {
  const html = slice("admSetPushHTML");

  it("no VAPID keys — no button at all", () => {
    const at = html.indexOf("if (!PUSH.configured)");
    expect(at, "the screen no longer checks whether push is configured").toBeGreaterThan(-1);
    const block = html.slice(at, at + 300);
    expect(block).toContain("return");
    expect(block).not.toContain("data-pushon");
  });

  it("a browser that cannot do push is told before anything else", () => {
    expect(html.indexOf("if (!pushCan())")).toBeLessThan(html.indexOf("if (!PUSH.configured)"));
  });

  it("pushCan() wants all three, not just the worker", () => {
    const fn = slice("pushCan");
    expect(fn).toContain('"serviceWorker" in navigator');
    expect(fn).toContain('"PushManager" in window');
    expect(fn).toContain('"Notification" in window');
  });
});

describe("this device first, the others as a list", () => {
  const html = slice("admSetPushHTML");

  it("the one button switches THIS device, both ways", () => {
    expect(html).toContain("data-pushon");
    expect(html).toContain("data-pushoff");
    // …and which of the two is drawn is decided by whether this device is subscribed
    expect(html).toContain("var on = !!PUSH.here;");
  });

  it("every other device can be removed, and is marked when it is this one", () => {
    expect(html).toContain("data-pushdrop=");
    expect(html).toContain("d.endpoint === PUSH.here");
  });

  it("permission is asked from inside the tap, or Safari ignores it", () => {
    /* requestPermission() outside a user gesture resolves `default` on iOS and
       is auto-denied on desktop Safari. It sits in the click handler. */
    const on = slice("pushOn");
    expect(on).toContain("Notification.requestPermission()");
    expect(on).toContain('if (p !== "granted") throw new Error("denied")');
  });

  it("turning it off unsubscribes the browser as well as the server", () => {
    const off = slice("pushOff");
    expect(off).toContain("sub.unsubscribe()");
    expect(off).toContain("pushDropCall(endpoint)");
  });

  it("the boot re-subscribe sends NO label, so a typed name is never overwritten", () => {
    const resub = slice("pushResub");
    expect(resub).toContain('apiSend("/api/admin/push/subscribe/", "POST", sub.toJSON())');
    expect(resub, "a label here would overwrite the one already stored").not.toContain("label");
  });

  it("…and runs once per load", () => {
    expect(slice("pushBoot")).toContain("if (pushBoot._done) return;");
  });
});

describe("a tapped notification lands on that order", () => {
  const fn = slice("pushOpenWanted");

  /* The lookup is the panel's one helper since 24.09.2026 (admOrderRaw: id
     first, then the number, in every list the panel holds) — and an order
     older than the newest hundred is fetched on its own. Both are driven for
     real in tests/admin-order-beyond-hundred.test.ts; these pin the wiring. */
  it("reads the order NUMBER — that is what the notification prints", () => {
    expect(fn).toMatch(/order=\(\[\^&\]\+\)/);
    expect(fn).toContain("admOrderRaw(want)");
    expect(slice("admOrderRaw")).toContain("String(list[j].number).toUpperCase() === up");
  });

  it("opens the order card, not merely the section", () => {
    expect(fn).toContain("S.adminOrder = String(row.id);");
    expect(fn).toContain("loadOrderOne(want, false,");
  });

  it("an order that is gone still lands somewhere real", () => {
    /* A tap that opens an empty screen is a dead end — the list is the honest
       answer when the order has been deleted since. */
    const tail = fn.slice(fn.lastIndexOf("return;"));
    expect(fn).toContain('S.adminTab = "orders";');
    expect(tail.length).toBeGreaterThan(0);
  });

  it("fires only once", () => {
    expect(fn).toContain('PUSH.want = "";');
  });
});

/* The two strings on this screen that are built at run time — a clock and a
   count — cannot be seen by tools/i18n-gaps.mjs, which reads source. So they
   go through the panel's own translator here, the way the chips do. */
describe("the assembled strings survive the translator", () => {
  const BODY = `
    ${decl("UI")}
    ${decl("UI_RX")}
    ${slice("trName")}
    ${decl("TAIL_EXACT")}
    ${decl("NAME_TAILS")}
    ${decl("NAME_FRAGS")}
    ${slice("trText")}
    return trText(S, LANG, false);
  `;
  const tr = new Function("S", "LANG", BODY) as (s: string, lang: string) => string;

  for (const lang of ["ET", "EN"]) {
    it(`«сегодня, 12:40» in ${lang}`, () => {
      const got = tr("сегодня, 12:40", lang);
      expect(got).not.toMatch(/[А-Яа-яЁё]/);
      expect(got, "the clock was eaten by its own rule").toContain("12:40");
    });

    it(`«Проверочное ушло на устройств: 2» in ${lang}`, () => {
      const got = tr("Проверочное ушло на устройств: 2", lang);
      expect(got).not.toMatch(/[А-Яа-яЁё]/);
      expect(got).toContain("2");
    });

    it(`«вчера» and «ещё не приходило» in ${lang}`, () => {
      for (const s of ["вчера", "ещё не приходило"]) {
        expect(tr(s, lang), `«${s}» in ${lang}`).not.toMatch(/[А-Яа-яЁё]/);
      }
    });
  }
});
