import { expect, type Page, test } from "@playwright/test";
import { adminLang, ipHeaders, loginAsAdmin } from "./fixtures";

/**
 * The admin assistant's question box — voice input (Dim, 10.09.2026).
 *
 * The microphone button beside the box uses the browser's own speech
 * recognition (app.js admVoiceStart: `window.SpeechRecognition ||
 * window.webkitSpeechRecognition`), so there is no server half to mock —
 * but there is no real microphone in a test browser either. Each test
 * installs a stand-in for the API before the page loads (`stubSpeech`) and
 * then speaks through it from the test: what the panel asked of the API
 * (language, interim results), what it did with the words, and what it
 * never did (send them) are all observable from the outside.
 *
 * Desktop and mobile, like admin-shell.spec.ts: the owner dictates on an
 * iPhone, where the assistant is a sheet and the box sits above the keyboard.
 * Each describe has its own fake IP — admin login is rate-limited 5/min.
 *
 * r14 (Dim's S21 FE, 11.09.2026), two more promises at the bottom of this
 * file: the page may ask for the microphone at all — next.config.ts used to
 * send `microphone=()` for /shop2/*, which failed every tap as `not-allowed`
 * before any prompt, and the two refusals now read differently — and the
 * sheet keeps its compose row above the keyboard, by sizing itself to the
 * visual viewport (app.js admVvFollow, admin.css .adm-asst ≤ 899). A test
 * browser has no keyboard; a short viewport stands in for one, and a CDP
 * pinch-zoom is what makes `window.visualViewport` really differ from the
 * layout viewport, the way a keyboard does on a phone.
 */
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "tablet", "admin assistant spec — desktop and mobile projects only");
});

/** The stand-in the tests drive: window.__rec is the recognition the panel
 *  built, `say()` is the test speaking into it. */
type RecStub = {
  lang: string; interimResults: boolean; continuous: boolean;
  started: number; stopped: number; aborted: number;
  say: (text: string, final: boolean) => void;
};
type W = Window & { __rec: RecStub };

/** Installs a fake SpeechRecognition before any page script runs. `fail`
 *  makes start() end in that error, the way a browser whose microphone was
 *  refused does (`not-allowed`). Plain ES5 inside on purpose: the function is
 *  stringified into the page, so it must not lean on a transpiler helper. */
async function stubSpeech(page: Page, fail: string): Promise<void> {
  await page.addInitScript((failWith: string) => {
    function Rec(this: Record<string, unknown>) {
      this.lang = ""; this.interimResults = false; this.continuous = true; this.maxAlternatives = 1;
      this.started = 0; this.stopped = 0; this.aborted = 0;
      this.onresult = null; this.onerror = null; this.onend = null;
      (window as unknown as { __rec: unknown }).__rec = this;
    }
    type Self = {
      started: number; stopped: number; aborted: number;
      onresult: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null; onend: (() => void) | null;
    };
    Rec.prototype.start = function (this: Self) {
      this.started += 1;
      var self = this;
      if (failWith) setTimeout(function () {
        if (self.onerror) self.onerror({ error: failWith });
        if (self.onend) self.onend();
      }, 0);
    };
    Rec.prototype.stop = function (this: Self) {
      this.stopped += 1;
      var self = this;
      setTimeout(function () { if (self.onend) self.onend(); }, 0);
    };
    Rec.prototype.abort = function (this: Self) {
      this.aborted += 1;
      var self = this;
      setTimeout(function () { if (self.onend) self.onend(); }, 0);
    };
    // one result, with one alternative — the shape a browser hands over
    Rec.prototype.say = function (this: Self, text: string, final: boolean) {
      var alt: Array<{ transcript: string; confidence: number }> & { isFinal?: boolean } =
        [{ transcript: text, confidence: 0.9 }];
      alt.isFinal = final;
      if (this.onresult) this.onresult({ resultIndex: 0, results: [alt] });
    };
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Rec;
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Rec;
  }, fail);
}

async function openAssistant(page: Page) {
  await page.locator(".adm-fab").click();
  const panel = page.locator(".adm-asst");
  await expect(panel).toBeVisible();
  // the sheet slides in (admin.css adm-up, .2s of translateY): geometry read
  // mid-flight puts its bottom edge a few px under the screen
  await panel.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => undefined));
  return panel;
}

