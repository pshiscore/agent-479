import type { Metadata } from "next";
import { Anton, Archivo, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Headings (bold, condensed-feeling) and the logo's digits (Anton, as in the icon).
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], weight: ["700", "800"] });
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: { default: "479 Guide", template: "%s | 479 Guide" },
  description: "Things to do in Northwest Arkansas: Bentonville, Rogers, Springdale, Fayetteville, and Bella Vista.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} ${anton.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
