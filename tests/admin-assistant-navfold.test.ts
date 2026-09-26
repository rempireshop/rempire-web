/**
 * The menu makes room for the assistant (Dim, 26.09.2026).
 *
 * On a laptop-size window the open assistant (380 px on the right) and the
 * open menu (232 px on the left) left the work a narrow column in the
 * middle. So: when the assistant opens on a window under 1200 px — the
 * desktop layout; a phone has no side menu — an open menu folds to its icons
 * by itself, and comes back when the assistant closes. Wider windows do not
 * change.
 *
 *   · decided at the moment the assistant opens — a resize while it is open
 *     neither folds nor unfolds;
 *   · the automatic fold is not the owner's preference: the stored `nav`
 *     (rempire-admin-panes, admPanesSave) stays what he chose, and a reload
 *     with the assistant open never leaves the menu folded for good;
 *   · the menu comes back only if the fold was automatic and he has not
 *     touched the fold button since — unfolding or re-folding by hand while
 *     the assistant is open is his choice, and closing it changes nothing;
 *   · the fold button's aria-expanded says what is drawn, automatic or not.
 *
 * The functions are sliced out of public/shop2/app.js and run over stubs, as
 * tests/admin-assistant-back-layer.test.ts does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function block(start: number, what: string): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${what} in app.js`);
}
const fn = (name: string) => block(src.indexOf(`function ${name}(`), `function ${name}()`);

type Panel = {
  S: Record<string, any>;
  /** the strip, the top bar's icon or the pane's «›» — every one is [data-admai] */
  tapAssistant: () => void;
  /** the sidebar's fold button, [data-admnav] */
  tapFold: () => void;
  /** is the menu drawn open (no .adm2--navmin)? */
  navOpen: () => boolean;
  /** the sidebar's markup, for the fold button's aria */
  side: () => string;
  /** what the device keeps under rempire-admin-panes */
  stored: () => Record<string, unknown> | null;
  resize: (w: number) => void;
};

/** The panel on a window `width` px wide; `stored` is what the device already keeps. */
function panel(width: number, stored: Record<string, unknown> | null = null): Panel {
  const S: Record<string, any> = {
    admNav: true, admNavAuto: false, admAi: false, mailLang: "", voiceLang: "", mailTo: "",
  };
  let kept: string | null = stored ? JSON.stringify(stored) : null;
  const win = {
    innerWidth: width,
    matchMedia: (q: string) => ({ matches: win.innerWidth < 900 && /max-width:\s*899px/.test(q) }),
  };
  const made = new Function(
    "S", "window", "localStorage", "ADM_PANES_LS",
    `var admPanesMailTo = "";
     var ADM_SECTIONS = [], ADM_MORE = [];
     function admAsstSheet() { return window.innerWidth < 900; }
     function admNavBtn() { return ""; }
     function admLangsHTML() { return ""; }
     function admLogoutHTML() { return ""; }
     ${fn("admNavAutoFold")}
     ${fn("admNavOpen")}
     ${fn("admNavToggle")}
     ${fn("admAiToggle")}
     ${fn("admPanesLoad")}
     ${fn("admPanesSave")}
     ${fn("admSideHTML")}
     admPanesLoad();
     return { ai: admAiToggle, nav: admNavToggle, open: admNavOpen, save: admPanesSave, side: admSideHTML };`,
  )(
    S, win,
    { getItem: () => kept, setItem: (_k: string, v: string) => { kept = v; } },
    "rempire-admin-panes",
  ) as { ai: () => void; nav: () => void; open: () => boolean; save: () => void; side: () => string };
  return {
    S,
    // the two click handlers, in the order they run: the state, then admPanesSave()
    tapAssistant: () => { made.ai(); made.save(); },
    tapFold: () => { made.nav(); made.save(); },
    navOpen: made.open,
    side: () => made.side(),
    stored: () => (kept ? JSON.parse(kept) : null),
    resize: (w: number) => { win.innerWidth = w; },
  };
}

describe("the decision, taken as the assistant opens", () => {
  it("folds an open menu on a desktop window under 1200 px, and nowhere else", () => {
    const decide = new Function(`${fn("admNavAutoFold")} return admNavAutoFold;`)() as
      (width: number, phone: boolean, navOpen: boolean) => boolean;
    // [width, phone layout, menu open now] → fold it?
    const cases: Array<[number, boolean, boolean, boolean]> = [
      [1100, false, true, true],
      [900, false, true, true],
      [1199, false, true, true],
      [1200, false, true, false],        // 1200 is wide enough
      [1280, false, true, false],        // the e2e desktop project
      [1440, false, true, false],
      [1100, false, false, false],       // folded by hand already: nothing to fold
      [375, true, true, false],          // a phone has no side menu
      [899, true, true, false],
      [0, false, true, false],           // a width nobody could measure: leave it alone
    ];
    for (const [w, phone, open, fold] of cases) {
      expect(decide(w, phone, open), `${w} px, ${phone ? "phone" : "desktop"}, menu ${open ? "open" : "folded"}`).toBe(fold);
    }
  });
});