test.describe("admin assistant — the microphone", () => {
  test.use({ extraHTTPHeaders: ipHeaders(131) });

  test("it writes what it hears into the box, after what was typed, and sends nothing by itself", async ({ page }) => {
    await stubSpeech(page, "");
    await loginAsAdmin(page);
    const panel = await openAssistant(page);

    const mic = panel.locator("[data-admvoice]");
    await expect(mic).toBeVisible();
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(mic).toHaveAttribute("aria-label", "Голосовой ввод");
    const box = panel.locator("[data-admq]");
    await box.fill("Привет");

    // one tap listens — in the panel's language, with the words as they come
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(box).toHaveAttribute("placeholder", "Слушаю…");
    expect(await page.evaluate(() => {
      const r = (window as unknown as W).__rec;
      return { lang: r.lang, interim: r.interimResults, started: r.started };
    })).toEqual({ lang: "ru-RU", interim: true, started: 1 });

    await page.evaluate(() => (window as unknown as W).__rec.say("какие заказы", false));
    await expect(box).toHaveValue("Привет какие заказы");
    await page.evaluate(() => (window as unknown as W).__rec.say("какие заказы ждут отправки", true));
    await expect(box).toHaveValue("Привет какие заказы ждут отправки");
    // …and nothing has been asked yet
    await expect(page.locator(".adm-msg--me")).toHaveCount(0);

    // the second tap stops; the words stay in the box for the owner to fix
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(box).toHaveAttribute("placeholder", "Спросите обычными словами");
    expect(await page.evaluate(() => (window as unknown as W).__rec.stopped)).toBe(1);
    await expect(box).toHaveValue("Привет какие заказы ждут отправки");
    await expect(page.locator(".adm-msg--me")).toHaveCount(0);

    // he sends it himself — and the box is his again, empty
    await panel.locator("[data-admsend]").click();
    await expect(box).toHaveValue("");
    await expect(page.locator(".adm-msg--me")).toContainText("Привет какие заказы ждут отправки");
    await expect(page.locator("[data-aians]")).toBeVisible();
  });
});

/** Counts the page's requests from the moment it is attached, so a test can
 *  wait until the panel's start-up fetches — the orders list, the admin
 *  probe, the 30-day summary the assistant asks for on opening — have all
 *  landed AND painted. `waitForLoadState("networkidle")` will not do here:
 *  it is latched per document, so once the page was idle a first time
 *  (during the login) it resolves at once, whatever is in flight now. */
function trafficMeter(page: Page): { quietFor: (ms: number) => boolean } {
  let inflight = 0;
  let quietSince = Date.now();
  page.on("request", () => { inflight += 1; });
  const done = () => { inflight = Math.max(0, inflight - 1); if (!inflight) quietSince = Date.now(); };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return { quietFor: (ms) => inflight === 0 && Date.now() - quietSince >= ms };
}

test.describe("admin assistant — a sent question leaves the box", () => {
  test.use({ extraHTTPHeaders: ipHeaders(138) });

  /* The panel is patched in place, and an <input> keeps what the owner typed
   * across a render: admMorphNode only resets `.value` when the value
   * ATTRIBUTE changed, and typing never changes the attribute. So «→» and
   * Enter have to empty the box themselves. Before they did, the question
   * stayed in the box next to its answer — unless a background render (the
   * 30-day summary landing) happened to fall between the typing and the send,
   * which is why it only cleared sometimes. The test waits those renders out
   * first, so the send is exactly the case the old code failed in. */
  test("typed and sent with «→» or Enter, the question moves to the thread and the box is empty", async ({ page }) => {
    const traffic = trafficMeter(page);
    await loginAsAdmin(page);
    const panel = await openAssistant(page);
    await expect.poll(() => traffic.quietFor(600), { timeout: 20_000, message: "the panel's start-up fetches never settled" }).toBe(true);
    const box = panel.locator("[data-admq]");

    await box.fill("Какие заказы ждут отправки?");
    // the draft is in the box only, not yet in the markup (the attribute is what the last render wrote)
    await expect(box).toHaveAttribute("value", "");
    await panel.locator("[data-admsend]").click();
    await expect(box).toHaveValue("");
    await expect(page.locator(".adm-msg--me")).toContainText("Какие заказы ждут отправки?");
    await expect(page.locator("[data-aians]")).toBeVisible();

    await box.fill("Сколько заказов за месяц?");
    await expect(box).toHaveAttribute("value", "");
    await box.press("Enter");
    await expect(box).toHaveValue("");
    await expect(page.locator(".adm-msg--me")).toContainText("Сколько заказов за месяц?");
    // and the caret is back in it for the next question
    await expect(box).toBeFocused();
  });
});

