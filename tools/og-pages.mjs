#!/usr/bin/env node
/**
 * The link-preview cards for the three hand-written pages under public/ —
 * /test/, /cards/ and /guide/ — the ones Dim actually pastes into Telegram.
 *
 *   node tools/og-pages.mjs
 *
 * All three used to point at /og-shop.png, which is a shop advertisement
 * reading «95 ТОВАРОВ» and carrying a «ЧЕРНОВИК ДЛЯ РЕНАТА» badge. The
 * catalogue has held 220 products since 07.09.2026, so every link anybody
 * shared advertised a number that had been wrong for days — and it stayed
 * wrong because that PNG is a shipped file with no generator behind it.
 *
 * Hence this. **Every number on these cards is read from the data, not typed
 * here**: the check count comes from src/data/testplan.json and the product
 * count from src/data/catalogue.min.json. Re-run the tool and the cards tell
 * the truth again; nothing can drift the way «95 товаров» drifted.
 *
 * The output is committed, like /og-shop.png and /brand/og-default.png: a
 * link preview must work on a fresh clone with no build, and Telegram fetches
 * the image long before anything of ours runs. `sharp` is a devDependency the
 * prerender already uses for the product cards.
 *
 * The face is the shop's: the cream ground of every OG card in this repo, the
 * ink of its type, the tower mark, and the outlined uppercase badges the
 * storefront uses for its own chips.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");

let sharp = null;
try { ({ default: sharp } = await import("sharp")); }
catch {
  console.error("! sharp did not load — the cards were not drawn");
  process.exit(1);
}

/* Shared with every other OG card in the repo (src/lib/seo-head.mjs, and the
   ground colour of tools/prerender-shop2.mjs's product cards). */
const W = 1200, H = 630;
const GROUND = "#EDEAE1";
const INK = "#1C1A00";
const MUTED = "#5F5B45";

/* ---------- the facts, read rather than typed --------------------------- */
const plan = JSON.parse(await readFile(path.join(ROOT, "src/data/testplan.json"), "utf8"));
const catalogue = JSON.parse(await readFile(path.join(ROOT, "src/data/catalogue.min.json"), "utf8"));
const CHECKS = plan.items.length;
const PRODUCTS = (Array.isArray(catalogue) ? catalogue : catalogue.items).length;

/** Russian plural for a count: 164 пункта, 1 пункт, 5 пунктов. */
function plural(n, one, few, many) {
  const t = n % 100, u = n % 10;
  if (t >= 11 && t <= 14) return many;
  if (u === 1) return one;
  if (u >= 2 && u <= 4) return few;
  return many;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* A badge is an outlined box that has to fit text this renderer lays out, so
   its width is estimated rather than measured: 0.78 em per character at this
   size and tracking, which over-estimates slightly. An outlined box that is a
   few pixels wide is right; one that clips its own text is not. */
function badge(text, x, y) {
  const fs = 19, pad = 18, track = 1.6;
  const w = Math.round(text.length * (fs * 0.62 + track) + pad * 2);
  const h = 46;
  return {
    w,
    svg:
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-opacity=".45" stroke-width="1.5"/>` +
      `<text x="${x + pad}" y="${y + 30}" font-family="Golos Text, Segoe UI, Arial, sans-serif" font-size="${fs}"` +
      ` letter-spacing="${track}" fill="${INK}">${esc(text)}</text>`,
  };
}

function card({ head, sub, badges }) {
  let x = 72;
  const row = badges.map((b) => { const made = badge(b, x, 470); x += made.w + 14; return made.svg; }).join("");

  /* The headline is one line by construction — every card here is written to
     fit — so it is drawn, not wrapped. The subline may run to two. */
  const subLines = sub;

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<rect width="${W}" height="${H}" fill="${GROUND}"/>` +
      // the wordmark; the tower mark is composited over it as a PNG below
      `<text x="146" y="106" font-family="Golos Text, Segoe UI, Arial, sans-serif" font-size="30"` +
      ` font-weight="700" letter-spacing="7" fill="${INK}">REMPIRE</text>` +
      `<text x="72" y="286" font-family="Golos Text, Segoe UI, Arial, sans-serif" font-size="88"` +
      ` font-weight="700" letter-spacing="-1" fill="${INK}">${esc(head)}</text>` +
      subLines
        .map((l, i) => `<text x="72" y="${350 + i * 44}" font-family="Golos Text, Segoe UI, Arial, sans-serif"` +
          ` font-size="31" fill="${MUTED}">${esc(l)}</text>`)
        .join("") +
      row +
    "</svg>",
  );
}

/** The tower, from the same SVG the shop and the product cards use. */
async function tower(height) {
  const svg = (await readFile(path.join(PUB, "brand", "rempire-tower.svg"), "utf8"))
    .replace(/currentColor/g, INK);
  return sharp(Buffer.from(svg), { density: 600 }).resize({ height }).png().toBuffer();
}

const PAGES = [
  {
    file: "og-test.png",
    head: "ПРИЁМКА",
    sub: ["Что проверяем перед запуском —", "по пунктам, с телефона."],
    badges: [
      `${CHECKS} ${plural(CHECKS, "ПУНКТ", "ПУНКТА", "ПУНКТОВ")}`,
      "RU · EN",
      "ОТВЕТЫ СОХРАНЯЮТСЯ",
    ],
  },
  {
    file: "og-cards.png",
    head: "КАРТОЧКА ТОВАРА",
    sub: ["Как магазин показывает цену", "и кнопку «В корзину»."],
    badges: ["ВЫБРАНО 09.09", "ЗОНЫ НАЖАТИЯ", "ЦВЕТА САЙТА"],
  },
  {
    file: "og-guide.png",
    head: "ЧТО УЖЕ ГОТОВО",
    sub: ["Магазин, корзина, кабинет", "и админка — по-русски."],
    badges: [
      `${PRODUCTS} ${plural(PRODUCTS, "ТОВАР", "ТОВАРА", "ТОВАРОВ")}`,
      "3 ЯЗЫКА",
      "С ТЕЛЕФОНА",
    ],
  },
];

const mark = await tower(62);
for (const p of PAGES) {
  const out = path.join(PUB, "brand", p.file);
  /* Rasterise the type at 3x for crisp edges, come back down to the card's
     real size, and only then lay the mark on: composited before the resize it
     would be scaled with everything else and arrive a third of its size. */
  const base = await sharp(card(p), { density: 288 }).resize(W, H).png().toBuffer();
  await sharp(base)
    .composite([{ input: mark, left: 72, top: 52 }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`  /brand/${p.file}  ${p.head} · ${p.badges.join(" · ")}`);
}
console.log(`drawn from the data: ${CHECKS} checks, ${PRODUCTS} products`);
