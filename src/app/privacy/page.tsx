export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <div className="stack">
      <h1>Privacy Policy</h1>

      <p>
        Before You Pay respects your privacy. We only collect the minimum data required to provide scam detection services.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Email address (for accounts)</li>
        <li>Uploaded screenshots and links</li>
      </ul>

      <h2>How we use data</h2>
      <ul>
        <li>To analyze potential scams</li>
        <li>To improve the service</li>
      </ul>

      <h2>We do NOT</h2>
      <ul>
        <li>Sell your data</li>
        <li>Share personal information</li>
      </ul>

      <h2>Disclaimer</h2>
      <p>
        Results are guidance only and not a guarantee.
      </p>
    </div>
  );
}
