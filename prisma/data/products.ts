/**
 * Catalog for the fictional SaaS product, "Halcyon" — a workflow automation
 * and team-collaboration platform. All products, prices, and plans below
 * are synthetic and only need to be internally consistent, not realistic
 * for any real company.
 */
export interface ProductSeed {
  sku: string;
  name: string;
  description: string;
  category: "core" | "add-on" | "usage";
  priceCents: number;
  billingUnit: "seat" | "flat" | "usage";
}

export const PRODUCTS: ProductSeed[] = [
  {
    sku: "CORE-SEAT",
    name: "Halcyon Core Seat",
    description: "Per-user access to the core Halcyon workspace: boards, tasks, and automations.",
    category: "core",
    priceCents: 1800,
    billingUnit: "seat",
  },
  {
    sku: "AUTOMATION-ADDON",
    name: "Advanced Automations",
    description: "Multi-step automation builder with third-party webhook triggers.",
    category: "add-on",
    priceCents: 4900,
    billingUnit: "flat",
  },
  {
    sku: "ANALYTICS-ADDON",
    name: "Advanced Analytics",
    description: "Cross-workspace reporting, custom dashboards, and data export.",
    category: "add-on",
    priceCents: 3900,
    billingUnit: "flat",
  },
  {
    sku: "SSO-ADDON",
    name: "SSO / SAML",
    description: "Single sign-on via SAML 2.0 for enterprise identity providers.",
    category: "add-on",
    priceCents: 9900,
    billingUnit: "flat",
  },
  {
    sku: "PRIORITY-SUPPORT",
    name: "Priority Support",
    description: "Guaranteed 4-hour first response and a named support contact.",
    category: "add-on",
    priceCents: 5900,
    billingUnit: "flat",
  },
  {
    sku: "STORAGE-ADDON",
    name: "Extra File Storage",
    description: "Additional attachment storage beyond the plan's included allotment.",
    category: "add-on",
    priceCents: 1500,
    billingUnit: "usage",
  },
  {
    sku: "API-USAGE",
    name: "API Usage",
    description: "Metered API calls beyond the plan's included monthly quota.",
    category: "usage",
    priceCents: 200,
    billingUnit: "usage",
  },
  {
    sku: "SANDBOX-ADDON",
    name: "Sandbox Environment",
    description: "An isolated environment for testing automations before production.",
    category: "add-on",
    priceCents: 2900,
    billingUnit: "flat",
  },
];

export const PLANS = ["starter", "growth", "scale", "enterprise"] as const;
export type Plan = (typeof PLANS)[number];

/** Which product SKUs each plan bundles by default (beyond core seats,
 * which every plan includes). Used to build realistic SubscriptionItems. */
export const PLAN_BUNDLES: Record<Plan, string[]> = {
  starter: [],
  growth: ["AUTOMATION-ADDON"],
  scale: ["AUTOMATION-ADDON", "ANALYTICS-ADDON"],
  enterprise: ["AUTOMATION-ADDON", "ANALYTICS-ADDON", "SSO-ADDON", "PRIORITY-SUPPORT"],
};
