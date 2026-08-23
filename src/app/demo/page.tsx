import type { Metadata } from "next";
import DemoHub from "@/components/DemoHub";

export const metadata: Metadata = {
  title: "Новый REMPIRE — что уже готово",
  description:
    "8 вариантов дизайна, живой логотип, видео в главном экране и сколько это будет стоить. Смотри и оставляй комментарии.",
  openGraph: {
    type: "website",
    siteName: "REMPIRE",
    locale: "ru_RU",
    url: "/demo/",
    title: "Новый REMPIRE — что уже готово",
    description: "8 вариантов дизайна · живой логотип · комментируй прямо на странице",
    images: [
      {
        url: "/og-demo.png",
        width: 1200,
        height: 630,
        alt: "REMPIRE — новый магазин, первый показ",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Новый REMPIRE — что уже готово",
    description: "8 вариантов дизайна · живой логотип · комментируй прямо на странице",
    images: ["/og-demo.png"],
  },
};

export default function DemoPage() {
  return <DemoHub />;
}
