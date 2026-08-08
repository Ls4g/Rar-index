import Link from "next/link";

type NavLink = { href: string; label: string };
type NavGroup = { label: string; links: NavLink[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Evidence & pricing",
    links: [
      { href: "/review", label: "Review queue" },
      { href: "/scout", label: "RAR Scout" },
      { href: "/collection-profiles", label: "Collection profiles" },
      { href: "/price-import", label: "Price import" },
      { href: "/add-sale", label: "Add one sale" },
    ],
  },
  {
    label: "Catalogue",
    links: [
      { href: "/catalogue-import", label: "Catalogue import" },
      { href: "/catalogue-review", label: "Catalogue review" },
      { href: "/catalogue-requests", label: "Catalogue requests" },
      { href: "/cover-review", label: "Cover review" },
    ],
  },
  {
    label: "Insight & community",
    links: [
      { href: "/coverage-dashboard", label: "Coverage dashboard" },
      { href: "/data-readiness", label: "Data readiness" },
      { href: "/community-reports", label: "Community reports" },
    ],
  },
];

// A native <details> disclosure needs no client JS: it works before
// hydration, and clicking a link inside just navigates (unmounting it),
// so there is no open state to reset.
export default function StaffNav({ current }: { current: string }) {
  return (
    <details className="staff-nav-menu">
      <summary>All staff tools</summary>
      <div className="staff-nav-panel" role="menu">
        {NAV_GROUPS.map((group) => (
          <div className="staff-nav-group" key={group.label}>
            <span className="staff-nav-group-label">{group.label}</span>
            {group.links.map((link) => (
              <Link
                aria-current={link.href === current ? "page" : undefined}
                className={link.href === current ? "is-current" : ""}
                href={link.href}
                key={link.href}
                role="menuitem"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
