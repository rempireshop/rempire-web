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

**Описание и название товара** (с 26.10.2026): «перепиши описание Kevin.Murphy Angel.Wash — короче,
на трёх языках», «переименуй FLAWLESS Bond Building Styling Lotion в … — лосьон для укладки»,
«перенеси Proraso White в раздел Борода». Claude сначала читает товар, показывает, что запишет, и
сохраняет **сразу** — это видно на странице товара. Название пишется так: имя от производителя
латиницей, потом « — » и тип по-русски («Bio Botanical Shampoo — шампунь»). Если тип такой, что
эстонская и английская страница его не скажут, Claude получит отказ со списком слов, которые
магазин переводит, — и предложит одно из них. Адрес страницы и остатки не меняются; уже сделанные
заказы остаются со старым названием. **«Вернуть»** — в Журнале, как для всего остального.

**Цены и остатки** (с 26.10.2026): «сколько стоит и сколько осталось Kevin.Murphy Angel.Wash?»,
«поставь 250 мл 26,90 €», «посчитал: 100 мл осталось 3». Claude читает товар, говорит, что
поменяет, и сохраняет. Цену, которая меняется **больше чем на 30 %**, он сначала переспросит —
сохранит только после вашего «да» (защита от опечатки «5 €» вместо «50 €»). Остаток он записывает,
только если с момента, как он его прочитал, ничего не продали и не отсканировали — иначе скажет
новое число и спросит ещё раз. Цена — в Журнале с «Вернуть»; остаток — в Складе → История
(«Claude») и строчкой в Журнале. Если остаток был 0, люди из «Сообщить о наличии» получат письмо,
как и при записи в Складе.

**Новый товар** (с 26.10.2026): «добавь новый товар: FLAWLESS Bond Building Styling Lotion,
лосьон для укладки, 100 мл 24,90 €, 250 мл 39,90 €, вот описание…». Claude создаёт его **скрытым** —
в магазине его никто не видит. Дальше в Админке → Товары → «Скрытые» → этот товар: добавить фото и
включить «Показывать в магазине». Тексты для Google и остаток Claude может записать сразу.
Если такой товар уже есть — Claude скажет, какой, и второй не создаст.

**Что Claude может и чего не может:** искать товары, читать статьи, сохранять **черновики**,
менять у товара **описание, название, бренд, раздел, тексты для Google, цены и остаток**,
создавать **новые товары скрытыми**.
Опубликовать, удалить, поменять опубликованную статью, удалить товар, увидеть заказы и клиентов —
**не может**. Отключить — в тех же настройках Claude; смена пароля админки
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
(read), `save_draft`, `save_product_google_text`, `save_product_description`,
`save_product_name`, `save_product_price`, `save_product_stock` and `create_product` (write).
`search_products` takes `include_hidden` and `get_product` reads a hidden own product by id
(`hidden: true`, `url: null`) — so Claude can finish a product it created. `save_draft`:

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

**Where a product's words live.** A catalogue product's in `product_overrides` (journal line
`override.set`, undo through `PUT /api/admin/overrides`); the owner's own product («c-…») on its
`custom_products` row, where the panel writes them (journal line `product.update` with `prev`
since 26.10.2026, undo through `PUT /api/admin/products/<id>` — `ownPrev()` in
`src/lib/custom-products.ts`). Every write tool goes through `target()` in `tools.ts`, which
picks the place; an own product can be written while it is hidden.

`save_product_description` (26.10.2026): the page text, `ru`/`et`/`en` plain strings, merged
over what is stored (languages not sent keep theirs). Plain text because `descOvHtml()` in
`app.js` escapes it and makes a `<p>` of each block — HTML or markdown is refused, not
stripped, so Claude rewrites it; ≤ 4000 characters; `seoDropMetaTalk()` per sentence;
`seoOffLanguage()` on ET/EN. `get_product` hands the stored text back with its paragraphs
(`description`, plus `description_by_owner`), not the feed's flattened copy.

`save_product_name` (26.10.2026, Dim: «block + suggest»): `name`/`brand`/`section`, the same
rules as the panel's «Что за товар» — one line, `MAX_NAME`/`MAX_BRAND`, a section from
`PRODUCT_CATS`, a name `nameTranslatable()` (otherwise refused with what ET/EN would say and the
whole `TRANSLATABLE_TAILS` list); a section move resets the subsection. Then
`requestRebuild("product-rename")` and IndexNow. The id, page address and stock key never change.

`save_product_price` (26.10.2026, Dim: a change of more than 30 % needs the owner's yes):
`prices: [{size?, price}]` against the till's live ladder (`shopProducts()`, or the row of a
hidden own product); sizes are matched, never added or removed. A catalogue product is written
the panel's way (`sizesBody()` in `app.js`): one `price`, or the whole `sizes` ladder with its
first rung as `price`; an own product through `updateCustomProduct()` (and a price override
sitting on top of its row is dropped, as `edOwnPump()` does). More than 30 % on any rung is
refused until the same call comes back with `confirm: true`; the tool text tells Claude to ask
first. The 30 % is measured against the price before Claude's first change of the last 24 hours
(`fromPrices` on its journal line, `priceBaseline()`), so steps of −25 % cannot add up unasked
(security review, 26.10.2026); a size with no price counts as a big change. A typo net, not a lock:
the connector holds the admin's rights, and `confirm` is something the model sends. Journal + «Вернуть» like the other product writes; IndexNow.

`save_product_stock` (26.10.2026): an absolute count for one size, `count` over `was` — the
count `get_product` showed in `stock_count` (`shelfCount()`, null = never counted).
`setQty(…, { expect: was })` compares inside the locked transaction and throws
`InventoryError("stale")` when a sale or a scan moved the shelf meanwhile; the tool answers with
the count now and saves nothing. Ledger row `adjust`, ref «Claude», actor `claude`; journal line
`stock.set` with `via: "claude"` (no «Вернуть» — a count is put right by counting again).
0 → more fires the back-in-stock letters, as every count does.

`create_product` (26.10.2026): an own product, created **hidden** (`createCustomProduct(…, {
active: false })` — never live for a moment). Name rules as `save_product_name`, prices through
`cleanCustomProductInput()` (1–500 €), an optional description checked as
`save_product_description`'s (`descriptionTexts()`). Refused when the owner already has a product
with that brand and name, or the shop sells one — Claude may call twice for one request; a
deliberate second entry is made in the panel. Journal line `product.create` with `via: "claude"`,
«Новый товар от Claude — скрыт». Photos and «Показывать в магазине» stay in the panel.

**Adding it in Claude Code** (for testing): `claude mcp add --transport http rempire https://rempireshop.com/api/mcp`,
then `/mcp` → authenticate; loopback callbacks are accepted on any port.
