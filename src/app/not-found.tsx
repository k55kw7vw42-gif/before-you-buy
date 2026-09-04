import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty" style={{ marginTop: "3rem" }}>
      <h1 style={{ fontSize: "1.5rem" }}>We could not find that page</h1>
      <p style={{ marginBottom: "1.25rem" }}>
        The scan you are looking for does not exist, or it belongs to a different account.
      </p>
      <Link className="btn btn-primary" href="/">
        Back to home
      </Link>
    </div>
  );
}
