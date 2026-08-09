import type { Metadata } from "next";
import { Instrument_Sans, Space_Grotesk } from "next/font/google";

import "./globals.css";

// Tipografi TERKUNCI (architecture.md, "Gerak & visual"): display Space Grotesk,
// body Instrument Sans. Keduanya variable dan open; tidak ada default terlarang.
const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VARUNA",
  description: "Fusi SAR dan AIS menjadi berkas bukti maritim dengan status yang dihitung server.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
