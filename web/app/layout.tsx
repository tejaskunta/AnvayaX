import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";

import Shell from "@/components/Shell";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
  // Newsreader is variable-only; next/font's static size-adjust overrides
  // can't be computed for it (Failed-to-find-override-values warning).
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "AnvayaX — SIF Precursor Intelligence",
  description:
    "AI detection of Serious Injury & Fatality precursors in free-text HSSE incident reports, with a continual-learning loop.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} ${newsreader.variable} antialiased`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
