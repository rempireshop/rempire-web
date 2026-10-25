# The «Rempire» connector for Claude

*Since 20.10.2026. Renat writes the blog in his own Claude (claude.ai, Pro).
With this connector his Claude finds the shop's real products and their
addresses, reads the blog, and saves an article into the shop as a draft —
he checks it in Админка → Блог and publishes it there.*

## For Renat (по-русски)

**Подключить один раз** (на компьютере, на claude.ai):

1. Claude → слева внизу ваше имя → **Настройки** → **Коннекторы** (Customize → Connectors).
2. **Добавить свой коннектор** (Add custom connector).
3. Название: `Rempire`. Адрес: `https://rempireshop.com/api/mcp`. Нажать **Добавить**.
4. Нажать **Подключить** (Connect). Откроется страница магазина «Подключить Claude к магазину Rempire» —
   ввести **пароль от админки** и нажать **Разрешить**. Claude вернётся сам.

**Как писать статью:**

* В новом чате: «Напиши статью для блога Rempire про шампуни Kevin.Murphy — с товарами из магазина».
  Claude сам найдёт товары, их цены и ссылки.
* Поправить: «сократи второй раздел», «добавь Angel.Rinse» — как обычно.
* Картинки: «поставь обложкой фото Angel.Wash», «добавь в текст фото товаров» — Claude берёт
  **фото товаров из магазина**. Свои фотографии из салона он передать не может — их добавляют
  в редакторе статьи (обложка или «Фото» в тексте).
* Сразу на трёх языках: «сохрани на русском, эстонском и английском» — Claude переведёт сам.
* Сохранить: «**Сохрани в блог как черновик**». Статья появится в Админке → «Блог» черновиком
  (список обновляется сам в течение полуминуты).
* Там: проверить, поставить обложку, при необходимости «Перевести на ET и EN» — и «Опубликовать».
  Или сразу попросить Claude: «сохрани и переведи на эстонский и английский».

**Тексты товаров для Google** (с 25.10.2026): «напиши Google-тексты для Kevin.Murphy Rough.Rider на
трёх языках и сохрани» или «…для всех товаров Kevin.Murphy». Claude читает описание товара и пишет
заголовок и описание для поиска Google на RU/ET/EN — сохраняется **сразу**, видно в Админке → Товары →
товар → «Для Google». В Админке → **Журнал** у каждой такой записи есть **«Вернуть»**.

**Что Claude может и чего не может:** искать товары, читать статьи, сохранять **черновики**,
записывать **тексты товаров для Google**. Опубликовать, удалить, поменять опубликованную статью,
цены, описание товара, увидеть заказы и клиентов — **не может**. Отключить — в тех же настройках Claude; смена пароля админки
отключает его сразу.

## How it works

| Piece | File |
|---|---|
| MCP endpoint (Streamable HTTP, stateless JSON-RPC) | `src/app/api/mcp/route.ts`, `src/lib/mcp/protocol.ts` |
| Tools | `src/lib/mcp/tools.ts` (products: `shopProducts()` in `src/lib/merchant-feed.ts`) |
| Sign-in (OAuth 2.1) | `src/lib/mcp/oauth.ts`, `src/app/oauth/{register,authorize,token}/route.ts` |
| Discovery | `src/app/.well-known/oauth-protected-resource/route.ts` (+ `/api/mcp` suffix), `src/app/.well-known/oauth-authorization-server/route.ts` |
| Tests | `tests/mcp-connector.test.ts`, entries in `tests/fuzz-routes.test.ts` |

