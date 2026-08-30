/**
 * «Сколько это будет стоить» — левая колонка теперь по настоящим счетам
 * Рената (смотрели вместе 30.08.2026): Shopify Basic годовой 24 €/мес,
 * Parcely.app 17 €, ставка Shopify Payments 1,9 % + 0,25 €. Прежняя оценка
 * 130–200 €/мес была консервативной и завышала фикс — его реальный фикс
 * ~41 €/мес, почти всё остальное — комиссии с оборота. Оборот всё ещё
 * допущение (~4 000 €/мес), Ренат его не подтвердил.
 */

const NOW = [
  { name: "Подписка Shopify (Basic, оплачен год)", cost: "24 €" },
  { name: "Parcely.app — наклейки доставки", cost: "17 €" },
  { name: "Комиссии Shopify Payments (1,9 % + 0,25 €)", cost: "≈ 90–105 €" },
];

const NEW = [
  { name: "Сайт (хостинг)", cost: "0–17 €" },
  { name: "Сервер и база данных", cost: "≈ 5–9 €" },
  { name: "Наклейки и пакоматы — встроено", cost: "0 €" },
  { name: "Хранение фото и видео", cost: "0 €" },
  { name: "Письма клиентам (до 100 в день)", cost: "0 €" },
  { name: "AI-помощник в админке", cost: "≈ 2–8 €" },
  { name: "Montonio: абонплата + комиссии", cost: "≈ 25–85 €" },
];

export default function SavingsSection() {
  return (
    <section data-fb="Стоимость" className="border-t-2 border-ink pt-5">
      <p className="text-xs uppercase tracking-[0.3em] text-fog">Деньги</p>
      <h2 className="mt-2 font-display text-2xl font-bold uppercase tracking-[0.12em]">
        Сколько это будет стоить
      </h2>
      <p className="mt-4 leading-relaxed">
        Левая колонка — по твоим счетам, смотрели вместе 30 августа. Комиссии
        посчитаны от оборота около 4 000 € в месяц — эту цифру ещё сверим.
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
            ≈ 130–145 € / мес
          </p>
          <p className="mt-1 text-xs text-fog">
            Из них фикс — всего ~41 €. Почти всё остальное — процент с продаж.
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
            ≈ 35–120 € / мес
          </p>
          <p className="mt-1 text-xs text-paper/70">
            35 € — если большинство платит банковской ссылкой; 120 € — если
            всё останется на картах, как сейчас.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3 leading-relaxed">
        <p>
          Подписка у тебя и так небольшая — экономить там почти нечего. Деньги
          уходят в <strong>процент с каждой продажи</strong>: при обороте
          4 000 € карты съедают около сотни евро в месяц, и эта строка растёт
          вместе с продажами.
        </p>
        <p>
          Дешёвый способ оплаты в Эстонии — банковская ссылка (Swedbank, SEB,
          LHV…): фиксированные центы вместо процента с суммы. Но внутри
          Shopify она невыгодна: за любой платёж «не через них» Shopify
          добавляет <strong>+2 % сверху</strong>, и вся экономия исчезает. В
          новом магазине этой надбавки нет — чем больше клиентов платят через
          банк, тем больше остаётся тебе.
        </p>
        <p>
          Parcely за наклейки тоже уходит: доставка, пакоматы и наклейки —
          часть самого магазина, а не отдельная подписка.
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
