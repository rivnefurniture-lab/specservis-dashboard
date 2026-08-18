import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./login.css";
import "./owner-dashboard.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://specservis-intelligence.vercel.app"),
  title: "SpecServis Intelligence · Кабінет директора",
  description: "Live-моніторинг тендерів, ринку та конкурентів ПП «Спецсервіс».",
  openGraph: {
    title: "SpecServis Intelligence",
    description: "Тендери. Ринок. Рішення.",
    locale: "uk_UA",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SpecServis Intelligence" }],
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uk"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
