import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

import Shell from "@/components/Shell";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
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
      <body className={`${archivo.variable} ${plexMono.variable} antialiased`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
