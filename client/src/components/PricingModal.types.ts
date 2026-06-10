export interface PricingModalProps {
  visible?: boolean;
  onClose?: () => void;
  onUpgrade?: (planType: string, isYearly: boolean) => void;
  currentPlan?: string;
  loading?: boolean;
  [key: string]: unknown;
}
