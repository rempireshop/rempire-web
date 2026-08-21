import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://rempireshop.diipsolutions.eu"),
  title: {
    default: "REMPIRE",
    template: "%s — REMPIRE",
  },
  description: "REMPIRE — новый интернет-магазин.",
  // Staging must never enter search indexes (see also vercel.json X-Robots-Tag
  // and public/robots.txt). Lifted deliberately at production launch only.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