/* Renat, 13.09.2026: «When in the assistant it seems to want to show me a
   "subject" instead it shows [Object object]». The confirm card's heading is
   `a.title` — and three of the actions the assistant may propose carry a
   TRILINGUAL `title` ({RU,ET,EN}: the set's name, the article's name), because
   that is what the prompt asks them for. esc() stringified the object.
   «Предложи набор…» is the everyday path into it. */
test.describe("admin assistant — the card names what it is proposing", () => {
  test.use({ extraHTTPHeaders: ipHeaders(139) });

  const SET_TITLE = "Набор для бороды — масло и бальзам";

  test("a set the assistant proposes is named in the card, never printed as a raw object", async ({ page }) => {
    await page.route("**/api/assistant/**", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, v: 99, model: "stub" }) });
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "Собрал набор для бороды из двух товаров. Подтвердите — откроется редактор наборов.",
          product_ids: [],
          tab: "goods",
          action: {
            type: "propose_bundle",
            // exactly the shape sanitizeAction() builds (actions.ts, triText)
            title: { RU: SET_TITLE, ET: "Habemekomplekt — õli ja palsam", EN: "Beard set — oil and balm" },
            desc: { RU: "Масло и бальзам в одном наборе.", ET: "Õli ja palsam ühes komplektis.", EN: "Oil and balm in one set." },
            cat: "beard",
            items: [
              { id: "proraso-wood-spice-beard-balm-100ml", variant: 0, qty: 1 },
              { id: "captain-fawcett-beard-oil-cf-332-private-stock", variant: 0, qty: 1 },
            ],
          },
        }),
      });
    });
    await loginAsAdmin(page);
    const panel = await openAssistant(page);
    await panel.locator("[data-admq]").fill("предложи набор для бороды");
    await panel.locator("[data-admsend]").click();

    const card = page.locator("[data-aians] .adm-propose");
    await expect(card).toBeVisible();
    // the heading is the set's Russian name — the whole card, not just it,
    // must be free of a stringified object
    await expect(card.locator(".adm-propose__t")).toHaveText(SET_TITLE);
    expect(await card.innerText()).not.toMatch(/\[object /i);
  });
});

test.describe("admin assistant — the microphone starts on the panel's language", () => {
  test.use({ extraHTTPHeaders: ipHeaders(132) });

  test("an Estonian panel asks for Estonian, says so on the button, and the mic is named in it", async ({ page }) => {
    await stubSpeech(page, "");
    await loginAsAdmin(page);
    await adminLang(page, "ET");
    const panel = await openAssistant(page);

    const mic = panel.locator("[data-admvoice]");
    await expect(mic).toHaveAttribute("aria-label", "Häälsisestus");
    // …and the language it will listen for is on screen before he taps it
    await expect(panel.locator("[data-admvoicelang]")).toHaveText("ET");
    await mic.click();
    expect(await page.evaluate(() => (window as unknown as W).__rec.lang)).toBe("et-EE");
    await expect(panel.locator("[data-admq]")).toHaveAttribute("placeholder", "Kuulan…");
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "false");
  });
});

/* Renat, 13.09.2026: «when I ask in russian, but my admin is in English — it
   tries to find english words for what I am saying in russian.» The panel's
   language was the language the recogniser was told to listen for; now that is
   only where the button starts, and one tap moves it. */
