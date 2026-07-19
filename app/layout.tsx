import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import "./globals.css";

/**
 * One superfamily, three registers — each mapped to a layer of the system.
 *
 *   Mono  → the machine layer: rule IDs, docket numbers, timings, evidence
 *   Sans  → console chrome: labels, controls, navigation
 *   Serif → the human artifact: the letter the customer actually receives
 *
 * IBM Plex was drawn for an institutional, technical voice, which is the
 * register a claims adjudicator writes in. The three-way split isn't
 * decoration: you can tell what kind of thing you're reading by its face.
 */

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const serif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClaimLens — evidence in, adjudication out",
  description:
    "Photo-first claims resolution. A vision model reports what it sees; a deterministic policy engine decides the outcome. The model never controls the money.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080B0F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