describe("a laptop-size window: 1100 px", () => {
  it("opening the assistant folds the menu, closing it brings the menu back", () => {
    const p = panel(1100);
    expect(p.navOpen()).toBe(true);

    p.tapAssistant();
    expect(p.S.admAi).toBe(true);
    expect(p.navOpen(), "the menu did not make room for the assistant").toBe(false);

    p.tapAssistant();
    expect(p.S.admAi).toBe(false);
    expect(p.navOpen(), "the menu stayed folded after the assistant closed").toBe(true);
  });

  it("the fold button says what is drawn — folded — while the fold is automatic", () => {
    const p = panel(1100);
    expect(p.side()).toContain('data-admnav aria-expanded="true" title="Свернуть меню"');
    p.tapAssistant();
    expect(p.side()).toContain('data-admnav aria-expanded="false" title="Развернуть меню"');
    expect(p.side()).toContain('aria-label="Развернуть меню"');
    p.tapAssistant();
    expect(p.side()).toContain('data-admnav aria-expanded="true" title="Свернуть меню"');
  });

  it("the automatic fold is never stored as the owner's preference", () => {
    const p = panel(1100);
    p.tapAssistant();
    expect(p.stored(), "the assistant's open state is still remembered").toMatchObject({ ai: true });
    expect(p.stored()!.nav, "the automatic fold was saved as his choice").toBe(true);
    expect(p.S.admNav, "S.admNav is his choice, not what is drawn").toBe(true);
    p.tapAssistant();
    expect(p.stored()).toMatchObject({ nav: true, ai: false });
  });

  it("every way the assistant closes brings the menu back — Escape, Back and the guard set S.admAi themselves", () => {
    const p = panel(1100);
    p.tapAssistant();
    expect(p.navOpen()).toBe(false);
    // what admCloseTop's "asst" layer, the Escape listener and admLeaveGuard do
    p.S.admAi = false;
    expect(p.navOpen(), "a close that is not the [data-admai] button left the menu folded").toBe(true);
  });

  it("a menu the owner folded himself stays folded when the assistant closes", () => {
    const p = panel(1100);
    p.tapFold();                                   // his own fold, before the assistant
    expect(p.navOpen()).toBe(false);
    expect(p.stored()).toMatchObject({ nav: false });

    p.tapAssistant();
    expect(p.navOpen()).toBe(false);
    expect(p.S.admNavAuto, "a fold that was already his was taken over as automatic").toBe(false);

    p.tapAssistant();
    expect(p.navOpen(), "closing the assistant unfolded a menu the owner had folded").toBe(false);
    expect(p.stored()).toMatchObject({ nav: false });
  });

  it("unfolding by hand while the assistant is open is his choice: it stays unfolded after the close", () => {
    const p = panel(1100);
    p.tapAssistant();
    expect(p.navOpen()).toBe(false);

    p.tapFold();                                   // «Развернуть меню»
    expect(p.navOpen(), "one press did not unfold the automatically folded menu").toBe(true);
    expect(p.side()).toContain('data-admnav aria-expanded="true"');
    expect(p.S.admAi, "the fold button closed the assistant").toBe(true);
    expect(p.stored()).toMatchObject({ nav: true });

    p.tapAssistant();
    expect(p.navOpen()).toBe(true);
    // …and the next opening decides afresh
    p.tapAssistant();
    expect(p.navOpen(), "the next opening on the same window did not fold again").toBe(false);
  });

  it("re-folding by hand while the assistant is open is his choice too: nothing is restored on close", () => {
    const p = panel(1100);
    p.tapAssistant();
    p.tapFold();                                   // unfold
    p.tapFold();                                   // …and fold again, himself
    expect(p.navOpen()).toBe(false);
    expect(p.stored(), "his own fold was not remembered").toMatchObject({ nav: false });

    p.tapAssistant();
    expect(p.navOpen(), "closing the assistant undid a fold the owner made himself").toBe(false);
    expect(p.stored()).toMatchObject({ nav: false, ai: false });
  });

  it("a resize while the assistant is open neither folds nor unfolds", () => {
    const p = panel(1100);
    p.tapAssistant();
    p.resize(1400);
    expect(p.navOpen(), "widening the window unfolded the menu under the open assistant").toBe(false);
    p.tapAssistant();
    expect(p.navOpen()).toBe(true);

    const q = panel(1400);
    q.tapAssistant();
    q.resize(1000);
    expect(q.navOpen(), "narrowing the window folded the menu under the open assistant").toBe(true);
    q.tapAssistant();
    expect(q.navOpen()).toBe(true);
  });
});

