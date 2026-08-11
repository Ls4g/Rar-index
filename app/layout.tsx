import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "RAR Index — What's your manga actually worth?",
  description: "Real completed sale prices for specific manga editions, plus first-print checks — so you know what your copies are worth and which printing you own.",
};

// Sets data-theme on <html> before first paint so the visitor's saved (or
// system) preference renders immediately, with no flash of the other theme.
// Kept as a literal string (see lib/theme.ts) because it runs before any JS
// bundle loads, so it cannot import the shared constant.
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k="rar-theme";var t=localStorage.getItem(k);if(t!=="day"&&t!=="night"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"day":"night";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","night");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