test.describe("admin assistant — the microphone listens in the language he chose", () => {
  test.use({ extraHTTPHeaders: ipHeaders(140) });

  test("one tap on the language button, and an English panel hears Russian — and remembers", async ({ page }) => {
    await stubSpeech(page, "");
    await loginAsAdmin(page);
    await adminLang(page, "EN");
    const panel = await openAssistant(page);

    const lang = panel.locator("[data-admvoicelang]");
    const mic = panel.locator("[data-admvoice]");
    // it starts where it always did — the panel's language
    await expect(lang).toHaveText("EN");
    await expect(lang).toHaveAttribute("title", "Voice input language");

    // one tap: the next of the three, and the button says which
    await lang.click();
    await expect(lang).toHaveText("RU");
    await mic.click();
    expect(await page.evaluate(() => (window as unknown as W).__rec.lang)).toBe("ru-RU");
    await page.evaluate(() => (window as unknown as W).__rec.say("какие заказы ждут отправки", true));
    await expect(panel.locator("[data-admq]")).toHaveValue("какие заказы ждут отправки");
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "false");

    // …and it is still Russian after a reload, without following the panel back
    // (the pane's own open/closed state is remembered too, so it may be back
    // on screen already — admPanesSave)
    await page.reload();
    if (!(await page.locator(".adm-asst").isVisible())) await page.locator(".adm-fab").click();
    await expect(page.locator(".adm-asst")).toBeVisible();
    const again = page.locator("[data-admvoicelang]");
    await expect(again).toHaveText("RU");
    await again.click();
    await expect(again).toHaveText("ET");   // three of them, in a ring
    await again.click();
    await expect(again).toHaveText("EN");
  });
});

test.describe("admin assistant — a refused microphone", () => {
  test.use({ extraHTTPHeaders: ipHeaders(133) });

  test("says where to allow it, whole, and the button is back to idle", async ({ page }) => {
    await stubSpeech(page, "not-allowed");
    await loginAsAdmin(page);
    const panel = await openAssistant(page);

    const mic = panel.locator("[data-admvoice]");
    await mic.click();
    // the owner (or his browser's site settings) said no: the toast says where that is undone
    const status = page.getByRole("status");
    await expect(status).toContainText("Микрофон запрещён — разрешите его в настройках браузера для этого сайта");
    // …and all of it is on screen: the toast wraps now (admin.css .adm-toast__t, up
    // to three lines) — the one-line cut lost exactly the half that said where
    expect(await status.locator(".adm-toast__t").evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(panel.locator("[data-admq]")).toHaveAttribute("placeholder", "Спросите обычными словами");
  });
});

test.describe("admin assistant — a microphone the page itself bars", () => {
  test.use({ extraHTTPHeaders: ipHeaders(135) });

  test("is «not here», not «allow it in the settings» — there is nothing the owner could allow", async ({ page }) => {
    await stubSpeech(page, "not-allowed");
    // what a page under `microphone=()` looks like from inside (Chrome's
    // document.permissionsPolicy / featurePolicy): the same `not-allowed`,
    // a different cause — app.js admVoiceBarred() reads it
    await page.addInitScript(() => {
      const barred = { allowsFeature: (name: string) => name !== "microphone" };
      Object.defineProperty(document, "permissionsPolicy", { value: barred, configurable: true });
      Object.defineProperty(document, "featurePolicy", { value: barred, configurable: true });
    });
    await loginAsAdmin(page);
    const panel = await openAssistant(page);

    await panel.locator("[data-admvoice]").click();
    await expect(page.getByRole("status")).toContainText("Микрофон здесь недоступен");
    await expect(page.getByRole("status")).not.toContainText("настройках");
  });
});

test.describe("admin assistant — the page may ask for the microphone at all", () => {
  test.use({ extraHTTPHeaders: ipHeaders(136) });

  test("Permissions-Policy opens the microphone (and the camera) to this origin on the admin and the shop, nothing else", async ({ page, request }) => {
    for (const path of ["/shop2/admin/", "/shop2/"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const policy = res.headers()["permissions-policy"] || "";
      expect(policy, path).toContain("microphone=(self)");
      expect(policy, path).toContain("camera=(self)");
      for (const denied of ["geolocation=()", "payment=()", "usb=()", "display-capture=()"]) {
        expect(policy, `${path}: ${denied}`).toContain(denied);
      }
    }
    // …and the browser agrees: what the assistant's script sees on the admin page
    await loginAsAdmin(page);
    expect(await page.evaluate(() => {
      const fp = (document as unknown as { featurePolicy?: { allowsFeature: (f: string) => boolean } }).featurePolicy;
      return fp ? { mic: fp.allowsFeature("microphone"), cam: fp.allowsFeature("camera"), geo: fp.allowsFeature("geolocation") } : null;
    })).toEqual({ mic: true, cam: true, geo: false });
  });
});

/* ---------- the sheet above the keyboard ---------------------------------- */

/** The visual viewport as the page sees it — layout px, like getBoundingClientRect(). */
async function visual(page: Page): Promise<{ top: number; height: number; scale: number; inner: number }> {
  return page.evaluate(() => {
    const v = window.visualViewport!;
    return { top: v.offsetTop, height: v.height, scale: v.scale, inner: window.innerHeight };
  });
}

/** An element's box in layout px — getBoundingClientRect(), which a pinch-zoom
 *  does not change, where Playwright's own boundingBox() may follow the zoom. */
async function rect(page: Page, sel: string): Promise<{ top: number; bottom: number; left: number; height: number; width: number }> {
  return page.evaluate((s: string) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, height: r.height, width: r.width };
  }, sel);
}

