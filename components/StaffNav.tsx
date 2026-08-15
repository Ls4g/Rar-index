import Link from "next/link";

type NavLink = { href: string; label: string };
type NavGroup = { label: string; links: NavLink[] };

const PRIMARY_LINKS: NavLink[] = [
  { href: "/review", label: "Review" },
  { href: "/scout", label: "Scout" },
  { href: "/add-sale", label: "Add sale" },
  { href: "/agents", label: "Agents" },
];

const MORE_GROUPS: NavGroup[] = [
  {
    label: "Add and collect data",
    links: [
      { href: "/price-import", label: "Price batch import" },
      { href: "/catalogue-import", label: "Catalogue import" },
      { href: "/collection-profiles", label: "Search profiles" },
    ],
  },
  {
    label: "Review queues",
    links: [
      { href: "/catalogue-review", label: "Catalogue candidates" },
      { href: "/cover-review", label: "Cover images" },
      { href: "/catalogue-requests", label: "Edition requests" },
      { href: "/community-reports", label: "Community reports" },
    ],
  },
  {
    label: "Monitor RAR",
    links: [
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
        <summary>More</summary>
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
    </nav>
  );
}
