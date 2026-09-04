import type { SignalObservation } from "@/lib/types";

interface KeywordRule {
  code: string;
  confidence: number;
  patterns: RegExp[];
  evidence: string;
}

/**
 * Cheap keyword rules over any text we already hold. Used by the offline demo
 * provider, and as a supplement to URL analysis. They are intentionally
 * conservative: keyword matching alone should never produce a confident result.
 */
const RULES: KeywordRule[] = [
  {
    code: "gift_card_payment",
    confidence: 0.85,
    patterns: [/gift\s?cards?/i, /steam\s?card/i, /itunes\s?card/i, /google\s?play\s?card/i],
    evidence: "The text mentions payment by gift card.",
  },
  {
    code: "crypto_payment",
    confidence: 0.8,
    patterns: [/\bbitcoin\b/i, /\bBTC\b/, /\bUSDT\b/i, /\bethereum\b/i, /crypto(currency)?/i, /\bwallet address\b/i],
    evidence: "The text mentions paying in cryptocurrency.",
  },
  {
    code: "wire_transfer",
    confidence: 0.7,
    patterns: [/wire\s?transfer/i, /western\s?union/i, /moneygram/i, /\bbank transfer\b/i, /\bIBAN\b/],
    evidence: "The text mentions a wire or direct bank transfer.",
  },
  {
    code: "unusual_payment_method",
    confidence: 0.6,
    patterns: [/friends?\s*(and|&)\s*family/i, /zelle/i, /cash\s?app/i, /venmo/i, /\bwestern\b/i],
    evidence: "The text mentions a payment channel that usually has no buyer protection.",
  },
  {
    code: "deposit_request",
    confidence: 0.65,
    patterns: [/\bdeposit\b/i, /down\s?payment/i, /\bholding fee\b/i, /reserve the item/i, /\bupfront\b/i],
    evidence: "The text asks for a deposit or up-front payment.",
  },
  {
    code: "urgency_pressure",
    confidence: 0.6,
    patterns: [
      /\bact now\b/i, /\btoday only\b/i, /\bimmediately\b/i, /\burgent\b/i,
      /last chance/i, /within \d+\s?(min|hour)/i, /expires? (today|soon|in)/i,
      /limited time/i, /other buyers? (are )?waiting/i,
    ],
    evidence: "The text pushes for a fast decision.",
  },
  {
    code: "sensitive_info_request",
    confidence: 0.75,
    patterns: [
      /\bpassword\b/i, /one[-\s]?time (code|password)/i, /\bOTP\b/, /\bPIN\b/,
      /social security/i, /\bSSN\b/, /full card number/i, /\bCVV\b/i, /verification code/i,
    ],
    evidence: "The text asks for sensitive personal or security details.",
  },
  {
    code: "too_good_to_be_true",
    confidence: 0.6,
    patterns: [
      /guaranteed (returns?|profit|income)/i, /risk[-\s]?free/i, /double your (money|investment)/i,
      /\bfree money\b/i, /\d+%\s*(daily|weekly|monthly) (return|profit)/i, /you have won/i, /claim your prize/i,
    ],
    evidence: "The text promises unusually generous or guaranteed returns.",
  },
  {
    code: "off_platform",
    confidence: 0.6,
    patterns: [
      /whatsapp/i, /telegram/i, /\btext me\b/i, /contact me (directly|off)/i,
      /email me (directly|at)/i, /outside (the )?(app|platform)/i,
    ],
    evidence: "The text moves the conversation off the original platform.",
  },
  {
    code: "impersonation",
    confidence: 0.5,
    patterns: [
      /account (has been )?(suspended|locked|compromised)/i,
      /(your )?(bank|paypal|amazon|apple|netflix|irs|hmrc|revenue|customs)\b.*\b(verify|confirm|suspend)/i,
      /security (team|department)/i, /unusual (activity|login)/i,
    ],
    evidence: "The text presents itself as an official notice from a bank, agency or major brand.",
  },
  {
    code: "unrealistic_price",
    confidence: 0.5,
    patterns: [/\b\d+%\s*off\b/i, /below market/i, /must sell/i, /liquidation/i, /clearance price/i],
    evidence: "The text advertises a price far below the usual level.",
  },
  {
    code: "unsolicited_contact",
    confidence: 0.45,
    patterns: [/dear (customer|user|sir|madam)/i, /you have been selected/i, /congratulations/i],
    evidence: "The text reads like an unsolicited bulk message rather than a reply to you.",
  },
];

/** Runs the keyword rules over a blob of text. */
export function keywordObservations(text: string): SignalObservation[] {
  if (!text.trim()) return [];
  const out: SignalObservation[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      out.push({ code: rule.code, confidence: rule.confidence, evidence: rule.evidence });
    }
  }
  return out;
}
