import type { AnalysisExtraction, ExtractedField, SignalObservation } from "@/lib/types";
import { getReputationProvider } from "./reputation";

/** TLDs that are cheap/abused often enough to be worth a small nudge. */
const RISKY_TLDS = new Set([
  "zip", "mov", "top", "xyz", "click", "link", "gq", "cf", "ml", "tk", "work",
  "loan", "kim", "country", "stream", "download", "review", "rest", "quest",
]);

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly",
  "cutt.ly", "rebrand.ly", "shorturl.at", "tiny.cc", "rb.gy", "s.id",
]);

/** Brands commonly impersonated in payment scams. */
const BRANDS = [
  "paypal", "amazon", "apple", "microsoft", "google", "netflix", "facebook",
  "instagram", "whatsapp", "coinbase", "binance", "revolut", "chase",
  "wellsfargo", "hsbc", "barclays", "santander", "dhl", "fedex", "ups",
  "usps", "royalmail", "irs", "hmrc", "gov", "booking", "airbnb", "ebay",
  "etsy", "shopify", "stripe", "venmo", "zelle", "cashapp",
];

const SENSITIVE_PATH_WORDS = [
  "login", "signin", "verify", "verification", "secure", "account", "update",
  "confirm", "billing", "payment", "wallet", "unlock", "recover", "password",
];

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function registrableTail(hostname: string): string {
  const parts = hostname.split(".");
  return parts.slice(-2).join(".");
}

/**
 * Structural analysis of a URL string. Nothing is fetched: we never open a link
 * a user thinks might be hostile, and we never resolve it server-side.
 */
export async function analyzeUrl(url: URL): Promise<AnalysisExtraction> {
  const host = url.hostname.toLowerCase();
  const labels = host.split(".");
  const tld = labels[labels.length - 1] ?? "";
  const subdomains = labels.slice(0, -2);
  const path = `${url.pathname}${url.search}`.toLowerCase();

  const observations: SignalObservation[] = [];
  const notes: string[] = [];
  const add = (code: string, confidence: number, evidence: string) =>
    observations.push({ code, confidence, evidence });

  const fields: ExtractedField[] = [
    { key: "website", label: "Domain", value: host },
    { key: "protocol", label: "Connection", value: url.protocol === "https:" ? "https (encrypted)" : "http (not encrypted)" },
  ];
  if (subdomains.length) {
    fields.push({ key: "subdomain", label: "Subdomain", value: subdomains.join(".") });
  }
  if (url.pathname && url.pathname !== "/") {
    fields.push({ key: "path", label: "Page path", value: url.pathname.slice(0, 200) });
  }

  // --- Structural signals -------------------------------------------------
  if (isIpAddress(host)) {
    add("suspicious_url", 0.85, "The address points straight at a raw IP address instead of a domain name.");
  }

  if (host.startsWith("xn--") || labels.some((l) => l.startsWith("xn--"))) {
    add("suspicious_url", 0.8, "The domain uses encoded characters that can be used to imitate another name.");
  }

  if (url.protocol === "http:") {
    add("suspicious_url", 0.4, "The link is not encrypted (http rather than https), so anything you enter is not protected.");
  }

  if (url.username || url.password) {
    add("suspicious_url", 0.85, "The address contains an '@' credential section, a known trick for hiding the real destination.");
  }

  if (url.port && url.port !== "80" && url.port !== "443") {
    add("suspicious_url", 0.45, `The address uses an unusual network port (${url.port}).`);
  }

  if (RISKY_TLDS.has(tld)) {
    add("suspicious_url", 0.5, `The domain ends in ".${tld}", an extension frequently used for throwaway sites.`);
  }

  if (subdomains.length >= 3) {
    add("suspicious_url", 0.5, "The address stacks several subdomains, which is often used to make a link look official.");
  }

  if (SHORTENERS.has(registrableTail(host))) {
    add("suspicious_url", 0.55, "This is a shortened link, so the real destination is hidden until you open it.");
    notes.push("Shortened links hide their destination. Expand it with a link-preview service before opening.");
  }

  // A brand name in the *subdomain* of an unrelated domain is the classic
  // lookalike shape: "paypal.secure-billing.example.tk" is served by
  // example.tk, not by PayPal. This is a structural fact, so we state it
  // confidently.
  const tail = registrableTail(host);
  const subdomainText = subdomains.join(".");
  const brandInSubdomain = BRANDS.find(
    (brand) => subdomainText.includes(brand) && !tail.startsWith(`${brand}.`),
  );
  if (brandInSubdomain) {
    add(
      "impersonation",
      0.8,
      `The address begins with "${brandInSubdomain}" but the site is actually served by "${tail}", which is not that company's own domain.`,
    );
  }

  // A brand in the *path* is much weaker - plenty of legitimate sites have
  // paths like "/apple/" - so it is only ever a hint.
  const brandInPath = BRANDS.find(
    (brand) => url.pathname.toLowerCase().includes(`/${brand}`) && !tail.startsWith(`${brand}.`),
  );
  if (brandInPath && !brandInSubdomain) {
    add(
      "inconsistent_contact",
      0.35,
      `The page path mentions "${brandInPath}" although the site is served by "${tail}".`,
    );
  }

  const hyphenHeavy = labels.some((l) => (l.match(/-/g) ?? []).length >= 3);
  if (hyphenHeavy) {
    add("suspicious_url", 0.4, "The domain name is padded with several hyphens, a common way to mimic a real brand name.");
  }

  const sensitiveWord = SENSITIVE_PATH_WORDS.find((w) => path.includes(w));
  if (sensitiveWord) {
    add(
      "sensitive_info_request",
      0.45,
      `The page path suggests a sign-in or payment page ("${sensitiveWord}"). Only enter details on a site you navigated to yourself.`,
    );
  }

  if (url.href.length > 150) {
    add("suspicious_url", 0.35, "The link is unusually long, which can be used to bury the real destination.");
  }

  // --- Pluggable reputation layer ----------------------------------------
  const reputation = await getReputationProvider().check(url);
  observations.push(...reputation.observations);
  notes.push(...reputation.notes);

  const summary = observations.length
    ? `This link points to ${host}. We found some characteristics worth checking before you open it or enter any details.`
    : `This link points to ${host}. Nothing unusual stood out in the address itself.`;

  return { summary, fields, observations, notes };
}
