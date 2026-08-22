# REMPIRE Admin — pixel-exact build spec

This is a reproduction spec, not a description. Every number here is the number
actually used in the running prototype. Where a value is given, use that value —
do not round, re-scale, or "improve" it. Section 9 contains the verbatim source
of every admin file; if you copy it exactly, the result is pixel-identical.

Stack it was built on: TanStack Start v1 (file routes in `src/routes`), React 19,
Tailwind CSS v4 (CSS-first, config lives in `src/styles.css`, no
`tailwind.config.js`), lucide-react for icons. No shadcn components are used
anywhere in the admin.

---

## 1. Tokens (exact)

| Token | Value | Usage |
|---|---|---|
| `--ink` | `#1c1a00` | text, sidebar bg, buttons, 2px rules |
| `--paper` | `#fdfcf9` | page background, text on ink |
| `--shell` | `#edeae1` | draft header bar, progress track |
| `--tile` | `#ffffff` | product thumbnails only |
| `--rule` | `rgba(28, 26, 0, 0.15)` | every 1px hairline border |
| error | `#8c1a0f` | low stock, «ЖДЁТ ОПЛАТЫ», «ЧЕРНОВИК» |
| muted text | `#78745f` | `text-muted-foreground` |
| `--ease` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | all motion |

Radius is `0px` on every radius token. No shadows. No gradients. No hover
background fills anywhere in the admin except the sidebar active state.

Type:
- Display = **Oswald** 400–600, uppercase, letter-spacing `0.04em` on headings.
  Applied automatically to `h1,h2,h3,h4` and via `font-display` class.
- Body = **Golos Text** 400–600, `font-size: 14px`, `line-height: 1.5` on `body`.
- Both self-hosted from `/public/fonts/*.woff2` (cyrillic + latin faces with
  `unicode-range` split). Never load Google Fonts.

Focus ring, globally: `outline: 1px solid var(--ink); outline-offset: 3px;`

---

## 2. Admin shell geometry (`/admin` layout)

```text
┌────────────┬───────────────────────────────────────┬──────────────┐
│ SIDEBAR    │ search bar  h=~43px, 1px bottom rule  │ ASSISTANT    │
│ 240px      ├───────────────────────────────────────┤ 360px        │
│ bg = ink   │                                       │ 2px left rule│
│ text=paper │  content, padding 16px / 24px ≥768px  │ bg = paper   │
│ 100vh      │  vertical rhythm: space-y-6 (24px)    │ 100vh        │
│ sticky top │                                       │ sticky       │
└────────────┴───────────────────────────────────────┴──────────────┘
```

Breakpoint behaviour: below `lg` (1024px) the whole thing stacks — sidebar
becomes a full-width ink block on top, assistant a full-width block at the
bottom with a **2px top** ink rule instead of the 2px left rule.

Exact sidebar values:
- container: `flex shrink-0 flex-col bg-ink px-4 py-5 text-paper lg:sticky lg:top-0 lg:h-screen lg:w-[240px]`
- badge image: `BADGE_WHITE` SVG, `width={92} height={80}`, `margin-bottom: 24px`
- nav items: `<li>` list with `space-y-1` (4px), each link
  `flex min-h-[44px] items-center justify-between px-3 text-[12px] tracking-[0.12em] uppercase`
- active state: background `rgba(253,252,249,0.12)` — nothing else changes
- item count on the right: `text-[11px] opacity-60 tabular-nums`
- «НА САЙТ →» link: `mt-6 px-3 text-[11px] tracking-[0.14em] uppercase opacity-70`, hover `opacity-100`
- footer block: pushed with `mt-auto`, `border-top: 1px solid rgba(253,252,249,0.18)`, `pt-4 text-[12px] opacity-70`, two lines: `Rempire Store OÜ` / `rempiretower@gmail.com`

Search bar: `flex items-center gap-2 border-b border-[var(--rule)] px-4 py-3`,
lucide `Search` at `size={16} strokeWidth={1.5}`, input is
`w-full max-w-[420px] bg-transparent text-[13px] outline-none`, placeholder
`Заказ, товар, клиент…`, with a visually-hidden `<label>`.

Content wrapper: `p-4 md:p-6`. Every page's root is `space-y-6`.

Section order in the sidebar: Сводка (`/admin`, exact match), Заказы,
Товары, Тексты и SEO. Counts come from the data arrays' `.length`.

---

## 3. Panel primitive (used on Сводка)

```text
┌─────────────────────────────┐  1px --rule border
│ TITLE   12px / 0.14em caps  │  px-4 py-3, 1px bottom rule
├─────────────────────────────┤
│ body, p-4                   │
└─────────────────────────────┘
```

`<section className="border border-[var(--rule)]">` +
`<h2 className="border-b border-[var(--rule)] px-4 py-3 text-[12px] tracking-[0.14em]">`
+ `<div className="p-4">`. Never add a shadow or a background to a panel.

---

## 4. Сводка (`/admin/`)

Order top to bottom, no exceptions:

1. `h1` — `text-[clamp(22px,4vw,30px)]`, text «Сводка».
2. KPI grid — `grid grid-cols-2 gap-3 lg:grid-cols-4`. Each card:
   `border border-[var(--rule)] p-4`; label `text-[11px] tracking-[0.12em] text-muted-foreground uppercase`;
   value `mt-2 font-display text-[24px]`; delta `text-[12px] text-muted-foreground`.
   Four KPIs: Выручка за 30 дней `8 420 €` (+12% к июлю), Заказов `214` (+18 заказов),
   Средний чек `39,30 €` (−1,10 €), Подписчиков `1 962` (+87).
