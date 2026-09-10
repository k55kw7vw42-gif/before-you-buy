import Link from "next/link";

/** Entry point into the Deal Protection flow, from a scan result. */
export function DealButton() {
  return (
    <Link href="/deal/create" className="btn btn-secondary">
      Protect this deal (3% fee)
    </Link>
  );
}
