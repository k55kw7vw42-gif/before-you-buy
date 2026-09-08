"use client";

import Link from "next/link";
import { useRef } from "react";
import type { ReactNode } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * The app's primary "start using it for free" call to action. Wrapped in its
 * own small client component only so it can carry an onClick handler - the
 * page that renders it stays a Server Component (an onClick can't be passed
 * to a Link from a Server Component's own JSX).
 *
 * Guards against firing the event twice for one click (e.g. a fast double
 * click before the route change takes effect) with a one-shot ref.
 */
export function TryFreeCta({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const fired = useRef(false);

  function handleClick() {
    if (fired.current) return;
    fired.current = true;
    trackEvent("try_free_clicked", {
      event_category: "engagement",
      event_label: "try_free_button",
    });
  }

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}
