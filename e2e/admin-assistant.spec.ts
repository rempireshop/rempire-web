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

    // he sends it himself
    await panel.locator("[data-admsend]").click();
    await expect(page.locator(".adm-msg--me")).toContainText("Привет какие заказы ждут отправки");
    await expect(page.locator("[data-aians]")).toBeVisible();
  });
});

test.describe("admin assistant — the microphone speaks the panel's language", () => {
  test.use({ extraHTTPHeaders: ipHeaders(132) });

  test("an Estonian panel asks for Estonian, and the button is named in it", async ({ page }) => {
    await stubSpeech(page, "");
    await loginAsAdmin(page);
    await adminLang(page, "ET");
    const panel = await openAssistant(page);

    const mic = panel.locator("[data-admvoice]");
    await expect(mic).toHaveAttribute("aria-label", "Häälsisestus");
    await mic.click();
    expect(await page.evaluate(() => (window as unknown as W).__rec.lang)).toBe("et-EE");
    await expect(panel.locator("[data-admq]")).toHaveAttribute("placeholder", "Kuulan…");
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("admin assistant — a refused microphone", () => {
  test.use({ extraHTTPHeaders: ipHeaders(133) });

  test("says so in plain words, and the button is back to idle", async ({ page }) => {
    await stubSpeech(page, "not-allowed");
    await loginAsAdmin(page);
    const panel = await openAssistant(page);

    const mic = panel.locator("[data-admvoice]");
    await mic.click();
    // short enough for the phone's one-line toast (admin.css .adm-toast__t)
    await expect(page.getByRole("status")).toContainText("Нет доступа к микрофону");
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(panel.locator("[data-admq]")).toHaveAttribute("placeholder", "Спросите обычными словами");
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
