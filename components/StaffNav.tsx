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
    label: "Operations",
    links: [
      { href: "/scout", label: "Live listing Scout" },
      { href: "/graded-revisit", label: "Graded copies to revisit" },
      { href: "/agents", label: "Agent runs and health" },
    ],
  },
  {
    label: "Other work",
    links: [
      { href: "/community-reports", label: "Community reports" },
      { href: "/homepage-spotlight", label: "Homepage spotlight" },
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
