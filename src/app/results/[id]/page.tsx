"use client";

import Link from "next/link";

export function ScanResult({ scan }: { scan: any }) {
  return (
    <div className="stack">

      {/* 🧠 Verdict */}
      <div className={`card risk-${scan.level}`}>
        <h2 className="text-xl font-bold">
          {scan.level === "high"
            ? "🚨 High Risk"
            : scan.level === "medium"
            ? "⚠️ Medium Risk"
            : "✅ Safe"}
        </h2>

        <p className="text-3xl font-bold mt-2">
          {scan.score}/100
        </p>

        {/* 💣 Reason */}
        <p className="mt-2 text-sm font-semibold">
          ⚠️ This result shows patterns commonly used in scams
        </p>

        {/* 🚨 Decision */}
        <div className="mt-4 bg-red-100 text-red-700 p-4 rounded-xl text-sm font-semibold">
          🚨 Do NOT enter passwords, card details, or personal info.
        </div>
      </div>

      {/* ⚠️ Warning Signs */}
      <div className="card">
        <h3 className="font-bold mb-2">⚠️ Warning signs</h3>

        <ul className="list-disc ml-5">
          {scan.signs?.map((s: string, i: number) => (
            <li key={i}>{s}</li>
          ))}
        </ul>

        {/* 🔎 Explanation */}
        <div className="mt-4 text-sm text-gray-500">
          <p className="font-semibold mb-1">🔎 We checked:</p>
          <ul className="list-disc ml-5">
            <li>Domain patterns</li>
            <li>Suspicious keywords</li>
            <li>Common scam signals</li>
          </ul>
        </div>
      </div>

      {/* 💰 Upgrade */}
      <div className="mt-6 bg-yellow-400 text-black p-4 rounded-xl text-center">
        <p className="font-bold">
          😤 Stay protected from scams like this
        </p>
        <p className="text-sm mt-1">
          Upgrade to Pro for more scans & no ads
        </p>

        <Link
          href="/pricing"
          className="block mt-3 w-full bg-black text-white py-2 rounded-xl font-semibold"
        >
          🔓 Upgrade to Pro
        </Link>
      </div>

      {/* 🔍 CTA */}
      <div className="mt-6 text-center">
        <Link href="/link" className="btn btn-primary">
          Check another link
        </Link>
      </div>

      {/* ⚠️ Disclaimer */}
      <p className="text-xs text-gray-400 mt-4 text-center">
        Results are guidance, not a guarantee.
      </p>

    </div>
  );
}
