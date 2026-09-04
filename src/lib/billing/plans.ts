/** The two plans, and the one place their limits are defined. */

export type PlanId = "free" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceLabel: string;
  /** Screenshot analyses included per calendar month. */
  monthlyScans: number;
  blurb: string;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    monthlyScans: 3,
    blurb: "Enough to check the offer in front of you.",
    features: [
      "3 screenshot analyses per month",
      "Unlimited link checks",
      "Full risk score, warning signs and next steps",
      "Private scan history",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceLabel: "$9.99",
    monthlyScans: 100,
    blurb: "For anyone buying, selling or paying invoices regularly.",
    features: [
      "100 screenshot analyses per month",
      "Unlimited link checks",
      "Full risk score, warning signs and next steps",
      "Private scan history",
      "Cancel any time",
    ],
  },
};

export const FREE_PLAN = PLANS.free;
export const PRO_PLAN = PLANS.pro;

/**
 * Link checks are deterministic and cost us nothing to run, so they are not
 * metered. Only screenshot analyses, which call the vision model, count.
 */
export const METERED_SCAN_TYPE = "screenshot" as const;
