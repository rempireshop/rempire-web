import type { Metadata } from "next";
import QaForm from "@/components/QaForm";

export const metadata: Metadata = {
  title: "Новый интернет-магазин — вопросы",
  description:
    "26 коротких вопросов про новый магазин REMPIRE. Примерно 10 минут, ответы сохраняются автоматически.",
  openGraph: {
    type: "website",
    siteName: "REMPIRE",
    locale: "ru_RU",
    url: "/qa/",
    title: "REMPIRE — новый интернет-магазин",
    description: "26 коротких вопросов · ~10 минут · ответы сохраняются сами",
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
    title: "REMPIRE — новый интернет-магазин",
    description: "26 коротких вопросов · ~10 минут",
    images: ["/og-qa-v2.png"],
  },
};

export default function QaPage() {
  return <QaForm />;
}