**The handshake** — what Claude's custom connectors require
([claude.com/docs/connectors/building/authentication](https://claude.com/docs/connectors/building/authentication)):

1. `POST /api/mcp` without a token → `401` with
   `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource", scope="blog"`.
2. Protected-resource metadata names `resource: <origin>/api/mcp` and the shop itself as the
   authorization server; its RFC 8414 metadata lists `/oauth/authorize`, `/oauth/token`,
   `/oauth/register`, PKCE `S256`, `token_endpoint_auth_methods_supported: ["none"]`,
   `offline_access` (so Claude asks for a refresh token).
3. `POST /oauth/register` (DCR, JSON) — only `https://claude.ai/api/mcp/auth_callback`,
   `https://claude.com/api/mcp/auth_callback` or a loopback address (Claude Code) are accepted.
4. `GET /oauth/authorize` — the page; `POST` — the admin password through the admin login's
   own delay ladder and journal lines (`admin.login` / `admin.login.failed`, `via: claude-connector`).
   The way back is a link the page follows by itself (meta refresh), because the shop's CSP
   `form-action` would hold a 302 to claude.ai after a form post.
5. `POST /oauth/token` (form-encoded) — code + PKCE verifier → access (1 h) + refresh (90 days,
   rotated); `invalid_grant` for anything spent, expired or not this shop's.

**Stateless tokens.** Nothing is stored: client ids, codes and tokens are JSON signed with
HMAC-SHA256 under a key derived from `SESSION_SECRET`. Each carries the origin it was issued for
and a fingerprint of `ADMIN_PASSWORD_HASH` — **changing the admin password signs Claude out**,
that is the revocation. Limits of statelessness: a code is single-use per serverless instance
only, and a rotated refresh token stays valid until it expires. Acceptable for what the token
opens: drafts only.

**No new environment variables.** It uses `SESSION_SECRET` and `ADMIN_PASSWORD_HASH`, which the
admin login already needs.

**The tools** — `search_products`, `get_product`, `list_sections`, `list_posts`, `get_post`
(read), `save_draft` and `save_product_google_text` (write). `save_draft`:

* `ru` required, `et`/`en` optional; HTML (or markdown) through the blog's own `sanitizeHtml()`;
* a link to a product page (`https://rempireshop.com/…/products/ID`, a relative path or
  `product:ID`) is pointed at that product in the article's language, or loses its address when
  the shop does not sell the id;
* `<a data-product="ID"></a>` becomes the editor's own «Товар» marker (name in that language,
  `data-price="live"`), so the card shows and can be removed in the editor;
* pictures are the shop's own product photos only (`get_product` → `photos`): `cover` takes a
  product id or one of those addresses (anything else is refused, nothing saved); an `<img>` in
  the text with any other address is dropped, an emptied `<figure>` with it. The owner's own
  photos cannot travel from a Claude chat into a tool call — they are added in the editor;
* the products it names go into «Товары в статье» (up to 40);
* without `slug` — a new draft; with a draft's slug — the languages sent replace theirs, the rest
  (cover, other languages, tags unless sent) stays; a **published** article is refused.
* journal line `mcp.save_draft`.

`save_product_google_text` (25.10.2026 — Renat's panel button had written «других сведений нет»
into 29 products, and his Claude writes better): a product's Google pair, `ru`/`et`/`en` each
`{title, description}`, the same storage as the panel's «Для Google» (`setSeoOverride()`,
`src/lib/product-seo.ts`). Held the way the panel's own AI answer is: title ≤ 70 (asked for 60),
description ≤ 170 (asked for 155), no sentence about missing data (`seoDropMetaTalk()`), no
Russian word on the ET/EN pair outside the brand and the maker's name (`seoOffLanguage()`) —
anything refused saves nothing. Languages not sent keep theirs. Written as an `override.set`
journal line with `via: "claude"` and the pair it replaced as `prev`, so «Вернуть» in the panel's
journal puts the old texts back from any device (`src/lib/audit-undo.ts`); IndexNow hears about
the page. `get_product` shows the current pair as `google_text`.

**Adding it in Claude Code** (for testing): `claude mcp add --transport http rempire https://rempireshop.com/api/mcp`,
then `/mcp` → authenticate; loopback callbacks are accepted on any port.
