import Link from "next/link";

// Small footer on every page, so the About, Privacy and Terms pages are
// always one click away.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="About RAR Index">
        <Link href="/about">About</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
      <p>RAR Index is independent and is not affiliated with eBay or any publisher.</p>
    </footer>
  );
}
