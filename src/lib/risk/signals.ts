import type { RiskLevel } from "@/lib/types";

/**
 * Catalog of scam warning signs.
 *
 * `weight` is the maximum number of risk points a signal can contribute; the
 * analyser's confidence (0-1) scales it down. Keeping weights in one table
 * makes the scoring auditable and easy to tune without touching the engine.
 *
 * Wording is deliberately hedged - we report warning signs, we never assert
 * that something *is* a scam.
 */
export interface SignalDefinition {
  code: string;
  title: string;
  /** Fallback wording when the analyser gives us no specific evidence. */
  description: string;
  weight: number;
  severity: RiskLevel;
  /**
   * Some signals are decisive on their own - a gift-card demand is a warning
   * sign whether or not anything else is wrong. When such a signal is observed
   * confidently, the score is raised to at least this floor.
   */
  criticalFloor?: number;
  /** Advice added to "what you should do next" when this signal fires. */
  advice: string;
}

export const SIGNALS: SignalDefinition[] = [
  {
    code: "gift_card_payment",
    title: "Payment requested via gift cards",
    description:
      "The request appears to ask for payment in gift cards or prepaid card codes.",
    weight: 26,
    severity: "high",
    criticalFloor: 72,
    advice:
      "No legitimate seller, utility or government agency asks to be paid in gift cards. Do not share any card codes.",
  },
  {
    code: "crypto_payment",
    title: "Payment requested in cryptocurrency",
    description:
      "The request appears to ask for payment in cryptocurrency, which is effectively irreversible.",
    weight: 22,
    severity: "high",
    criticalFloor: 62,
    advice:
      "Crypto payments cannot be reversed or charged back. Ask to pay with a method that offers buyer protection instead.",
  },
  {
    code: "wire_transfer",
    title: "Wire transfer or bank-to-bank transfer requested",
    description:
      "The request appears to ask for a wire or direct bank transfer, which is hard to reverse.",
    weight: 20,
    severity: "high",
    criticalFloor: 55,
    advice:
      "Once a wire transfer clears it is very hard to recover. Prefer a card or platform payment that can be disputed.",
  },
  {
    code: "unusual_payment_method",
    title: "Unusual payment method",
    description:
      "Payment is requested through a channel that offers little or no buyer protection (for example a friends-and-family transfer).",
    weight: 15,
    severity: "medium",
    advice:
      "Pay with a credit card or a platform checkout that offers buyer protection, not a friends-and-family transfer.",
  },
  {
    code: "deposit_request",
    title: "Up-front deposit requested",
    description:
      "A deposit or down payment is requested before anything has been delivered or verified.",
    weight: 13,
    severity: "medium",
    advice:
      "Avoid paying a deposit until you have verified the seller independently and seen the item or contract.",
  },
  {
    code: "unrealistic_price",
    title: "Price looks well below market value",
    description:
      "The price appears significantly below what this item or service normally sells for.",
    weight: 18,
    severity: "high",
    advice:
      "Compare the price against two or three independent listings for the same item before committing.",
  },
  {
    code: "too_good_to_be_true",
    title: "Offer looks too good to be true",
    description:
      "The offer promises unusually high returns, free money, or benefits with no clear catch.",
    weight: 16,
    severity: "high",
    advice:
      "Treat guaranteed returns or unusually generous offers as unverified until you can confirm them from an independent source.",
  },
  {
    code: "urgency_pressure",
    title: "Urgency or pressure language",
    description:
      "The message pushes you to act or pay immediately, leaving little time to check the details.",
    weight: 14,
    severity: "medium",
    advice:
      "Pressure to decide right now is a common tactic. Give yourself time; a genuine seller will accept a short delay.",
  },
  {
    code: "sensitive_info_request",
    title: "Request for sensitive personal information",
    description:
      "Sensitive details are requested, such as passwords, one-time codes, full card numbers or government ID numbers.",
    weight: 20,
    severity: "high",
    criticalFloor: 68,
    advice:
      "Never share passwords, one-time verification codes, or full card details. Legitimate support staff will not ask for them.",
  },
  {
    code: "suspicious_url",
    title: "Suspicious link or domain",
    description:
      "A link or domain in the material looks irregular - for example a misspelled brand name or an unrelated domain.",
    weight: 16,
    severity: "high",
    advice:
      "Do not open the link. Type the company's official address into your browser yourself instead.",
  },
  {
    code: "impersonation",
    title: "Possible company or agency impersonation",
    description:
      "The material appears to present itself as a known company, bank or agency without verifiable proof.",
    weight: 20,
    severity: "high",
    criticalFloor: 61,
    advice:
      "Contact the organisation using a phone number or address from their official website, not the one in this message.",
  },
  {
    code: "inconsistent_contact",
    title: "Inconsistent names or contact details",
    description:
      "The business name, email domain, phone number or account name do not appear to line up.",
    weight: 13,
    severity: "medium",
    advice:
      "Ask why the payee name differs from the business name, and confirm through an independently found contact.",
  },
  {
    code: "fake_invoice",
    title: "Invoice looks irregular",
    description:
      "The invoice is missing details you would normally expect, or the details present look inconsistent.",
    weight: 17,
    severity: "medium",
    advice:
      "Check the invoice number and payment details against a previous genuine invoice, or call the supplier to confirm.",
  },
  {
    code: "off_platform",
    title: "Push to move off-platform",
    description:
      "The conversation is being moved to private messaging or email, away from a marketplace's protections.",
    weight: 13,
    severity: "medium",
    advice:
      "Keep the conversation and the payment on the original platform so its protections and records still apply.",
  },
  {
    code: "no_verifiable_identity",
    title: "Little verifiable identity information",
    description:
      "There is not enough verifiable information about the seller to confirm who they are.",
    weight: 11,
    severity: "medium",
    advice:
      "Ask for a business name and registration number, then check it against an official register or the company's website.",
  },
  {
    code: "suspicious_wording",
    title: "Suspicious wording or grammar",
    description:
      "The wording contains errors or phrasing unusual for an official communication.",
    weight: 8,
    severity: "low",
    advice:
      "Odd wording alone is not proof of anything, but combined with other signs it is worth a second look.",
  },
  {
    code: "unsolicited_contact",
    title: "Unsolicited contact",
    description:
      "The message appears to arrive out of the blue rather than in response to something you started.",
    weight: 9,
    severity: "low",
    advice:
      "If you did not initiate this, verify the sender independently before replying with any details.",
  },
  {
    code: "verified_platform_checkout",
    title: "Payment stays inside a platform checkout",
    description:
      "Payment appears to go through a recognised platform checkout that offers buyer protection.",
    weight: -12,
    severity: "low",
    advice:
      "Keep the payment inside the platform checkout - that is what preserves your buyer protection.",
  },
  {
    code: "consistent_business_details",
    title: "Business details appear consistent",
    description:
      "The business name, contact details and payment name appear to match one another.",
    weight: -10,
    severity: "low",
    advice:
      "Details look consistent here, but still confirm the company exists before sending a large amount.",
  },
];

export const SIGNALS_BY_CODE: ReadonlyMap<string, SignalDefinition> = new Map(
  SIGNALS.map((s) => [s.code, s]),
);

/** The signal codes the AI provider is allowed to return. */
export const SIGNAL_CODES: string[] = SIGNALS.map((s) => s.code);