3. **The one inverted band** — `bg-ink p-5 text-paper`. Eyebrow
   `font-display text-[11px] tracking-[0.2em] uppercase opacity-70` = «ПОДСКАЗКА НЕДЕЛИ»,
   body `mt-3 max-w-[70ch] text-[14px]`, then an `AskButton`. Exactly one ink
   band per screen — this is the rule that makes the admin feel calm. Do not add
   a second one.
4. Two-column panel grid — `grid gap-4 xl:grid-cols-2` containing, in order:
   «Что ищут, но нет в наличии», «Брошенные корзины», «Лучшие и худшие товары»,
   «Доли брендов».

Row pattern inside the first two panels:
`flex flex-wrap items-center gap-3 border-b border-[var(--rule)] pb-3 text-[13px] last:border-0`,
label takes `flex-1`, number is `tabular-nums`, right-most element is an `AskButton`.

Brand share bar: track `h-[2px] w-full bg-shell`, fill `h-full bg-ink` with
`width: {share}%`. 2px, not 4px, not rounded.

---

## 5. Заказы (`/admin/orders`)

One bordered container `border border-[var(--rule)]` holding a `<ul>`; each row
`flex flex-wrap items-center gap-3 border-b border-[var(--rule)] p-3 text-[13px] last:border-0`.

Column widths, left to right, exact:

| Cell | Class |
|---|---|
| id | `w-[70px] font-display tracking-[0.06em]` |
| date | `w-[46px] text-muted-foreground` |
| customer + city/method | `min-w-[160px] flex-1`, second line `block text-[12px] text-muted-foreground` |
| status chip | `border px-2 py-1 text-[10px] tracking-[0.12em] uppercase` |
| total | `w-[70px] text-right font-display` |
| action | `AskButton` with the row's own verb |

Chip colours: `ЖДЁТ ОПЛАТЫ` → `border-[#8c1a0f] text-[#8c1a0f]`; `ДОСТАВЛЕН` →
`border-[var(--rule)] text-muted-foreground`; everything else → `border-ink text-ink`.
Chips are outline-only, never filled.

Subtitle under the h1: «Счета по оплате «по счёту» уходят на почту клиента
автоматически при оформлении.» at `text-[13px] text-muted-foreground`.

---

## 6. Товары (`/admin/products`)

Header row: `flex flex-wrap items-center justify-between gap-3` with the h1 and
an `AskButton` labelled «+ Новый товар — через ассистента». There is no
conventional "Add product" form — creation goes through the assistant.

Product row: same bordered `<ul>` pattern. Thumbnail is
`<img width={44} height={44} className="packshot h-11 w-11 bg-white object-contain">`
where `.packshot` is `mix-blend-mode: multiply` — that is what makes white
packshots sit on paper without a visible box.

Stock cell: `text-[12px] tabular-nums`, text `сайт {n} · Mardi 1 {n}`; when
`stock.site <= 3` the whole cell turns `#8c1a0f` and a second line «низкий
остаток» appears. Three per-row `AskButton`s: «AI: описание», «ET/EN», «SEO».

---

## 7. Тексты и SEO (`/admin/content`)

Intro paragraph, `max-w-[70ch] text-[13px] text-muted-foreground`: «Это обычный
текст — правьте как в блокноте. Пока не нажали «Опубликовать», изменения видите
только вы.»

Each page is a `<section className="border border-[var(--rule)]">`:
- header `flex flex-wrap items-center gap-3 border-b border-[var(--rule)] px-4 py-3`
  → `h2 flex-1 text-[12px] tracking-[0.14em]`, location `text-[12px] text-muted-foreground`,
  state chip (same chip class; `ЧЕРНОВИК` uses the error colour, `ОПУБЛИКОВАНО` uses `border-ink`)
- body `p-4` with a `textarea rows={3}` styled
  `w-full border border-[var(--rule)] p-3 text-[13px] outline-none`
- typing anywhere flips that page's state to `ЧЕРНОВИК` immediately
- buttons `mt-3 flex flex-wrap gap-2`: solid ink «ОПУБЛИКОВАТЬ»
  (`min-h-[40px] bg-ink px-4 text-[11px] tracking-[0.12em] text-paper uppercase`),
  then `AskButton`s «Перевести на ET» and «SEO».

---

## 8. Assistant dock — the part that must not be redesigned

Rules that define the interaction model:

1. It is **always visible**, docked to the right at `w-[360px]`, `border-l-2 border-ink`.
   It is not a modal, not a floating bubble, not a collapsible drawer.
2. Every action button anywhere in the admin is an `AskButton` that writes a
   pre-filled prompt into this dock. The admin has almost no direct-edit UI;
   the assistant is the verb layer.
3. The assistant **never applies anything**. It answers with a draft card:
   `Черновик · {field}` header on `bg-shell`, then `Было: {before}` in muted and
   `Станет: {after}` in ink, then a footer bar with «ОПУБЛИКОВАТЬ». After
   publishing the footer becomes `Опубликовано ✓` plus a right-aligned outlined
   «ОТМЕНИТЬ» with a lucide `Undo2` at `size={13} strokeWidth={1.5}`. Undo
   leaves «НЕ ПРИМЕНЕНО» in muted caps. Three states, no other states.
