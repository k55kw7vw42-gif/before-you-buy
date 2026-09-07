"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile primary navigation. Desktop keeps SiteHeader's text nav; below 720px
 * (see globals.css) this takes over and SiteHeader hides the links it covers.
 *
 * Auth is not checked here - /history and /account already redirect a signed-
 * out visitor to /login themselves, so this stays a plain, server-data-free
 * client component.
 */

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1v-9"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4H5a1 1 0 0 0-1 1v2M17 4h2a1 1 0 0 1 1 1v2M7 20H5a1 1 0 0 1-1-1v-2M17 20h2a1 1 0 0 0 1-1v-2M8 12h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12a9 9 0 1 0 3-6.7"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.7}
        strokeLinecap="round"
      />
      <path d="M3 4v4h4M12 8v4.5l3 2" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} />
      <path
        d="M5 20c1.2-3.6 4-5.4 7-5.4S17.8 16.4 19 20"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/history", label: "History", icon: HistoryIcon },
  { href: "/account", label: "Profile", icon: ProfileIcon },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {(() => {
        const Icon = TABS[0].icon;
        const active = isActive(TABS[0].href);
        return (
          <Link href={TABS[0].href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <Icon active={active} />
            {TABS[0].label}
          </Link>
        );
      })()}

      <Link href="/scan" className={`fab${pathname.startsWith("/scan") ? " active" : ""}`} aria-label="Scan a screenshot">
        <span className="fab-circle">
          <ScanIcon />
        </span>
      </Link>

      {TABS.slice(1).map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <Icon active={active} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
