export interface PlanStat {
  label: string;
  value: string;
}

export type PricingPlanKey = 'free' | 'pro' | 'team' | 'enterprise';

export interface PricingPlan {
  name: string;
  plan_type: PricingPlanKey;
  /** Price per member with Aicser's AI (Pro: the one member; Team: each member). */
  price_monthly: number;
  price_yearly: number;
  /** Price per Light member: the full platform without Aicser's AI (own model keys work). */
  price_light_monthly?: number;
  price_light_yearly?: number;
  /** Team: members its price covers, each with AI. */
  min_seats?: number;
  /** Shown per member rather than per plan. */
  per_member?: boolean;
  stats: PlanStat[];
  features: string[];
  watermark: boolean;
  trial_days: number;
  popular?: boolean;
}

export type UsageLimit = number | -1;

/** One price per member on every paid plan (server: ee/modules/pricing/plans.py SEAT_PRICES). */
export const MEMBER_PRICES = {
  ai: { monthly: 18, yearly: 180 },
  light: { monthly: 6, yearly: 60 },
} as const;

export const AI_CREDITS_PER_AI_MEMBER = 900;

/** Extra credits, on any plan; they last 12 months (server: plans.CREDIT_PACK). */
export const CREDIT_PACK = { credits: 1000, price: 10, validDays: 365 } as const;

/** Aicser Personal: one-time desktop license with two years of updates (server: plans.PERSONAL_LICENSE). */
export const PERSONAL_LICENSE = { price: 149, renewalPrice: 69, updateYears: 2, devices: 3 } as const;

/** Credits cost a fixed amount per action (server: plans.CREDIT_COSTS). */
export const CREDIT_COSTS = {
  chat: 0,
  answer: 1,
  forecastOrDiagnose: 2,
  reportDashboardOrDecision: 5,
  agentStep: 1,
} as const;

export const planUsageLimits: Record<
  PricingPlanKey,
  {
    aiCreditsPerMonth: UsageLimit;
    storageGb: UsageLimit;
    projectWorkspaces: UsageLimit;
    dataSources: UsageLimit;
  }
> = {
  free: {
    aiCreditsPerMonth: 100,
    storageGb: 5,
    projectWorkspaces: 1,
    dataSources: 2,
  },
  pro: {
    aiCreditsPerMonth: AI_CREDITS_PER_AI_MEMBER,
    storageGb: 100,
    projectWorkspaces: -1,
    dataSources: -1,
  },
  team: {
    aiCreditsPerMonth: AI_CREDITS_PER_AI_MEMBER,
    storageGb: 500,
    projectWorkspaces: -1,
    dataSources: -1,
  },
  enterprise: {
    aiCreditsPerMonth: -1,
    storageGb: -1,
    projectWorkspaces: -1,
    dataSources: -1,
  },
};

export const pricingPlans: PricingPlan[] = [
  {
    name: 'Free',
    plan_type: 'free',
    price_monthly: 0,
    price_yearly: 0,
    stats: [
      { label: 'AI Credits', value: '100 / month' },
      { label: 'Storage', value: '5 GB' },
      { label: 'Data History', value: '7 days' },
    ],
    features: [
      '1 member, 1 project, 2 data sources',
      'Charts and dashboards (with watermark)',
      'Ask, Forecast and Standard AI modes',
      'Own AI model keys with limits',
      'Community support',
    ],
    watermark: true,
    trial_days: 0,
  },
  {
    name: 'Pro',
    plan_type: 'pro',
    price_monthly: MEMBER_PRICES.ai.monthly,
    price_yearly: MEMBER_PRICES.ai.yearly,
    price_light_monthly: MEMBER_PRICES.light.monthly,
    price_light_yearly: MEMBER_PRICES.light.yearly,
    stats: [
      { label: 'AI Credits', value: '900 / month' },
      { label: 'Storage', value: '100 GB' },
      { label: 'Data History', value: '6 months' },
    ],
    features: [
      'For one person',
      'Multiple projects and data sources, no watermark',
      'Every AI mode, Aicser Agent and Aicser MCP',
      'Pipelines, lakehouse, notebooks and sheets',
      'Embeds and public links (10,000 views / month)',
      'Exports to High Quality PNG, PDF, Word, PowerPoint and Excel',
      'Priority support',
    ],
    watermark: false,
    trial_days: 14,
    popular: true,
  },
  {
    name: 'Team',
    plan_type: 'team',
    price_monthly: MEMBER_PRICES.ai.monthly,
    price_yearly: MEMBER_PRICES.ai.yearly,
    price_light_monthly: MEMBER_PRICES.light.monthly,
    price_light_yearly: MEMBER_PRICES.light.yearly,
    per_member: true,
    min_seats: 5,
    stats: [
      { label: 'AI Credits', value: '900 / member / month' },
      { label: 'Storage', value: '500 GB' },
      { label: 'Data History', value: '1 year' },
    ],
    features: [
      'Everything in Pro, up to 5 members',
      'Collaboration, discussion and role access management',
      'Alerts, scheduled reports and scheduled agents',
      'Governance, PII, Row & Column-level security, catalog and basic audit log',
      'Connectors, Slack and MS Teams',
      'Embeds and public links (100,000 views / month)',
      'Dedicated support',
    ],
    watermark: false,
    trial_days: 14,
  },
  {
    name: 'Enterprise',
    plan_type: 'enterprise',
    price_monthly: 0, // Custom pricing
    price_yearly: 0,
    stats: [
      { label: 'AI Credits', value: 'Custom' },
      { label: 'Storage', value: 'Custom' },
      { label: 'Data History', value: 'Multi-year' },
    ],
    features: [
      'Everything in Team',
      'Self-hosted or private cloud, your own models',
      'SSO, SCIM and data residency',
      'Own branding',
      '99.9% SLA and a success manager',
    ],
    watermark: false,
    trial_days: 30,
  },
];