4. Owner messages are `border-l-2 border-ink pl-3`; assistant messages are plain
   `text-muted-foreground`. No bubbles, no avatars, no timestamps.

Dock structure and sizes:
- header: `border-b border-[var(--rule)] px-4 py-3`, `h2` 12px/0.14em «Ассистент»,
  subtitle `mt-1 text-[12px] text-muted-foreground` «Черновики с предпросмотром · публикуете вы»
- log: `flex-1 space-y-4 overflow-y-auto p-4`, messages at `text-[13px]`
- footer: `border-t border-[var(--rule)] p-3`; quick-action chips
  `min-h-[34px] border border-[var(--rule)] px-2 text-[11px]` in a `flex flex-wrap gap-2`;
  then a form `mt-3 flex gap-2` with input `min-h-[44px] flex-1 border border-[var(--rule)] px-3 text-[13px] outline-none`
  (placeholder «Спросите ассистента…») and a solid ink submit «ОТПРАВИТЬ» at `min-h-[44px] px-4 text-[11px]`
- `AskButton` itself: `min-h-[34px] border border-ink px-2 text-[11px] tracking-[0.1em] uppercase`,
  default label «Спросить ассистента»

Quick actions, in order: Перевести на ET · SEO для категории · Пост для
Instagram · Ответ клиенту.

Replies are matched by regex against the prompt text (`scriptedReplies` in
`src/data/admin.ts`); the last entry is a catch-all so the array must always end
with `{ match: /./ }`.

---

## 9. Verbatim source

Copy these files as-is. Paths are exact; TanStack Start derives the routes from
the filenames (`admin.tsx` is the layout, `admin.index.tsx` is `/admin`).

### `src/routes/admin.tsx`

```tsx
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { BADGE_WHITE } from "@/components/brand/TowerMark";
import { AssistantProvider } from "@/components/admin/Assistant";
import { contentPages, orders } from "@/data/admin";
import { products } from "@/data/catalog";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Панель управления — REMPIRE" },
      { name: "description", content: "Заказы, товары, тексты и ассистент магазина REMPIRE." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Панель управления — REMPIRE" },
      { property: "og:description", content: "Внутренняя панель магазина REMPIRE." },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const sections = [
    { to: "/admin", label: "Сводка", count: "" as string | number, exact: true },
    { to: "/admin/orders", label: "Заказы", count: orders.length },
    { to: "/admin/products", label: "Товары", count: products.length },
    { to: "/admin/content", label: "Тексты и SEO", count: contentPages.length },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-paper lg:flex-row">
      <nav
        aria-label="Разделы панели"
        className="flex shrink-0 flex-col bg-ink px-4 py-5 text-paper lg:sticky lg:top-0 lg:h-screen lg:w-[240px]"
      >
        <img src={BADGE_WHITE} alt="REMPIRE" width={92} height={80} className="mb-6" />
        <ul className="space-y-1">
          {sections.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                activeOptions={{ exact: s.exact ?? false }}
                activeProps={{ className: "bg-[rgba(253,252,249,0.12)]" }}
                className="flex min-h-[44px] items-center justify-between px-3 text-[12px] tracking-[0.12em] uppercase"
              >
                {s.label}
                <span className="text-[11px] opacity-60 tabular-nums">{s.count}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/" className="mt-6 px-3 text-[11px] tracking-[0.14em] uppercase opacity-70 hover:opacity-100">
          На сайт →
        </Link>
        <div className="mt-auto border-t border-[rgba(253,252,249,0.18)] pt-4 text-[12px] opacity-70">
          <p>Rempire Store OÜ</p>
          <p>rempiretower@gmail.com</p>
        </div>
      </nav>

      <AssistantProvider>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 border-b border-[var(--rule)] px-4 py-3">
            <Search size={16} strokeWidth={1.5} aria-hidden />
            <label className="sr-only" htmlFor="admin-search">
              Поиск по панели
            </label>
            <input
              id="admin-search"
              placeholder="Заказ, товар, клиент…"
              className="w-full max-w-[420px] bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="p-4 md:p-6">
            <Outlet />
          </div>
        </div>
      </AssistantProvider>
    </div>
  );
}
```

