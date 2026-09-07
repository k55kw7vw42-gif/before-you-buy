import Link from "next/link";

export function Footer() {
  return (
    <footer style={{
      marginTop: "40px",
      padding: "20px",
      textAlign: "center",
      fontSize: "14px",
      color: "#888"
    }}>
      <Link href="/privacy">Privacy</Link>
      {" • "}
      <Link href="/terms">Terms</Link>
    </footer>
  );
}
