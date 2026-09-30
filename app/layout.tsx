import type { Metadata, Viewport } from "next";
import { Geist, Newsreader } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  fallback: ["Inter", "system-ui", "sans-serif"],
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-wordmark",
});

export const metadata: Metadata = {
  title: "Project Vayuchakra",
  description: "What the air is doing near you in Delhi NCR, with photo reports checked by Gemini.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f5f2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  );
}
