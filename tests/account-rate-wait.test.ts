/**
 * «Кабинет»: what the shopper reads when the code machine has cut him off.
 *
 * Five wrong guesses kill a code (CODE_MAX_ATTEMPTS) and each fresh one costs
 * a third of the budget POST /api/account/code allows per address and per IP —
 * so two burnt codes and the shopper is locked out. The screen said «Слишком
 * много попыток — подождите немного», which reads like a minute and is a
 * quarter of an hour (audit): he keeps pressing, the address stays blocked, and
 * nothing ever says why.
 *
 * This ties the sentence to the windows the two routes actually enforce: change
 * either window and this test asks for the sentence to be changed with it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const app = read("../public/shop2/app.js");

/** `var ACCT_ERRS = { … }` as a live object. */
function acctErrs(): Record<string, string> {
  const start = app.indexOf("var ACCT_ERRS = {");
  if (start < 0) throw new Error("public/shop2/app.js no longer has var ACCT_ERRS");
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) {
      return new Function(`${app.slice(start, i + 1)};return ACCT_ERRS;`)() as Record<string, string>;
    }
  }
  throw new Error("unbalanced braces around ACCT_ERRS in app.js");
}

/** Every `rateLimit(…, max, window)` window a route file asks for, in minutes. */
function windowsInMinutes(src: string): number[] {
  return [...src.matchAll(/rateLimit\([^)]*?(\d+)\s*\*\s*60\s*\*\s*1000\)/g)].map((m) => Number(m[1]));
}

describe("«Слишком много попыток» says how long", () => {
  it("names the wait instead of «немного»", () => {
    const word = acctErrs().rate_limited;
    expect(word, "the shopper cannot see a rate limit, only this sentence").toMatch(/15 минут/);
  });

  it("names the wait the two account routes actually enforce", () => {
    const code = windowsInMinutes(read("../src/app/api/account/code/route.ts"));
    const login = windowsInMinutes(read("../src/app/api/account/login/route.ts"));
    const windows = [...code, ...login];
    expect(windows.length, "both routes limit by IP; the code route also by address").toBeGreaterThan(0);

    const said = Number(/(\d+)\s*минут/.exec(acctErrs().rate_limited)?.[1]);
    for (const w of windows) expect(w, "a window the sentence does not name").toBe(said);
  });

  it("leaves the vaguer sentence where the window really is short", () => {
    // «Сообщить о поступлении» answers rate_limited with its own toast, and that
    // limiter is not this one — it must not be taught to promise 15 minutes.
    expect(app).toContain("Слишком много попыток — подождите немного");
  });
});
