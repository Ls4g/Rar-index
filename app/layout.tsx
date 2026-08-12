import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// One family across the whole site, replacing Space Grotesk over Inter.
// Archivo holds up at 12px in a dense table and still anchors a 4rem price,
// so display and interface no longer need separate faces — and its tabular
// figures are the point: prices should read as money, not as prose.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
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
  // The bootstrap script stamps data-theme on <html> before React hydrates,
  // which is the whole point of it — so the server markup deliberately does
  // not match the client on that one attribute, and React should not warn
  // about the difference it was always going to find.
  return (
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
