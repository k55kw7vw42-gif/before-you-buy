import { LinkChecker } from "@/components/LinkChecker";

export const metadata = { title: "Check a link - Before You Pay" };

export default function LinkPage() {
  return (
    <div className="stack">
      <div>
        <h1>Check a link</h1>
        <p className="muted">
          Paste a link someone sent you. We look at how the address is built - we never open it -
          and flag characteristics that often appear in scam links.
        </p>
      </div>
      <LinkChecker />
    </div>
  );
}
