import Link from "next/link";

export default function PublicHeader() {
  return (
    <>
      <header className="site-header public-site-header">
        <Link className="brand" href="/" aria-label="RAR Index home">
          <span>RAR</span><em>Index</em><small>For manga collectors</small>
        </Link>
        <nav className="header-links public-header-nav" aria-label="Main navigation">
          <Link className="header-note" href="/browse">Discover</Link>
          <Link className="header-note" href="/collection">Collections</Link>
          <Link className="header-note" href="/request-edition">Community</Link>
          <Link className="header-note" href="/#about">About</Link>
          <Link className="header-note public-header-staff" href="/staff-login">Staff access</Link>
          <Link className="header-search-link" href="/browse" aria-label="Search the manga catalogue">⌕</Link>
          <Link className="header-shelf-link public-header-collection" href="/portfolio">Your collection <span>→</span></Link>
        </nav>
      </header>
      <nav className="public-mobile-utility" aria-label="Quick links">
        <Link href="/browse">Browse manga</Link>
        <Link href="/identify">First-print check</Link>
        <Link href="/staff-login">Staff access</Link>
      </nav>
    </>
  );
}