### `src/routes/admin.index.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { AskButton } from "@/components/admin/Assistant";
import {
  abandoned,
  brandShare,
  kpis,
  missedSearches,
  topProducts,
  weakProducts,
} from "@/data/admin";
import { eur } from "@/data/catalog";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Сводка — панель REMPIRE" },
      { name: "description", content: "Выручка, заказы, спрос и подсказки ассистента." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Сводка — панель REMPIRE" },
      { property: "og:description", content: "Ключевые показатели магазина REMPIRE." },
    ],
  }),
  component: Dashboard,
});

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[var(--rule)]">
      <h2 className="border-b border-[var(--rule)] px-4 py-3 text-[12px] tracking-[0.14em]">{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-[clamp(22px,4vw,30px)]">Сводка</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="border border-[var(--rule)] p-4">
            <p className="text-[11px] tracking-[0.12em] text-muted-foreground uppercase">{k.label}</p>
            <p className="mt-2 font-display text-[24px]">{k.value}</p>
            <p className="text-[12px] text-muted-foreground">{k.delta}</p>
          </div>
        ))}
      </div>

      <section className="bg-ink p-5 text-paper">
        <p className="font-display text-[11px] tracking-[0.2em] uppercase opacity-70">Подсказка недели</p>
        <p className="mt-3 max-w-[70ch] text-[14px]">
          «Davines oi масло» искали 41 раз за месяц, но такой позиции в каталоге нет. Это самый
          дорогой пропущенный спрос сейчас — могу подготовить карточку товара и текст категории.
        </p>
        <div className="mt-4">
          <AskButton
            prompt="Подготовь описание и SEO для Davines OI масло"
            label="Спросить ассистента"
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Что ищут, но нет в наличии">
          <ul className="space-y-3">
            {missedSearches.map((m) => (
              <li key={m.query} className="flex flex-wrap items-center gap-3 border-b border-[var(--rule)] pb-3 text-[13px] last:border-0">
                <span className="flex-1">{m.query}</span>
                <span className="text-muted-foreground tabular-nums">{m.count} запросов</span>
                <AskButton prompt={`Что делать с запросом «${m.query}»?`} label="Спросить" />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Брошенные корзины">
          <ul className="space-y-3">
            {abandoned.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--rule)] pb-3 text-[13px] last:border-0">
                <span className="flex-1">
                  {a.id} · {a.items}
                  <span className="block text-[12px] text-muted-foreground">{a.when}</span>
                </span>
                <span className="font-display">{eur(a.value)}</span>
                <AskButton prompt={`Напиши письмо клиенту по брошенной корзине ${a.id}`} label="Спросить" />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Лучшие и худшие товары">
          <ul className="space-y-2 text-[13px]">
            {topProducts.map((p) => (
              <li key={p.name} className="flex justify-between gap-3">
                <span>{p.name}</span>
                <span className="tabular-nums">{p.sold} шт</span>
              </li>
            ))}
            <li className="pt-2 text-[11px] tracking-[0.12em] text-muted-foreground uppercase">Отстают</li>
            {weakProducts.map((p) => (
              <li key={p.name} className="flex items-center justify-between gap-3">
                <span>{p.name}</span>
                <span className="tabular-nums text-[#8c1a0f]">{p.sold} шт</span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <AskButton prompt="Почему Clear Jelly Mask плохо продаётся и что написать в карточке?" />
          </div>
        </Panel>

        <Panel title="Доли брендов">
          <ul className="space-y-3 text-[13px]">
            {brandShare.map((b) => (
              <li key={b.brand}>
                <div className="flex justify-between">
                  <span>{b.brand}</span>
                  <span className="tabular-nums">{b.share}%</span>
                </div>
                <div className="mt-1 h-[2px] w-full bg-shell">
                  <div className="h-full bg-ink" style={{ width: `${b.share}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
```

### `src/routes/admin.orders.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { AskButton } from "@/components/admin/Assistant";
import { orders, type OrderStatus } from "@/data/admin";
import { eur } from "@/data/catalog";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({
    meta: [
      { title: "Заказы — панель REMPIRE" },
      { name: "description", content: "Список заказов, статусы, ярлыки и счета." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Заказы — панель REMPIRE" },
      { property: "og:description", content: "Управление заказами магазина REMPIRE." },
    ],
  }),
  component: OrdersPage,
});

const chip = (s: OrderStatus) =>
  s === "ЖДЁТ ОПЛАТЫ"
    ? "border-[#8c1a0f] text-[#8c1a0f]"
    : s === "ДОСТАВЛЕН"
      ? "border-[var(--rule)] text-muted-foreground"
      : "border-ink text-ink";

function OrdersPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-[clamp(22px,4vw,30px)]">Заказы</h1>
      <p className="text-[13px] text-muted-foreground">
        Счета по оплате «по счёту» уходят на почту клиента автоматически при оформлении.
      </p>

      <div className="border border-[var(--rule)]">
        <ul>
          {orders.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center gap-3 border-b border-[var(--rule)] p-3 text-[13px] last:border-0"
            >
              <span className="w-[70px] font-display tracking-[0.06em]">{o.id}</span>
              <span className="w-[46px] text-muted-foreground">{o.date}</span>
              <span className="min-w-[160px] flex-1">
                {o.customer}
                <span className="block text-[12px] text-muted-foreground">
                  {o.city} · {o.method}
                </span>
              </span>
              <span className={`border px-2 py-1 text-[10px] tracking-[0.12em] uppercase ${chip(o.status)}`}>
                {o.status}
              </span>
              <span className="w-[70px] text-right font-display">{eur(o.total)}</span>
              <AskButton prompt={`${o.action} по заказу ${o.id}`} label={o.action} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

### `src/routes/admin.products.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { AskButton } from "@/components/admin/Assistant";
import { priceLabel, products } from "@/data/catalog";

export const Route = createFileRoute("/admin/products")({
  head: () => ({
    meta: [
      { title: "Товары — панель REMPIRE" },
      { name: "description", content: "Остатки на сайте и в магазине Mardi 1, тексты и SEO по товарам." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Товары — панель REMPIRE" },
      { property: "og:description", content: "Каталог и остатки магазина REMPIRE." },
    ],
  }),
  component: ProductsAdmin,
});

function ProductsAdmin() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[clamp(22px,4vw,30px)]">Товары</h1>
        <AskButton
          prompt="Новый товар: загружу фото и название, собери карточку"
          label="+ Новый товар — через ассистента"
        />
      </div>

      <div className="border border-[var(--rule)]">
        <ul>
          {products.map((p) => {
            const low = p.stock.site <= 3;
            return (
              <li key={p.slug} className="flex flex-wrap items-center gap-3 border-b border-[var(--rule)] p-3 text-[13px] last:border-0">
                <img src={p.image} alt="" width={44} height={44} className="packshot h-11 w-11 bg-white object-contain" />
                <span className="min-w-[180px] flex-1">
                  {p.name}
                  <span className="block text-[12px] text-muted-foreground">
                    {p.brand} · {priceLabel(p)}
                  </span>
                </span>
                <span className={`text-[12px] tabular-nums ${low ? "text-[#8c1a0f]" : "text-muted-foreground"}`}>
                  сайт {p.stock.site} · Mardi 1 {p.stock.shop}
                  {low && <span className="block">низкий остаток</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  <AskButton prompt={`AI: описание для ${p.name}`} label="AI: описание" />
                  <AskButton prompt={`Перевести карточку ${p.name} на ET и EN`} label="ET/EN" />
                  <AskButton prompt={`SEO для ${p.name}`} label="SEO" />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

### `src/routes/admin.content.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AskButton } from "@/components/admin/Assistant";
import { contentPages } from "@/data/admin";

export const Route = createFileRoute("/admin/content")({
  head: () => ({
    meta: [
      { title: "Тексты и SEO — панель REMPIRE" },
      { name: "description", content: "Тексты страниц простым текстом, черновики и публикация." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Тексты и SEO — панель REMPIRE" },
      { property: "og:description", content: "Редактирование текстов магазина REMPIRE." },
    ],
  }),
  component: ContentAdmin,
});

function ContentAdmin() {
  const [state, setState] = useState(
    Object.fromEntries(contentPages.map((p) => [p.id, p.state])) as Record<string, string>,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-[clamp(22px,4vw,30px)]">Тексты и SEO</h1>
      <p className="max-w-[70ch] text-[13px] text-muted-foreground">
        Это обычный текст — правьте как в блокноте. Пока не нажали «Опубликовать», изменения
        видите только вы.
      </p>

      <div className="space-y-4">
        {contentPages.map((p) => (
          <section key={p.id} className="border border-[var(--rule)]">
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--rule)] px-4 py-3">
              <h2 className="flex-1 text-[12px] tracking-[0.14em]">{p.title}</h2>
              <span className="text-[12px] text-muted-foreground">{p.where}</span>
              <span
                className={`border px-2 py-1 text-[10px] tracking-[0.12em] uppercase ${
                  state[p.id] === "ЧЕРНОВИК" ? "border-[#8c1a0f] text-[#8c1a0f]" : "border-ink"
                }`}
              >
                {state[p.id]}
              </span>
            </div>
            <div className="p-4">
              <label className="sr-only" htmlFor={`text-${p.id}`}>
                {p.title}
              </label>
              <textarea
                id={`text-${p.id}`}
                defaultValue={p.text}
                rows={3}
                onChange={() => setState((s) => ({ ...s, [p.id]: "ЧЕРНОВИК" }))}
                className="w-full border border-[var(--rule)] p-3 text-[13px] outline-none"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setState((s) => ({ ...s, [p.id]: "ОПУБЛИКОВАНО" }))}
                  className="min-h-[40px] bg-ink px-4 text-[11px] tracking-[0.12em] text-paper uppercase"
                >
                  Опубликовать
                </button>
                <AskButton prompt={`Перевести на ET текст: ${p.title}`} label="Перевести на ET" />
                <AskButton prompt={`SEO для страницы ${p.where}`} label="SEO" />
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
```

### `src/components/admin/Assistant.tsx`

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Undo2 } from "lucide-react";
import { quickActions, scriptedReplies, type AssistantDraft } from "@/data/admin";

type Message = {
  id: number;
  role: "owner" | "assistant";
  text: string;
  draft?: AssistantDraft | undefined;
  state?: "pending" | "published" | "undone" | undefined;
};

type AssistantValue = { ask: (text: string) => void };

const Ctx = createContext<AssistantValue | null>(null);

export function useAssistant() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAssistant must be used inside AssistantProvider");
  return ctx;
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: "assistant",
      text: "Готов помочь: тексты, переводы, SEO, ответы клиентам. Любое изменение сначала покажу черновиком — без вашего подтверждения ничего не публикуется.",
    },
  ]);
  const [input, setInput] = useState("");

  const ask = useCallback((text: string) => {
    const reply = scriptedReplies.find((r) => r.match.test(text))!;
    setMessages((prev) => [
      ...prev,
      { id: prev.length, role: "owner", text },
      {
        id: prev.length + 1,
        role: "assistant",
        text: reply.text,
        draft: reply.draft,
        state: reply.draft ? "pending" : undefined,
      },
    ]);
  }, []);

  const setState = (id: number, state: Message["state"]) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state } : m)));

  const value = useMemo(() => ({ ask }), [ask]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <aside
        aria-label="Ассистент"
        className="flex w-full shrink-0 flex-col border-t-2 border-ink bg-paper lg:h-[calc(100vh-0px)] lg:w-[360px] lg:border-t-0 lg:border-l-2"
      >
        <div className="border-b border-[var(--rule)] px-4 py-3">
          <h2 className="text-[12px] tracking-[0.14em]">Ассистент</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Черновики с предпросмотром · публикуете вы
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.map((m) => (
            <div key={m.id}>
              <p
                className={`text-[13px] ${
                  m.role === "owner" ? "border-l-2 border-ink pl-3" : "text-muted-foreground"
                }`}
              >
                {m.text}
              </p>
              {m.draft && (
                <div className="mt-3 border border-[var(--rule)]">
                  <p className="border-b border-[var(--rule)] bg-shell px-3 py-2 font-display text-[11px] tracking-[0.14em] uppercase">
                    Черновик · {m.draft.field}
                  </p>
                  <div className="space-y-2 p-3 text-[12px]">
                    <p className="text-muted-foreground">Было: {m.draft.before}</p>
                    <p className="whitespace-pre-line">Станет: {m.draft.after}</p>
                  </div>
                  <div className="flex items-center gap-2 border-t border-[var(--rule)] p-2">
                    {m.state === "pending" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setState(m.id, "published")}
                          className="min-h-[36px] bg-ink px-3 text-[11px] tracking-[0.12em] text-paper uppercase"
                        >
                          Опубликовать
                        </button>
                        <button
                          type="button"
                          onClick={() => setState(m.id, "undone")}
                          className="min-h-[36px] border border-ink px-3 text-[11px] tracking-[0.12em] uppercase"
                        >
                          Отклонить
                        </button>
                      </>
                    )}
                    {m.state === "published" && (
                      <>
                        <span className="text-[11px] tracking-[0.12em] uppercase">Опубликовано ✓</span>
                        <button
                          type="button"
                          onClick={() => setState(m.id, "undone")}
                          className="ml-auto flex min-h-[36px] items-center gap-1 border border-ink px-3 text-[11px] tracking-[0.12em] uppercase"
                        >
                          <Undo2 size={13} strokeWidth={1.5} aria-hidden /> Отменить
                        </button>
                      </>
                    )}
                    {m.state === "undone" && (
                      <span className="text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                        Не применено
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--rule)] p-3">
          <div className="flex flex-wrap gap-2">
            {quickActions.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => ask(a)}
                className="min-h-[34px] border border-[var(--rule)] px-2 text-[11px]"
              >
                {a}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim()) return;
              ask(input.trim());
              setInput("");
            }}
          >
            <label className="sr-only" htmlFor="assistant-input">
              Сообщение ассистенту
            </label>
            <input
              id="assistant-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Спросите ассистента…"
              className="min-h-[44px] flex-1 border border-[var(--rule)] px-3 text-[13px] outline-none"
            />
            <button type="submit" className="min-h-[44px] bg-ink px-4 text-[11px] tracking-[0.12em] text-paper uppercase">
              Отправить
            </button>
          </form>
        </div>
      </aside>
    </Ctx.Provider>
  );
}

export function AskButton({ prompt, label = "Спросить ассистента" }: { prompt: string; label?: string }) {
  const { ask } = useAssistant();
  return (
    <button
      type="button"
      onClick={() => ask(prompt)}
      className="min-h-[34px] border border-ink px-2 text-[11px] tracking-[0.1em] uppercase"
    >
      {label}
    </button>
  );
}
```

### `src/components/brand/TowerMark.tsx`

```tsx
export const TOWER_SRC = "https://rempireshop.diipsolutions.eu/brand/rempire-tower.svg";
export const BADGE_DARK = "https://rempireshop.diipsolutions.eu/brand/rempire-badge-dark.svg";
export const BADGE_WHITE = "https://rempireshop.diipsolutions.eu/brand/rempire-badge-white.svg";
export const LOCKUP_DARK = "https://rempireshop.diipsolutions.eu/brand/rempire-lockup-dark.svg";

type Props = {
  size?: number;
  className?: string;
  sentry?: boolean;
  draw?: boolean;
  title?: string;
};

/**
 * The original tower artwork, tinted through a CSS mask.
 * The path is never redrawn, recoloured in-file, or duplicated.
 */
export function TowerMark({
  size = 34,
  className = "",
  sentry = false,
  draw = false,
  title = "REMPIRE",
}: Props) {
  return (
    <span
      role="img"
      aria-label={title}
      className={`tower-mask inline-block shrink-0 ${sentry ? "animate-sentry" : ""} ${
        draw ? "animate-draw" : ""
      } ${className}`}
      style={{
        width: size,
        height: size * (714.83 / 822.73),
        // @ts-expect-error custom property
        "--tower-src": `url(${TOWER_SRC})`,
      }}
    />
  );
}
```

### `src/data/admin.ts`

```tsx
export type OrderStatus = "ОПЛАЧЕН" | "ОТПРАВЛЕН" | "ЖДЁТ ОПЛАТЫ" | "ДОСТАВЛЕН";

export type Order = {
  id: string;
  date: string;
  customer: string;
  city: string;
  total: number;
  status: OrderStatus;
  method: string;
  action: string;
};

export const orders: Order[] = [
  { id: "R-2481", date: "22.08", customer: "Marek Tamm", city: "Tallinn · Omniva", total: 61, status: "ОПЛАЧЕН", method: "Swedbank", action: "Ярлык" },
  { id: "R-2480", date: "22.08", customer: "Анна Кузнецова", city: "Tartu · SmartPosti", total: 34, status: "ОТПРАВЛЕН", method: "Карта", action: "Где посылка" },
  { id: "R-2479", date: "21.08", customer: "Rempire Studio OÜ", city: "Tallinn · курьер", total: 218, status: "ЖДЁТ ОПЛАТЫ", method: "По счёту", action: "Напомнить о счёте" },
  { id: "R-2478", date: "21.08", customer: "Kristjan Saar", city: "Pärnu · DPD", total: 27, status: "ДОСТАВЛЕН", method: "LHV", action: "Написать клиенту" },
  { id: "R-2477", date: "20.08", customer: "Ольга Петрова", city: "Tallinn · самовывоз", total: 96, status: "ОПЛАЧЕН", method: "Apple Pay", action: "Ярлык" },
  { id: "R-2476", date: "20.08", customer: "Liis Kask", city: "Narva · Omniva", total: 42, status: "ДОСТАВЛЕН", method: "SEB", action: "Написать клиенту" },
];

export const kpis = [
  { label: "Выручка за 30 дней", value: "8 420 €", delta: "+12% к июлю" },
  { label: "Заказов", value: "214", delta: "+18 заказов" },
  { label: "Средний чек", value: "39,30 €", delta: "−1,10 €" },
  { label: "Подписчиков", value: "1 962", delta: "+87" },
];

export const missedSearches = [
  { query: "davines oi масло", count: 41 },
  { query: "kevin murphy hydrate me", count: 28 },
  { query: "триммер", count: 19 },
  { query: "подарочный сертификат", count: 14 },
];

export const abandoned = [
  { id: "C-8841", value: 74, items: "Repair-Me.Wash 250 мл, Free.Hold 100 г", when: "3 часа назад" },
  { id: "C-8837", value: 29, items: "Clear Jelly Mask", when: "вчера" },
  { id: "C-8830", value: 132, items: "System 4 курс, Touchable", when: "2 дня назад" },
];

export const topProducts = [
  { name: "Kevin.Murphy Repair-Me.Wash", sold: 62, trend: "up" as const },
  { name: "System 4 Bio Botanical Shampoo", sold: 47, trend: "up" as const },
  { name: "Kevin.Murphy Touchable", sold: 38, trend: "flat" as const },
];

export const weakProducts = [
  { name: "Paul Mitchell Clear Jelly Mask", sold: 3, trend: "down" as const },
  { name: "System 4 Bio Botanical Serum", sold: 5, trend: "down" as const },
];

export const brandShare = [
  { brand: "Kevin.Murphy", share: 44 },
  { brand: "System 4", share: 21 },
  { brand: "Davines", share: 14 },
  { brand: "Rempire Merch", share: 11 },
  { brand: "Прочее", share: 10 },
];

export type ContentPage = {
  id: string;
  title: string;
  where: string;
  state: "ОПУБЛИКОВАНО" | "ЧЕРНОВИК";
  text: string;
};

export const contentPages: ContentPage[] = [
  {
    id: "home-hero",
    title: "Главная — заголовок и подпись",
    where: "Главная страница",
    state: "ОПУБЛИКОВАНО",
    text: "Профессиональный уход для волос, бороды, лица и тела. Таллинн, с 2018 года.",
  },
  {
    id: "cat-hair",
    title: "Уход за волосами — вводный текст категории",
    where: "/catalog/hair",
    state: "ОПУБЛИКОВАНО",
    text: "Шампуни, кондиционеры и уходовые сыворотки, которыми мы работаем в салоне на Mardi 1.",
  },
  {
    id: "cat-beard",
    title: "Уход за бородой — вводный текст категории",
    where: "/catalog/beard",
    state: "ЧЕРНОВИК",
    text: "Масла, бальзамы и шампуни для бороды: смягчают жёсткий волос и снимают раздражение кожи под ним.",
  },
  {
    id: "delivery",
    title: "Доставка и возврат",
    where: "Футер и карточки товара",
    state: "ОПУБЛИКОВАНО",
    text: "DPD, Omniva, SmartPosti и курьер. Возврат в течение 14 дней, косметика — только в невскрытой упаковке.",
  },
];

export const quickActions = [
  "Перевести на ET",
  "SEO для категории",
  "Пост для Instagram",
  "Ответ клиенту",
];

export type AssistantDraft = { field: string; before: string; after: string };

export const scriptedReplies: { match: RegExp; text: string; draft?: AssistantDraft }[] = [
  {
    match: /перевести|ET|эстон/i,
    text: "Подготовил перевод вводного текста категории «Уход за волосами» на эстонский. Проверьте и опубликуйте — сам ничего не сохраняю.",
    draft: {
      field: "Категория «Уход за волосами» · ET",
      before: "— (перевода нет)",
      after:
        "Šampoonid, palsamid ja hooldusseerumid, millega töötame igapäevaselt salongis Mardi 1. Kevin.Murphy, Davines, System 4 ja Paul Mitchell.",
    },
  },
  {
    match: /SEO/i,
    text: "Черновик SEO-заголовка и описания для категории «Стайлинг». Длина в пределах 60 и 160 символов.",
    draft: {
      field: "Стайлинг · title + description",
      before: "Стайлинг — REMPIRE",
      after:
        "Стайлинг волос: пасты, воски, спреи — REMPIRE\nПасты, воски и спреи Kevin.Murphy и Paul Mitchell. Доставка по Эстонии от 50 € бесплатно, магазин на Mardi 1.",
    },
  },
  {
    match: /instagram|пост/i,
    text: "Черновик поста. Без обещаний результата и медицинских формулировок.",
    draft: {
      field: "Instagram · пост о Repair-Me.Wash",
      before: "— (черновика нет)",
      after:
        "Восстанавливающий шампунь, которым мы моем в салоне каждый день. Протеины и аминокислоты, сульфат-фри. 40 мл — попробовать, 250 мл — на курс. Mardi 1, Таллинн.",
    },
  },
  {
    match: /описан/i,
    text: "Черновик описания товара по фото и названию. Характеристики не выдумывал — уточните объём и состав.",
    draft: {
      field: "Товар · описание",
      before: "— (описания нет)",
      after:
        "Крем-паста для укладки с гибкой фиксацией. Легко распределяется, не оставляет плёнки, укладку можно поправить в течение дня.",
    },
  },
  {
    match: /.*/,
    text: "Понял. Могу подготовить черновик текста, перевод или ответ клиенту — каждое изменение покажу до публикации.",
  },
];
```

### `src/styles.css`

```tsx
@import "tailwindcss" source(none);
@source "../src";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/* Self-hosted fonts (no Google Fonts CDN — EU IP disclosure) */
@font-face {
  font-family: "Oswald";
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url("/fonts/oswald-cyrillic.woff2") format("woff2");
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
@font-face {
  font-family: "Oswald";
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url("/fonts/oswald-latin.woff2") format("woff2");
}
@font-face {
  font-family: "Golos Text";
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url("/fonts/golos-cyrillic.woff2") format("woff2");
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
@font-face {
  font-family: "Golos Text";
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url("/fonts/golos-latin.woff2") format("woff2");
}

/*
 * REMPIRE design system.
 * Ink #1c1a00 / Paper #fdfcf9 / Shell #edeae1 / Secondary #78745f / Error #8c1a0f.
 * Radius 0 everywhere, no shadows, no gradients. Rules only.
 */

@theme inline {
  --font-display: "Oswald", "Arial Narrow", sans-serif;
  --font-sans: "Golos Text", system-ui, sans-serif;

  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;
  --radius-xl: 0px;
  --radius-2xl: 0px;
  --radius-3xl: 0px;
  --radius-4xl: 0px;

  --color-ink: var(--ink);
  --color-paper: var(--paper);
  --color-shell: var(--shell);
  --color-tile: var(--tile);
  --color-rule: var(--rule);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

:root {
  --radius: 0px;
  --ink: #1c1a00;
  --paper: #fdfcf9;
  --shell: #edeae1;
  --tile: #ffffff;
  --rule: rgba(28, 26, 0, 0.15);
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);

  --background: var(--paper);
  --foreground: var(--ink);
  --card: var(--tile);
  --card-foreground: var(--ink);
  --popover: var(--paper);
  --popover-foreground: var(--ink);
  --primary: var(--ink);
  --primary-foreground: var(--paper);
  --secondary: var(--shell);
  --secondary-foreground: var(--ink);
  --muted: var(--shell);
  --muted-foreground: #78745f;
  --accent: var(--shell);
  --accent-foreground: var(--ink);
  --destructive: #8c1a0f;
  --destructive-foreground: #fdfcf9;
  --border: var(--rule);
  --input: var(--rule);
  --ring: var(--ink);
  --sidebar: var(--ink);
  --sidebar-foreground: var(--paper);
  --sidebar-primary: var(--paper);
  --sidebar-primary-foreground: var(--ink);
  --sidebar-accent: rgba(253, 252, 249, 0.08);
  --sidebar-accent-foreground: var(--paper);
  --sidebar-border: rgba(253, 252, 249, 0.18);
  --sidebar-ring: var(--paper);
}

@layer base {
  * {
    border-color: var(--rule);
  }

  html {
    -webkit-text-size-adjust: 100%;
  }

  body {
    background-color: var(--paper);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
  }

  h1,
  h2,
  h3,
  h4 {
    font-family: var(--font-display);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 1.05;
  }

  :focus-visible {
    outline: 1px solid var(--ink);
    outline-offset: 3px;
  }

  button,
  input,
  select,
  textarea {
    font-family: inherit;
  }
}

@utility display {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

@utility rule-hair {
  border-color: var(--rule);
}

@utility packshot {
  mix-blend-mode: multiply;
}

/* Brand mark: the artwork is never redrawn — the same SVG path is used as a mask. */
@utility tower-mask {
  background-color: currentColor;
  -webkit-mask-image: var(--tower-src);
  mask-image: var(--tower-src);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

@keyframes rempire-draw {
  0% {
    clip-path: inset(100% 0 0 0);
    opacity: 0.2;
  }
  70% {
    clip-path: inset(0 0 0 0);
    opacity: 1;
  }
  100% {
    clip-path: inset(0 0 0 0);
    opacity: 1;
  }
}

@keyframes rempire-sentry {
  0%,
  92%,
  100% {
    transform: translateX(0);
  }
  95% {
    transform: translateX(1px);
  }
  97% {
    transform: translateX(0);
  }
}

@keyframes rempire-fade-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.animate-draw {
  animation: rempire-draw 0.9s var(--ease) both;
}

.animate-sentry {
  animation: rempire-sentry 8s var(--ease) infinite;
}

.animate-enter {
  animation: rempire-fade-up 0.4s var(--ease) both;
}

@media (prefers-reduced-motion: reduce) {
  .animate-draw,
  .animate-sentry,
  .animate-enter {
    animation: none !important;
  }
  * {
    transition: none !important;
  }
}
```

---

## 10. Guardrails

- No rounded corners, shadows, gradients, or coloured status backgrounds.
- No card grids of KPIs with icons; no charts library — the only chart is the 2px brand-share bar.
- Do not replace the docked assistant with a floating chat bubble or modal.
- Do not add a direct product-create form; creation flows through the assistant.
- Do not swap Oswald/Golos for Inter or load fonts from a CDN.
- Keep all admin routes `robots: noindex` with their own `head()` titles.
- Minimum touch target 44px on nav/inputs, 34px on inline chips.
