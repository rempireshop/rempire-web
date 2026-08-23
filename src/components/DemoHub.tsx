"use client";

import { useRef, useState } from "react";
import TowerAnimated, {
  type TowerAnimatedHandle,
} from "@/components/TowerAnimated";
import FeedbackFab from "@/components/FeedbackFab";
import SavingsSection from "@/components/SavingsSection";

/**
 * Обзорная страница для Рената: что уже готово по новому магазину.
 * Каждая секция несёт data-fb — метка для комментариев через FeedbackFab.
 */

const OWNER_VIDEOS = [1, 2, 3, 4].map((n) => ({
  src: `/prototypes/media/owner-${n}.mp4`,
  poster: `/prototypes/media/owner-${n}-poster.jpg`,
}));

function Card({
  eyebrow,
  title,
  children,
  href,
  cta,
  fb,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  href?: string;
  cta?: string;
  fb: string;
}) {
  return (
    <section data-fb={fb} className="border-t-2 border-ink pt-5">
      <p className="text-xs uppercase tracking-[0.3em] text-fog">{eyebrow}</p>
      <h2 className="mt-2 font-display text-2xl font-bold uppercase tracking-[0.12em]">
        {title}
      </h2>
      <div className="mt-4 space-y-3 text-base leading-relaxed">{children}</div>
      {href && cta && (
        <a
          href={href}
          className="mt-5 inline-block min-h-12 rounded bg-ink px-6 py-3 font-display text-base font-bold uppercase tracking-[0.15em] text-paper transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {cta}
        </a>
      )}
    </section>
  );
}

