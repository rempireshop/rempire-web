/**
 * /oauth/authorize — the page Claude opens when the owner presses «Подключить»
 * on the «Rempire» connector: what Claude will be able to do, the admin
 * password, «Разрешить».
 *
 *   GET  — the request checked (a registered client, Claude's own callback,
 *          PKCE S256) and the page drawn; a request that fails the check is
 *          never sent back anywhere, it is answered here
 *   POST — the password, through the very door the admin login uses: the
 *          growing delay first (loginDelayFor), then the two journal lines
 *          the delay is counted from («admin.login.failed» / «admin.login»,
 *          src/app/api/admin/login/route.ts) — a second door that skipped
 *          them would be a door with no ladder. Then a code, five minutes,
 *          bound to the PKCE challenge, the callback and this password.
 *
 * The way back to Claude is a link the page follows by itself (a meta
 * refresh), not a 302: the shop's CSP allows forms to post only to itself and
 * to Montonio (next.config.ts), and browsers hold the redirect after a form
 * post to that list.
 */
import {
  ADMIN_ACCOUNT, clearLoginFailures, clientIp, loginDelayFor, noteLoginFailure, rateLimit, sessionSecretOk, sleepForLogin, verifyPassword,
} from "@/lib/auth";
import { writeAuditSafe } from "@/lib/orders";
import { checkAuthRequest, clientKey, CODE_TTL_S, passwordMark, requestOrigin, sign, type AuthRequest } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(body: string, status = 200): Response {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Подключить Claude — Rempire</title>
<style>
:root{color-scheme:light}body{margin:0;background:#f4f3f0;color:#141414;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:420px;margin:48px auto;padding:28px 24px;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 12px}p{margin:0 0 14px}ul{margin:0 0 16px;padding-left:20px}li{margin:4px 0}
.no{color:#8a2b2b}.mut{color:#666;font-size:14px}label{display:block;font-weight:600;margin:18px 0 6px}
input[type=password]{box-sizing:border-box;width:100%;padding:12px;font-size:16px;border:1px solid #c9c6bf;border-radius:10px}
button,.go{display:block;width:100%;margin-top:16px;padding:13px;font-size:16px;font-weight:600;border:0;border-radius:10px;background:#141414;color:#fff;text-align:center;text-decoration:none;cursor:pointer}
.err{background:#fbeaea;color:#8a2b2b;padding:10px 12px;border-radius:10px;margin:0 0 14px}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

function formPage(r: AuthRequest, error = "", status = 200): Response {
  const host = new URL(r.redirectUri).host;
  const fields: Array<[string, string]> = [
    ["client_id", r.clientId], ["redirect_uri", r.redirectUri], ["response_type", "code"],
    ["code_challenge", r.challenge], ["code_challenge_method", "S256"], ["state", r.state], ["resource", r.resource],
  ];
  return page(
    `<h1>Подключить Claude к магазину Rempire</h1>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<p>${esc(r.clientName)} просит доступ к магазину rempireshop.com. Он сможет:</p>
<ul><li>искать товары, их цены и ссылки</li><li>читать статьи блога</li><li>сохранять <b>черновики</b> статей</li></ul>
<p class="no">Опубликовать или удалить статью, поменять цены, увидеть заказы и клиентов он не сможет.</p>
<form method="post" action="/oauth/authorize">
${fields.map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("\n")}
<label for="pw">Пароль от админки магазина</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Разрешить</button>
</form>
<p class="mut" style="margin-top:16px">После этого вернём вас в ${esc(host)}. Отключить можно в настройках Claude; смена пароля админки отключает его сразу.</p>`,
    status,
  );
}

export function GET(req: Request): Response {
  const origin = requestOrigin(req);
  const r = checkAuthRequest(new URL(req.url).searchParams, origin);
  if ("error" in r) return page(`<h1>Не получилось</h1><p class="err">${esc(r.error)}</p>`, 400);
  return formPage(r);
}

export async function POST(req: Request): Promise<Response> {
  const origin = requestOrigin(req);
  const ip = clientIp(req);
  let form: URLSearchParams;
  try {
    const raw = await req.text();
    if (raw.length > 8000) return page(`<h1>Не получилось</h1><p class="err">Слишком большой запрос.</p>`, 413);
    form = new URLSearchParams(raw);
  } catch {
    return page(`<h1>Не получилось</h1><p class="err">Запрос не прочитался.</p>`, 400);
  }
  const r = checkAuthRequest(form, origin);
  if ("error" in r) return page(`<h1>Не получилось</h1><p class="err">${esc(r.error)}</p>`, 400);
  if (!process.env.ADMIN_PASSWORD_HASH || !sessionSecretOk()) {
    return page(`<h1>Не получилось</h1><p class="err">Вход в админку не настроен на сервере.</p>`, 500);
  }
  if (rateLimit("oauth-authorize", ip, 20, 15 * 60_000)) return formPage(r, "Слишком много попыток — подождите немного.", 429);

  // the admin login's own ladder: the answer is what is late, a right password still opens
  await sleepForLogin(await loginDelayFor(ADMIN_ACCOUNT));
  const password = form.get("password") || "";
  if (!verifyPassword(password)) {
    noteLoginFailure(ADMIN_ACCOUNT);
    await writeAuditSafe(`ip:${ip}`, "admin.login.failed", { via: "claude-connector" });
    return formPage(r, "Неверный пароль.", 401);
  }
  clearLoginFailures(ADMIN_ACCOUNT);
  await writeAuditSafe(`ip:${ip}`, "admin.login", { via: "claude-connector" });

  const code = sign("code", { cid: clientKey(r.clientId), ru: r.redirectUri, ch: r.challenge, aud: origin, pw: passwordMark() }, CODE_TTL_S);
  const back = new URL(r.redirectUri);
  back.searchParams.set("code", code);
  if (r.state) back.searchParams.set("state", r.state);
  back.searchParams.set("iss", origin);
  const href = esc(back.toString());
  return page(
    `<meta http-equiv="refresh" content="0;url=${href}"><h1>Готово</h1><p>Claude подключён к магазину. Возвращаем вас обратно…</p>
<a class="go" href="${href}">Вернуться в Claude</a>`,
  );
}
