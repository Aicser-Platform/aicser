export interface PlanStat {
  label: string;
  value: string;
}

export type PricingPlanKey = 'free' | 'pro' | 'team' | 'enterprise';

export interface PricingPlan {
  name: string;
  plan_type: PricingPlanKey;
  price_monthly: number;
  price_yearly: number;
  stats: PlanStat[];
  features: string[];
  watermark: boolean;
  trial_days: number;
  popular?: boolean;
  min_seats?: number;
  price_per_seat?: number;
}

export type UsageLimit = number | -1;

export const aiCreditPolicy = {
  baseCost: 1,
  maxCreditsPerRequest: 10,
  modelMultipliers: {
    'gpt-5': 1.5,
    'gpt-4.1': 1.5,
    'gpt-4o': 1,
    'gpt-4o-mini': 1,
    auto: 1.25,
  },
  analysisModeMultipliers: {
    chat: 0.3,
    descriptive: 0.5,
    standard: 0.5,
    diagnostic: 1,
    predictive: 1,
    animate: 1,
    prescriptive: 1.5,
    executive_report_brief: 1,
    executive_report_standard: 1.5,
    executive_report_comprehensive: 2,
  },
  datasetTiers: [
    { thresholdBytes: 1 * 1024 * 1024 * 1024 * 1024, credits: 12 },
    { thresholdBytes: 1 * 1024 * 1024 * 1024, credits: 6 },
    { thresholdBytes: 500 * 1024 * 1024, credits: 4 },
    { thresholdBytes: 10 * 1024 * 1024, credits: 2 },
    { thresholdBytes: 1 * 1024 * 1024, credits: 1 },
    { thresholdBytes: 0, credits: 0.5 },
  ],
};

export const aiCreditFormula =
  'credits = ceil((ceil(tokens/1000) * modelMultiplier) + datasetCost + (analysisModeMultiplier * baseCost))';

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
    aiCreditsPerMonth: 30,
    storageGb: 5,
    projectWorkspaces: 1,
    dataSources: 2,
  },
  pro: {
    aiCreditsPerMonth: 900,
    storageGb: 100,
    projectWorkspaces: -1,
    dataSources: -1,
  },
  team: {
    aiCreditsPerMonth: 5000,
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
      { label: 'AI Credits', value: '30 / month' },
      { label: 'Storage', value: '5 GB' },
      { label: 'Data History', value: '7 days' },
    ],
    features: [
      '1 project workspace',
      '2 data sources',
      'Charts & Dashboard (with watermark)',
      'Community support',
      'Standard AI modes only (Chat, Descriptive, Predictive, Animate)',
      'Export to PNG only',
    ],
    watermark: true,
    trial_days: 0,
  },
  {
    name: 'Pro',
    plan_type: 'pro',
    price_monthly: 25,
    price_yearly: 250,
    stats: [
      { label: 'AI Credits', value: '900 / month' },
      { label: 'Storage', value: '100 GB' },
      { label: 'Data History', value: '6 months' },
    ],
    features: [
      'Multiple projects & data sources',
      'No watermarks',
      'All AI modes (Chat, Descriptive, Predictive, Diagnostic, Prescriptive, Animate, Executive Report)',
      'Cross-source analytics',
      'Telegram Bot Integration',
      'Theme & brand customization',
      'Priority support',
      'Export to PDF & SVG',
    ],
    watermark: false,
    trial_days: 14,
    popular: true,
  },
  {
    name: 'Team',
    plan_type: 'team',
    price_monthly: 99,
    price_yearly: 990,
    stats: [
      { label: 'AI Credits', value: '1, 000 / user' },
      { label: 'Storage', value: '100 GB / user' },
      { label: 'Data History', value: '1 year' },
      { label: 'Seats', value: '5 included' },
    ],
    min_seats: 5,
    price_per_seat: 25,
    features: [
      'Everything in Pro',
      'Team collaboration & comments',
      'Role-based permissions',
      'Scheduled reports',
      'Webhooks & integrations',
      'API access',
      'Dedicated support',
      '$25/seat for additional users',
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
      { label: 'Seats', value: 'Custom' },
    ],
    features: [
      'Everything in Team',
      'White-label branding',
      'On-premise deployment',
      'SSO & SAML',
      'Compliance certifications',
      '99.9% SLA',
      'Dedicated success manager',
      'Custom AI model training',
    ],
    watermark: false,
    trial_days: 30,
  },
];
