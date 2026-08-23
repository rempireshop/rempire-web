/**
 * «Сколько это будет стоить» — цифры из исследования тарифов 22.08.2026
 * (rempire-api/docs/COST-COMPARISON.md, все источники там). Числа
 * консервативные; точная текущая цифра зависит от плана Shopify Рената.
 */

const NOW = [
  { name: "Подписка Shopify (план Basic)", cost: "24–32 €" },
  { name: "Приложение для 3 языков", cost: "10–29 €" },
  { name: "Другие приложения (SEO, отзывы…)", cost: "0–46 €" },
  { name: "Комиссии за оплату картой", cost: "≈ 96–100 €" },
];

const NEW = [
  { name: "Сайт (хостинг)", cost: "0–17 €" },
  { name: "Сервер и база данных", cost: "≈ 5–9 €" },
  { name: "Хранение фото и видео", cost: "0 €" },
  { name: "Письма клиентам (до 100 в день)", cost: "0 €" },
  { name: "AI-помощник в админке", cost: "≈ 2–8 €" },
  { name: "Montonio: абонплата + комиссии", cost: "≈ 50–85 €" },
];

export default function SavingsSection() {
  return (
    <section data-fb="Стоимость" className="border-t-2 border-ink pt-5">
      <p className="text-xs uppercase tracking-[0.3em] text-fog">Деньги</p>
      <h2 className="mt-2 font-display text-2xl font-bold uppercase tracking-[0.12em]">
        Сколько это будет стоить
      </h2>
      <p className="mt-4 leading-relaxed">
        Считали по действующим тарифам, при обороте интернет-магазина около
        4 000 € в месяц. Точную текущую цифру сверим по твоему счёту Shopify.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="border-2 border-ink p-4">
          <p className="font-display text-sm font-bold uppercase tracking-[0.15em]">
            Сейчас — Shopify
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {NOW.map((r) => (
              <li key={r.name} className="flex justify-between gap-3">
                <span>{r.name}</span>
                <span className="whitespace-nowrap tabular-nums">{r.cost}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-mist pt-3 font-display text-lg font-bold">
            ≈ 130–200 € / мес
          </p>
        </div>

        <div className="border-2 border-ink bg-ink p-4 text-paper">
          <p className="font-display text-sm font-bold uppercase tracking-[0.15em]">
            Новый магазин
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {NEW.map((r) => (
              <li key={r.name} className="flex justify-between gap-3">
                <span>{r.name}</span>
                <span className="whitespace-nowrap tabular-nums">{r.cost}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-paper/25 pt-3 font-display text-lg font-bold">
            ≈ 60–110 € / мес
          </p>
          <p className="mt-1 text-xs text-paper/70">
            60 € — если большинство платит банковской ссылкой; 110 € — если
            в основном картами.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3 leading-relaxed">
        <p>
          Экономия — от <strong>~30 до ~140 € в месяц</strong>, и главный
          рычаг — именно банковские ссылки: каждая оплата через банк вместо
          карты почти бесплатна. Хостинг сайта может быть вообще бесплатным
          (Cloudflare) — 17 € появляются, только если остаёмся на Vercel, чей
          бесплатный план запрещает коммерцию.
        </p>
        <p>
          Но главное не это. В Shopify за каждую оплату «не через них» берут{" "}
          <strong>+2% сверху</strong> — поэтому дешёвые банковские ссылки
          (Swedbank, SEB, LHV…) там невыгодны. В новом магазине этой надбавки
          нет: банковская ссылка стоит копейки, и чем больше клиентов платят
          через банк, тем больше остаётся тебе.
        </p>
        <p className="text-fog">
          Честно: сама разработка — отдельные деньги (варианты обсудим, ты
          просил показать). А выгода, которую не посчитать в евро — магазин,
          который ты сможешь менять сам, помощник в админке и рост в Google:
          именно то, что ты назвал главной целью.
        </p>
      </div>
    </section>
  );
}