test.describe("admin assistant — the sheet above the keyboard", () => {
  test.use({ extraHTTPHeaders: ipHeaders(137) });

  test("the shell asks Chrome on Android to shrink the layout viewport for the keyboard", async ({ page }) => {
    await loginAsAdmin(page);
    // interactive-widget=resizes-content: since Chrome 108 the keyboard shrinks only the
    // visual viewport by default, and a sheet fixed to the bottom stays under the keys
    // (tools/prerender-shop2.mjs writes this meta into every page, the shell included)
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toContain("interactive-widget=resizes-content");
    expect(content).toContain("viewport-fit=cover");
  });

  test("phone: on a short screen the sheet is the whole of it — head at the top, compose row at the bottom, messages scrolling between", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone's sheet — the desktop keeps its column");
    await loginAsAdmin(page);
    // a keyboard's worth of screen gone: 375×500 is what a 375×812 phone shows above the keys
    await page.setViewportSize({ width: 375, height: 500 });
    const panel = await openAssistant(page);

    const sheet = await rect(page, ".adm-asst");
    expect(sheet.top).toBeGreaterThanOrEqual(0);
    expect(sheet.bottom).toBeLessThanOrEqual(500);
    expect(Math.round(sheet.height)).toBe(500);   // the whole of a short screen, not 75 % of it
    const head = await rect(page, ".adm-asst__head");
    expect(head.top - sheet.top).toBeGreaterThanOrEqual(0);
    expect(head.top - sheet.top).toBeLessThanOrEqual(1.5);   // the sheet's own 1-px top rule
    const foot = await rect(page, ".adm-asst__foot");
    expect(foot.bottom).toBeLessThanOrEqual(sheet.bottom + 0.5);
    expect(foot.bottom).toBeLessThanOrEqual(500);
    for (const sel of ["[data-admq]", "[data-admsend]", "[data-admattach]", "[data-admvoice]", "[data-admvoicelang]"]) {
      await expect(panel.locator(sel)).toBeVisible();
      const r = await rect(page, sel);
      expect(r.bottom, sel).toBeLessThanOrEqual(500);
      expect(r.top, sel).toBeGreaterThanOrEqual(foot.top - 0.5);
      // …and inside the screen sideways: the compose row gained the language
      // button, and 375 px is the width it has to fit in
      expect(r.left, sel).toBeGreaterThanOrEqual(-0.5);
      expect(r.left + r.width, sel).toBeLessThanOrEqual(375.5);
      // a thumb's target on a phone (README § Constraints)
      expect(Math.round(r.width), sel).toBeGreaterThanOrEqual(44);
      expect(Math.round(r.height), sel).toBeGreaterThanOrEqual(44);
    }
    // nothing spilling sideways off the page either
    const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(spill, "the assistant's sheet scrolls sideways at 375 px").toBeLessThanOrEqual(1);
    // the messages are the part that scrolls, between the head and the compose row
    const body = panel.locator(".adm-asst__body");
    expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    const bodyBox = await rect(page, ".adm-asst__body");
    expect(bodyBox.top).toBeGreaterThanOrEqual(head.top + head.height - 0.5);
    expect(bodyBox.bottom).toBeLessThanOrEqual(foot.top + 0.5);

    // typing and sending works from that box: the answer lands, the row stays put
    const box = panel.locator("[data-admq]");
    await box.focus();
    await expect(box).toBeFocused();
    await box.fill("Какие заказы ждут отправки?");
    await panel.locator("[data-admsend]").click();
    await expect(page.locator("[data-aians]")).toBeVisible();
    const footAfter = await rect(page, ".adm-asst__foot");
    expect(footAfter.bottom).toBeLessThanOrEqual(500);
  });

  test("the sheet is the visual viewport while that is smaller than the screen, and the plain sheet again after; the desktop column is untouched", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile";
    await loginAsAdmin(page);
    const panel = await openAssistant(page);
    await panel.locator("[data-admq]").fill("Какие заказы ждут отправки?");
    await panel.locator("[data-admsend]").click();
    await expect(page.locator("[data-aians]")).toBeVisible();
    const full = await visual(page);
    expect(full.scale).toBe(1);

    /* A pinch-zoom to 2×: the layout viewport stays, the visual one is half
       as tall — exactly the shape a keyboard gives the page on a phone, and
       the one thing a test can do to window.visualViewport from outside. */
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await expect.poll(async () => (await visual(page)).scale).toBe(2);
    const half = await visual(page);
    expect(half.height).toBeLessThan(full.height * 0.6);
    expect(half.inner).toBe(full.inner);   // the layout viewport did not move — this is the keyboard's shape

    if (mobile) {
      // the sheet is now exactly the visual viewport: its top at the top of it, its bottom at the bottom
      await expect.poll(async () => {
        const s = await rect(page, ".adm-asst");
        const v = await visual(page);
        return Math.abs(s.height - v.height) < 1 && Math.abs(s.bottom - (v.top + v.height)) < 1 && Math.abs(s.top - v.top) < 1;
      }, { message: "the sheet should be the visual viewport" }).toBe(true);
      const v = await visual(page);
      const foot = await rect(page, ".adm-asst__foot");
      expect(foot.bottom).toBeLessThanOrEqual(v.top + v.height + 0.5);
      expect(foot.top).toBeGreaterThanOrEqual(v.top);
      // the newest message was brought into view above the keys
      expect(await panel.locator(".adm-asst__body").evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--a-vvh"))).toBe(Math.round(v.height) + "px");
    } else {
      // a desktop: the 380-px column beside the work, nothing written to the root
      expect(Math.round((await rect(page, ".adm-asst")).width)).toBe(380);
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--a-vvh"))).toBe("");
    }

    // the viewport grows back (the keyboard went away): the plain sheet — 75 % of the screen — again
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await expect.poll(async () => (await visual(page)).scale).toBe(1);
    if (mobile) {
      await expect.poll(async () => Math.round((await rect(page, ".adm-asst")).height / page.viewportSize()!.height * 100)).toBe(75);
      expect((await rect(page, ".adm-asst")).bottom).toBe(page.viewportSize()!.height);
    }
    // folding the sheet away leaves nothing behind on the root
    await panel.locator(".adm-asst__fold").click();
    await expect(page.locator(".adm-asst")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--a-vvh"))).toBe("");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--a-vvbot"))).toBe("");
  });
});

test.describe("admin assistant — a browser without speech recognition", () => {
  test.use({ extraHTTPHeaders: ipHeaders(134) });

  test("gets no microphone button at all, and the rest of the box is intact", async ({ page }) => {
    // Firefox has neither name; Chromium has the webkit- one, so both are taken away
    await page.addInitScript(() => {
      Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true, writable: true });
      Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true, writable: true });
    });
    await loginAsAdmin(page);
    const panel = await openAssistant(page);

    await expect(panel.locator("[data-admvoice]")).toHaveCount(0);
    await expect(panel.locator("[data-admattach]")).toBeVisible();
    await expect(panel.locator("[data-admq]")).toBeVisible();
    await expect(panel.locator("[data-admsend]")).toBeVisible();
  });
});
