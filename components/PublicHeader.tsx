import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import "@/app/design-concept/style.css";

export default function PublicHeader() {
  return <header className="rar-concept-header rar-public-header">
    <Link className="rar-concept-logo" href="/" aria-label="RAR Index home"><b>R</b><span>RAR</span><small>INDEX</small></Link>
    <nav aria-label="Main navigation">
      <Link href="/browse">Discover</Link>
      <Link href="/browse?evidence=verified-sales">With sale prices</Link>
      <Link href="/collection">Collections</Link>
      <Link href="/collectors">Collectors</Link>
      <Link href="/buy-manga">Buy manga</Link>
      <Link className="rar-public-header-secondary" href="/request-edition">Request a manga</Link>
      <ThemeToggle />
    </nav>
    <Link className="rar-concept-header-cta" href="/portfolio">Your shelf <span>↗</span></Link>
  </header>;
}