describe("a wide window: 1300 px", () => {
  it("opening and closing the assistant leaves the menu where it is", () => {
    const p = panel(1300);
    p.tapAssistant();
    expect(p.navOpen()).toBe(true);
    expect(p.side()).toContain('data-admnav aria-expanded="true"');
    p.tapAssistant();
    expect(p.navOpen()).toBe(true);
    expect(p.stored()).toMatchObject({ nav: true, ai: false });
  });

  it("a fold left over from a narrower window is not reused", () => {
    const p = panel(1100);
    p.tapAssistant();
    p.tapAssistant();
    p.resize(1300);
    p.tapAssistant();
    expect(p.navOpen(), "the last opening's fold came back on a wide window").toBe(true);
  });
});

describe("a phone has no side menu", () => {
  it("the assistant's sheet leaves the menu's state alone", () => {
    const p = panel(390);
    p.tapAssistant();
    expect(p.S.admNavAuto).toBe(false);
    expect(p.S.admNav).toBe(true);
    p.tapAssistant();
    expect(p.S.admNav).toBe(true);
  });
});

describe("a reload with the assistant open", () => {
  it("on a laptop-size window: the menu is folded for the assistant, and comes back when it closes", () => {
    const p = panel(1100, { nav: true, ai: true });
    expect(p.S.admAi).toBe(true);
    expect(p.navOpen()).toBe(false);
    expect(p.S.admNavAuto).toBe(true);
    expect(p.side()).toContain('data-admnav aria-expanded="false"');

    p.tapAssistant();
    expect(p.navOpen(), "the reload left the menu folded for good").toBe(true);
    expect(p.stored()).toMatchObject({ nav: true, ai: false });
  });

  it("the automatic fold survives no number of reloads as a preference", () => {
    const first = panel(1100);
    first.tapAssistant();
    const again = panel(1100, first.stored());
    expect(again.stored()!.nav).toBe(true);
    again.tapFold();                               // he unfolds it: from here on it is his
    const third = panel(1100, again.stored());
    expect(third.S.admNav).toBe(true);
    third.tapAssistant();
    expect(third.navOpen(), "closing after a reload left the menu folded").toBe(true);
  });

  it("on a wide window the menu is drawn as it was left", () => {
    const p = panel(1300, { nav: true, ai: true });
    expect(p.S.admAi).toBe(true);
    expect(p.navOpen()).toBe(true);
  });

  it("a menu stored folded stays folded and is not the assistant's to unfold", () => {
    const p = panel(1100, { nav: false, ai: true });
    expect(p.navOpen()).toBe(false);
    expect(p.S.admNavAuto).toBe(false);
    p.tapAssistant();
    expect(p.navOpen()).toBe(false);
  });

  it("a phone opens without the sheet and without touching the menu", () => {
    const p = panel(390, { nav: true, ai: true });
    expect(p.S.admAi).toBe(false);
    expect(p.S.admNavAuto).toBe(false);
  });
});

describe("the wiring in app.js", () => {
  it("the shell draws what admNavOpen() says, not the stored preference", () => {
    expect(fn("screenAdmin")).toContain('(admNavOpen() ? "" : " adm2--navmin")');
    expect(fn("screenAdmin")).not.toContain("S.admNav ?");
    expect(fn("admSideHTML")).not.toMatch(/S\.admNav\b/);
  });

  it("the two buttons go through the functions under test", () => {
    const at = src.indexOf("if (d.admnav !== undefined)");
    expect(at).toBeGreaterThan(0);
    const handlers = src.slice(at, src.indexOf("if (d.admtopback !== undefined)", at));
    expect(handlers).toContain("admNavToggle(); admPanesSave();");
    expect(handlers).toContain("admAiToggle();");
    expect(handlers, "a button flips S.admAi past the decision").not.toMatch(/S\.admAi = /);
  });

  it("nothing else opens the assistant past the decision", () => {
    /* Closing is free — admNavOpen() is derived, so every close brings the
       menu back — but an opening that skipped admNavAutoFold() would leave a
       stale S.admNavAuto deciding for it. The two doors are the toggle and the
       reload. */
    const opens = src.match(/S\.admAi = (?!false)[^;]*;/g) ?? [];
    expect(opens.sort()).toEqual(["S.admAi = !S.admAi;", "S.admAi = p.ai && !asstPhone;"].sort());
    expect(fn("admAiToggle")).toContain("S.admAi = !S.admAi;");
    expect(fn("admPanesLoad")).toContain("admNavAutoFold(");
  });

  it("the stored preference is S.admNav, whatever is drawn", () => {
    expect(fn("admPanesSave")).toContain("nav: S.admNav,");
  });
});
