# «Продолжить с Google» — sign-in with Google

Customers can sign in with Google as well as with the e-mailed six-digit
code. The code stays exactly as it is; Google is a second door into the same
account. Dim approved the design on 02.11.2026
(`canvas-banner/project/Login.dc.html`, `GoogleBtn.dc.html`).

**It is built and switched off.** Nothing shows anywhere until the deployment
has a `GOOGLE_CLIENT_ID`, and that needs a Google client, which needs the
shop's Google account to have 2-step verification first. This page is the
setup for that day, then how the thing works.

## Setup — once, by the owner (Google Cloud Console)

Everything below is in the [Google Cloud Console](https://console.cloud.google.com/),
signed in as **the shop's Google account**. Google calls the sign-in part
**Google Auth Platform** (left menu, or search for it). Before starting, that
account must have 2-step verification on — the console refuses without it.

### 1. A project

Project picker (top bar) → **New project** → name it, e.g. `REMPIRE shop` →
**Create**, and make sure it is the selected project for the steps below.

### 2. Branding

Google Auth Platform → **Branding** (the first visit offers **Get started**,
which asks the same questions):

| Field | Value |
| --- | --- |
| App name | `REMPIRE` |
| User support e-mail | the shop's account |
| App logo | **leave empty** — a logo sends the app to Google's brand review, which basic sign-in does not need |
| Application home page | `https://rempireshop.com` |
| Privacy policy link | `https://rempireshop.com/policies/privacy-policy` |
| Terms of service link | `https://rempireshop.com/policies/terms-of-service` |
| Authorised domains | `rempireshop.com` |
| Developer contact e-mail | the shop's account |

Save.

### 3. Audience

Google Auth Platform → **Audience**:

- User type: **External** (any Google account, not only one company's).
- Publishing status: press **Publish app** → **In production**. In «Testing»
  only listed test users can sign in. The three basic scopes below need no
  verification by Google, so production is immediate.

### 4. Data access

Google Auth Platform → **Data access** → **Add or remove scopes** → tick
exactly these three, nothing else:

- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

**Update** → **Save**. The consent screen will then say the shop sees the name,
the e-mail address and the profile picture's address; the shop keeps only the
name and the e-mail.

### 5. The client

Google Auth Platform → **Clients** → **Create client**:

- Application type: **Web application**
- Name: `rempireshop.com` (only you see it)
- Authorised JavaScript origins: `https://rempireshop.com`
- Authorised redirect URIs — both:
  - `https://rempireshop.com/api/account/google/callback`
  - `http://localhost:3300/api/account/google/callback` (local development)

If `www.rempireshop.com` ever serves the shop itself instead of redirecting
to `rempireshop.com`, add `https://www.rempireshop.com/api/account/google/callback`
too — the redirect URI is built from the address the shopper is on, and
Google refuses one it has not been given (`redirect_uri_mismatch`, on
Google's own error page). The staging host would need its own line the same
way; Vercel preview addresses cannot be listed and simply do not get the
button working.

**Create.** Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
The client ID is public — it is in every sign-in address a browser sees.
**The client secret is not used.** Do not copy it into Vercel or anywhere else.

### 6. Switch it on — needs Dim's OK

Vercel → the project → **Settings → Environment Variables** →
`GOOGLE_CLIENT_ID` = the client ID, environment **Production** → Save, then
redeploy (a variable reaches only deployments made after it). Nothing else is
needed: `SESSION_SECRET` is already set.

### 7. Check

- `curl -sI https://rempireshop.com/api/account/google/start` → `302` with a
  `location:` at `accounts.google.com` (it was `404` before).
- «Кабинет» shows «Продолжить с Google» above the e-mail box within a minute
  (`/api/overrides/` is cached at the edge for 30 s).
- Walk the three checks in `/test`: `acct-google-login`, `acct-google-cancel`,
  `checkout-google-contact`.

To switch it off again, delete the variable and redeploy: the button
disappears and both routes answer 404. Accounts made through Google stay
ordinary accounts — their owners sign in with the code from then on.

## How it works

OpenID Connect, implicit flow: `response_type=id_token`,
`response_mode=form_post`. It needs no client secret — that is why it was
chosen: nobody has to paste a secret anywhere.

1. **`GET /api/account/google/start?return=/ru/checkout`**
   (`src/app/api/account/google/start/route.ts`) makes a random `state` and
   `nonce`, puts them with the return path in the `rmp_gauth` cookie —
   signed with `SESSION_SECRET` under its own prefix, HttpOnly, 10 minutes,
   `Path=/api/account/google` — and answers `302` to Google's chooser with
   `prompt=select_account`.
   - The cookie is **`SameSite=None; Secure`**: Google comes back with a
     cross-site POST, which a Lax cookie would not ride on. Secure works on
     `http://localhost` too (Chrome and Firefox treat localhost as secure).
   - `return` must be a plain path inside the shop (`safeReturnPath`): one
     leading `/`, no `//`, no scheme, no backslash, no whitespace, not the
     API. Anything else becomes `/account`. There is no open redirect.
2. **`POST /api/account/google/callback`**
   (`src/app/api/account/google/callback/route.ts`) — Google's form, either
   `id_token` + `state` or `error`. Checked in this order:
   - the `Origin`, when the browser sends one, is `https://accounts.google.com`
     (anything else: `403`). This is the only route in the shop that takes a
     POST from another site. There is no shop-wide Origin/CSRF layer to
     exempt it from — `src/middleware.ts` leaves `/api/` out by its matcher,
     and the routes that need an Origin check make their own;
   - `state` equals the cookie's;
   - the ID token (`verifyIdToken`, `src/lib/google-signin.ts`): RS256 with
     one of Google's published keys, `iss` = `accounts.google.com` or
     `https://accounts.google.com`, `aud` = our client ID, `exp`/`iat` within
     60 s, `nonce` = the cookie's, and `email_verified === true` — the address
     is the account, so an unverified one would hand somebody else's orders to
     whoever typed it.
   - Google's keys (`https://www.googleapis.com/oauth2/v3/certs`) are kept in
     memory by `kid` for as long as the endpoint's own `max-age` says (an hour
     if it says nothing), and fetched again on an unknown `kid` (key rotation),
     at most once per 30 s. A sign-in is one RSA check — no measurable CPU.
3. The customer is signed in by **`signInCustomer`**
   (`src/lib/customer-signin.ts`) — the same function the code login
   (`/api/account/login`) now uses: the 90-day `rmp_cust` session first, then
   `recordLogin()` finds the row by the lower-cased e-mail or creates it
   exactly as a first code login does (language from the return path,
   marketing off, `source` null — 221; a deleted account's address gets a
   new empty account, its old orders stay detached — 223). One addition: an
   account with **no name** takes the name Google sent, so the checkout's
   name field is filled. A name already there is never changed.
4. `303` back to the return path with `?google=ok` or `?google=cancel` (every
   failure is «cancel» to the shopper; the reason goes to the log as
   `[api/account/google/callback] refused: <reason>`, never the token or the
   address).

**The storefront** (`public/shop2/app.js`, «Продолжить с Google»): the flag
rides on `/api/overrides/` as `settings.google_signin` — no extra request on
any page. «Кабинет» (signed out): the button, «или кодом на почту», the
e-mail form, and the note «Google передаёт нам только имя и e-mail…». The
checkout's step 1: «Продолжить с Google — заполнит имя и e-mail», only for a
shopper who is not signed in. On the way back `googleBack` takes the flag out
of the address and shows «Вы вошли как … — найдено N прежних заказов» or the
alert; at the checkout the shopper is on the same step with the same basket,
and the profile fills the e-mail (and the name on step 2). The button's look
is Google's branding for the light button; no Google font and no Google
script are loaded.

**Privacy policy**: one sentence in each language's «Конфиденциальность»
(`public/shop/legal.ru.js`, `legal.et.js`, `legal.en.js`; `legal.js` is
written from the Russian by `tools/sync-legal-fallback.mjs`). An owner
override of that page (`content.legal.privacy` in the shop's content
settings) replaces the built-in text whole — if one is ever written, the
Google sentence has to be in it.

**Tests**: `tests/google-signin.test.ts` (a local RSA key pair and a stubbed
keys endpoint; sign-in of an existing and a new account; every refusal;
return paths; 404 when off), `e2e/google-signin.spec.ts` (hidden without the
variable; visible and pointing at the start route on «Кабинет» and the
checkout when the feed says on), and the two Google routes in
`tests/fuzz-routes.test.ts`.
