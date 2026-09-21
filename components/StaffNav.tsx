import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

type NavLink = { href: string; label: string };
type NavGroup = { label: string; links: NavLink[] };

const PRIMARY_LINKS: NavLink[] = [
  { href: "/review", label: "Decisions" },
  { href: "/add-sale", label: "Sales" },
  { href: "/catalogue-review", label: "Catalogue" },
];

const MORE_GROUPS: NavGroup[] = [
  {
    label: "Sales tools",
    links: [
      { href: "/scout", label: "Live listing Scout" },
      { href: "/listing-outcomes", label: "Listing outcomes" },
      { href: "/price-import", label: "Price batch import" },
      { href: "/collection-profiles", label: "Search profiles" },
    ],
  },
  {
    label: "Catalogue tools",
    links: [
      { href: "/discovery-backlog", label: "Discovery backlog" },
      { href: "/cover-review", label: "Cover images" },
      { href: "/catalogue-requests", label: "Edition requests" },
    ],
  },
  {
    label: "System and monitoring",
    links: [
      { href: "/agents", label: "Agent control room" },
      { href: "/agent-learning", label: "Agent reliability" },
      { href: "/community-reports", label: "Community reports" },
      { href: "/homepage-spotlight", label: "Homepage spotlight" },
      { href: "/coverage-dashboard", label: "Catalogue coverage" },
      { href: "/data-readiness", label: "Data readiness" },
    ],
  },
];

export default function StaffNav({ current }: { current: string }) {
  return (
    <nav className="staff-workspace-nav" aria-label="Staff workspace">
      <div className="staff-primary-links">
        {PRIMARY_LINKS.map((link) => (
          <Link
            aria-current={link.href === current ? "page" : undefined}
            className={link.href === current ? "is-current" : ""}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <details className="staff-nav-menu">
        <summary>Advanced</summary>
        <div className="staff-nav-panel">
          {MORE_GROUPS.map((group) => (
            <div className="staff-nav-group" key={group.label}>
              <span className="staff-nav-group-label">{group.label}</span>
              {group.links.map((link) => (
                <Link
                  aria-current={link.href === current ? "page" : undefined}
                  className={link.href === current ? "is-current" : ""}
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </details>
      <ThemeToggle />
    </nav>
  );
}