export default function DemoHub() {
  const towerRef = useRef<TowerAnimatedHandle>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  // герой: ролики Рената из Instagram по кругу, как в направлении З
  const [heroIdx, setHeroIdx] = useState(0);
  const heroRef = useRef<HTMLVideoElement | null>(null);

  const toggleVideo = (i: number) => {
    videoRefs.current.forEach((v, j) => {
      if (!v) return;
      if (j === i) {
        if (v.paused) {
          v.muted = false;
          void v.play();
          setPlaying(i);
        } else {
          v.pause();
          setPlaying(null);
        }
      } else {
        v.pause();
        v.currentTime = 0;
      }
    });
  };

  return (
    <div className="min-h-svh">
      {/* hero: их собственное видео */}
      <section data-fb="Видео-обложка" className="relative overflow-hidden bg-ink">
        <video
          ref={heroRef}
          key={heroIdx}
          className="h-[52svh] max-h-[440px] w-full object-cover opacity-80 [filter:grayscale(1)_contrast(1.05)] motion-reduce:hidden"
          src={OWNER_VIDEOS[heroIdx].src}
          poster={OWNER_VIDEOS[heroIdx].poster}
          autoPlay
          muted
          playsInline
          onEnded={() => setHeroIdx((i) => (i + 1) % OWNER_VIDEOS.length)}
        />
        <img
          src={OWNER_VIDEOS[0].poster}
          alt=""
          className="hidden h-[52svh] max-h-[440px] w-full object-cover opacity-80 [filter:grayscale(1)] motion-reduce:block"
        />
        <div className="absolute inset-0 flex flex-col items-start justify-end p-6 sm:p-10">
          <div className="flex items-center gap-4">
            <TowerAnimated
              ref={towerRef}
              variant="reveal"
              reveal="draw"
              identOnClick
              className="h-16 w-auto text-paper sm:h-20"
              title="REMPIRE"
            />
            <div>
              <h1 className="font-display text-3xl font-bold uppercase tracking-[0.18em] text-paper sm:text-4xl">
                Rempire
              </h1>
              <p className="mt-1 text-xs uppercase tracking-[0.3em] text-paper/70">
                Новый магазин — первый показ
              </p>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-2xl space-y-14 px-5 pb-28 pt-10">
        <section data-fb="Вступление">
          <p className="text-lg leading-relaxed">
            Это твоё видео из Instagram — прямо в шапке сайта. Ниже всё, что
            уже готово посмотреть: восемь вариантов дизайна, живой логотип и
            расчёт, сколько будет стоить магазин без Shopify.
          </p>
          <p className="mt-3 leading-relaxed text-fog">
            В углу каждой страницы есть кнопка 💬 — нажми, напиши что нравится
            и что поменять, и комментарий сразу прилетит Диме. Можно тыкнуть в
            конкретное место на странице.
          </p>
        </section>

        <Card
          eyebrow="Главное"
          title="8 вариантов дизайна"
          href="/prototypes/directions.html"
          cta="Открыть варианты"
          fb="8 вариантов дизайна"
        >
          <p>
            Все страницы будущего магазина — главная, каталог, товар, корзина,
            оформление, поиск, блог, кабинет и админка — в восьми вариантах
            оформления, от самого спокойного до варианта с твоими видео на
            главном экране.
          </p>
          <p className="text-fog">
            Сверху кнопки А–З переключают вариант, «Телефон / Компьютер»
            показывает как это выглядит на разных экранах, вкладки — разные
            страницы. Нам больше всего нравится{" "}
            <strong className="text-ink">З — с твоими видео на главной</strong>
            ; более спокойная альтернатива — Ж. Но выбор за тобой.
          </p>
        </Card>

        <Card
          eyebrow="Бренд"
          title="Живой логотип"
          href="/prototypes/motion/"
          cta="Все варианты движения"
          fb="Живой логотип"
        >
          <p>
            Башня умеет двигаться: рисуется линией при открытии сайта, изредка
            «моргает» зубцами и отвечает на нажатие.{" "}
            <button
              type="button"
              onClick={() => towerRef.current?.ident()}
              className="underline underline-offset-4 hover:text-fog"
            >
              Нажми сюда
            </button>{" "}
            — башня наверху повернёт зубцы.
          </p>
          <p className="text-fog">
            Движение всегда короткое и никогда не мешает покупать. На
            странице по кнопке ниже — все варианты, из которых можно выбрать.
          </p>
        </Card>

        <Card
          eyebrow="Для покупателей"
          title="Личный кабинет"
          href="/prototypes/directions.html#kabinet"
          cta="Открыть кабинет"
          fb="Личный кабинет"
        >
          <p>
            Вход без пароля: клиент вводит e-mail и получает код — забытых
            паролей больше не существует. Внутри: свои данные, заказы с
            кнопкой «Повторить», любимый постамат по умолчанию — и личные
            промокоды. Например, за три дня до дня рождения клиент сам
            получает письмо с кодом на −10%.
          </p>
          <p className="text-fog">
            Кнопка ниже откроет кабинет — нажми там «ПОЛУЧИТЬ КОД», и
            увидишь его изнутри. Покупать без аккаунта тоже можно: гостевые
            заказы никуда не деваются.
          </p>
        </Card>

        <section data-fb="Видео из Instagram" className="border-t-2 border-ink pt-5">
          <p className="text-xs uppercase tracking-[0.3em] text-fog">Контент</p>
          <h2 className="mt-2 font-display text-2xl font-bold uppercase tracking-[0.12em]">
            Твои видео работают на магазин
          </h2>
          <p className="mt-4 leading-relaxed">
            Ролики из Instagram выглядят отлично — и в варианте{" "}
            <strong>З</strong> они крутятся прямо на главной. Нажми на любое,
            чтобы посмотреть со звуком.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {OWNER_VIDEOS.map((v, i) => (
              <button
                key={v.src}
                type="button"
                onClick={() => toggleVideo(i)}
                aria-label={playing === i ? "Пауза" : "Смотреть видео"}
                className="group relative aspect-[9/16] overflow-hidden rounded border-2 border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  src={v.src}
                  poster={v.poster}
                  preload="none"
                  playsInline
                  loop
                  className="h-full w-full object-cover"
                  onPause={() => playing === i && setPlaying(null)}
                />
                {playing !== i && (
                  <span className="absolute inset-0 flex items-center justify-center bg-ink/25 font-display text-3xl text-paper transition-colors group-hover:bg-ink/10">
                    ▶
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>

        <SavingsSection />

        <Card eyebrow="Что дальше" title="Три шага до магазина" fb="Что дальше">
          <p className="text-fog">
            На все вопросы ты уже ответил — спасибо, это сильно ускорило
            работу. Дальше так:
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Ты смотришь варианты и оставляешь комментарии кнопкой 💬 — что
              нравится, что поменять — и выбираешь направление.
            </li>
            <li>
              Мы собираем выбранный вариант по-настоящему: с твоими товарами,
              оплатой банковскими ссылками и админкой с помощником.
            </li>
            <li>
              Проверяем вместе, переносим всё со Shopify — и включаем.
            </li>
          </ol>
        </Card>

        <footer className="flex items-center justify-between border-t border-mist pt-6 text-sm text-fog">
          <span>REMPIRE · новый магазин · черновик для обсуждения</span>
        </footer>
      </main>

      <FeedbackFab page="/demo" />
    </div>
  );
}
