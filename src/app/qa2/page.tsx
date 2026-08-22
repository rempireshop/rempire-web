import type { Metadata } from "next";
import QaForm from "@/components/QaForm";
import { SECTIONS_ROUND2 } from "@/data/questions2";

export const metadata: Metadata = {
  title: "Ещё 7 вопросов",
  description:
    "Вторая часть вопросов про новый магазин REMPIRE. Примерно 3 минуты, ответы сохраняются автоматически.",
  openGraph: {
    type: "website",
    siteName: "REMPIRE",
    locale: "ru_RU",
    url: "/qa2/",
    title: "REMPIRE — ещё 7 вопросов",
    description: "Вторая часть · ~3 минуты · ответы сохраняются сами",
    images: [
      {
        url: "/og-qa-v2.png",
        width: 1200,
        height: 630,
        alt: "REMPIRE — вопросы перед разработкой нового магазина",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "REMPIRE — ещё 7 вопросов",
    description: "Вторая часть · ~3 минуты",
    images: ["/og-qa-v2.png"],
  },
};

export default function Qa2Page() {
  return (
    <QaForm
      sections={SECTIONS_ROUND2}
      storageKey="rempire-qa-round2"
      round="2"
      lead="Спасибо за ответы — они очень помогли. Осталось несколько уточнений: без них можно начать, но потом придётся переделывать. Это быстро."
      note="Отвечай коротко и своими словами, можно пропускать. Ответы сохраняются сами. В конце одна кнопка — и всё улетит Диме."
    />
  );
}
