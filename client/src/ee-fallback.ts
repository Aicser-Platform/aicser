// CE build fallback — null stubs for every EE export consumed by CE code.
// Webpack aliases @/ee to this file when ee/src/index.ts is absent.
// Every name here must match exactly what ee/src/index.ts exports.
import type { AuthActions, SignupResult } from '@/auth/types';
import type { ReactNode } from 'react';
export { default as EnhancedDataPanel } from '@/components/data/SQLEditor/QueryEditorDataPanel';

type ProviderProps = { children: ReactNode };
type ProjectSelectorModalProps = {
  open?: boolean;
  onClose?: () => void;
  onProjectChange?: (projectId: string | number) => void;
  onCreateNew?: () => void;
};
type ThemeCustomizerProps = {
  open?: boolean;
  onClose?: () => void;
};

// ── Component stubs ──────────────────────────────────────────────────────────
export const BillingSuccessHandler   = (): null => null;
export const TrialExpiryBanner       = (): null => null;
export const ProjectSelectorModal    = (_props: ProjectSelectorModalProps): null => null;
export const PricingModalEE          = (): null => null;
export const AnimatedAIAvatar        = (): null => null;
export const ActivityInboxBell       = (): null => null;
export const OrganizationSettingsTab = (): null => null;
export const TeamSettingsTab         = (): null => null;
export const IntegrationSettingsTab  = (): null => null;
export const SubscriptionSettingsTab = (): null => null;
export const ThemeCustomizer         = (_props: ThemeCustomizerProps): null => null;
export function BrandThemeProvider({ children }: ProviderProps) {
  return children;
}

// ── Page stubs ───────────────────────────────────────────────────────────────
export const AlertsPage              = (): null => null;
export const ChatPage                = (): null => null;
export const ProjectsPage            = (): null => null;
export const DataPlatformPage        = (): null => null;
export const InviteAcceptPageEE      = (): null => null;
export const InviteSetPasswordPageEE = (): null => null;

// ── Auth stubs ───────────────────────────────────────────────────────────────
export const eeAuthActions: AuthActions = {
  async login(): Promise<void> {},
  async signup(): Promise<SignupResult> {
    return { success: false, is_verified: false, message: 'EE not available' };
  },
  async logout(): Promise<void> {},
};
export function loginWithKeycloak(): void {}
export async function handleKeycloakCallback(_code: string): Promise<void> {}

// ── Store stubs ──────────────────────────────────────────────────────────────
// Minimal no-op stores so CE code that subscribes to these doesn't crash.
export function useConversationStore() {
  return {
    conversations: [] as unknown[],
    currentConversationId: null as string | null,
    messages: new Map<string, unknown[]>(),
    isLoading: false,
    loadConversations: async () => {},
    createConversation: async (_payload?: unknown) => null,
    setCurrentConversationId: (_id?: string | null) => {},
    sendMessage: async (..._args: unknown[]) => {},
    resetStore: () => {},
  };
}
export function useOnboardingStore() {
  return {
    status: null,
    isLoading: false,
    fetchStatus: async () => {},
    markComplete: async () => {},
    startOnboarding: () => {},
    onboardingCompleted: false,
  };
}
export function useOnboarding() {
  return {
    isComplete: true,
    isLoading: false,
    steps: [] as unknown[],
    currentStep: null,
    advance: async () => {},
  };
}
