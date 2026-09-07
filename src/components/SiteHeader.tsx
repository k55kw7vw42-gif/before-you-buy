import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 4.5 5.6v6c0 4.7 3.2 8.4 7.5 9.9 4.3-1.5 7.5-5.2 7.5-9.9v-6L12 2.5Z"
        stroke="var(--brand)"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="m8.8 12.1 2.2 2.2 4.2-4.4"
        stroke="var(--brand)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/">
          <ShieldIcon />
          Before You Pay
        </Link>
        <nav className="site-nav">
          {/* Covered by the bottom nav on mobile (see globals.css); kept for desktop. */}
          <span className="site-nav-primary">
            <Link href="/scan">Scan screenshot</Link>
            {user && (
              <>
                <Link href="/history">History</Link>
                <Link href="/account">Plan</Link>
              </>
            )}
          </span>
          <Link href="/link">Check a link</Link>
          <Link href="/pricing">Pricing</Link>
          {user ? (
            <>
              <span className="user-email" title={user.email}>
                {user.email}
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
