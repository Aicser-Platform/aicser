// CE build fallback — null stubs for every EE export consumed by CE code.
// Webpack aliases @/ee to this file when ee/src/index.ts is absent.
// Every name here must match exactly what ee/src/index.ts exports.
import type { AuthActions, SignupResult } from '@/auth/types';
import type {
  CreateOrganizationPayload,
  Organization,
  UpdateOrganizationPayload,
} from '@/types/organization.type';
import type { ReactNode } from 'react';
import type { PricingPlanKey } from '@/utils/pricingPlans';
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
type AnyComponentProps = Record<string, unknown>;
export type CitationItem = Record<string, unknown>;
export interface StreamingAccumulator {
  partial_results?: Record<string, unknown>;
  message?: unknown;
  [key: string]: unknown;
}

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
export const LicenseSettingsTab      = (): null => null;
export const RolesTab                = (): null => null;
export const AgentSkillsTab          = (): null => null;
export const AgentWorkflowsTab       = (): null => null;
export const BriefingsTab            = (): null => null;
export const SemanticStudio          = (_props: AnyComponentProps): null => null;
export const ConnectModelVisualizeWizard = (_props: AnyComponentProps): null => null;
export const CitationSourcesStrip    = (_props: AnyComponentProps): null => null;
export const ThoughtProcessDisplay   = (_props: AnyComponentProps): null => null;
export const DashboardPlanCard       = (_props: AnyComponentProps): null => null;
export const ThemeCustomizer         = (_props: ThemeCustomizerProps): null => null;
export const OnboardingBootstrap     = (): null => null;
export const EnhancedOnboardingModal = (): null => null;
export const FeaturebaseMessenger    = (): null => null;
export function BrandThemeProvider({ children }: ProviderProps) {
  return children;
}

// ── Page stubs ───────────────────────────────────────────────────────────────
export const AlertsPage              = (): null => null;
export const ChatPage                = (): null => null;
export const ProjectsPage            = (): null => null;
export const DataPlatformPage        = (): null => null;
export const OnboardingPage          = (): null => null;
export const InviteAcceptPageEE      = (): null => null;
export const InviteSetPasswordPageEE = (): null => null;

// ── EE chat/embed utility stubs ─────────────────────────────────────────────
export function applyEvent(
  acc: StreamingAccumulator = {},
  _evt: Record<string, unknown> = {},
): StreamingAccumulator {
  return acc;
}
export function buildCompleteFromAccumulator(
  acc: StreamingAccumulator = {},
  _query?: string,
  fallbackMessage = '',
): StreamingAccumulator {
  return { ...acc, message: acc.message || fallbackMessage };
}
export function isSubstantiveCompleteEvent(_evt: Record<string, unknown>): boolean {
  return false;
}
export function displayText(_partialResults?: Record<string, unknown>, fallback = ''): string {
  return fallback;
}
export function drainSSEBuffer(
  buffer: string,
  _onEvent: (data: unknown) => void,
): string {
  return buffer;
}
export function extractAnalyzeRunView(_acc: StreamingAccumulator | null) {
  return {
    chartConfig: null,
    queryResult: null,
    citations: [] as CitationItem[],
    progress: undefined,
    dashboardKpiPlan: undefined,
    dashboardWidgetsReady: [] as unknown[],
    dashboardCreated: null,
    followUpQuestions: undefined,
  };
}
export function buildDashboardStudioLink(
  dashboardId: string,
  pageId?: string,
  messageId?: string,
): string {
  const params = new URLSearchParams({ id: dashboardId });
  if (pageId) params.set('page', pageId);
  if (messageId) params.set('message', messageId);
  return `/dashboards?${params.toString()}`;
}

// ── Auth stubs ───────────────────────────────────────────────────────────────
export const eeAuthActions: AuthActions = {
  async login(): Promise<void> {},
  async signup(): Promise<SignupResult> {
    return { success: false, is_verified: false, message: 'EE not available' };
  },
  async forgotPassword(): Promise<string | undefined> {
    return undefined;
  },
  async logout(): Promise<void> {},
};
export const supabase = null;
export async function completeSupabaseRedirectSession(): Promise<boolean> {
  return false;
}
export type SupabaseOAuthProvider = 'google' | 'github' | 'azure';
export async function loginWithSupabaseOAuth(_provider: SupabaseOAuthProvider): Promise<void> {}
export async function getEeApiAuthToken(): Promise<string | null> {
  return null;
}
export async function updateEeUserPassword(_password: string): Promise<boolean> {
  return false;
}
export function loginWithKeycloak(): void {}
export async function handleKeycloakCallback(_code: string): Promise<void> {}
export function isKeycloakConfigured(): boolean { return false; }

// ── Organization stubs ──────────────────────────────────────────────────────
export const organizationKeys = {
  all: ['organizations'] as const,
  list: () => ['organizations', 'list'] as const,
  detail: (id: string) => ['organizations', id] as const,
};
export function useOrganizations(_options: { enabled?: boolean } = {}) {
  return { organizations: [] as Organization[], error: null, isLoading: false };
}
export function useCreateOrganization() {
  return {
    mutateAsync: async (_data: CreateOrganizationPayload): Promise<Organization | null> => null,
    isLoading: false,
    isPending: false,
  };
}
export function useUpdateOrganization() {
  return {
    mutateAsync: async (_args: { id: string; data: UpdateOrganizationPayload }): Promise<Organization | null> => null,
    isLoading: false,
    isPending: false,
  };
}
export function useDeleteOrganization() {
  return {
    mutateAsync: async (_id: string): Promise<void> => {},
    isLoading: false,
    isPending: false,
  };
}
export async function listOrganizations(): Promise<{ organizations: Organization[] }> {
  return { organizations: [] };
}
export async function listOrganizationMembers(_organizationId: string): Promise<unknown[]> {
  return [];
}
export async function createOrganization(_data: CreateOrganizationPayload): Promise<Organization | null> {
  return null;
}
export async function updateOrganization(
  _id: string,
  _data: UpdateOrganizationPayload,
): Promise<Organization | null> {
  return null;
}
export async function deleteOrganization(_id: string): Promise<void> {}
export function proxyEeBillingRequest() {
  return Response.json({ detail: 'EE billing is not available in CE' }, { status: 404 });
}
export function proxyEePricingRequest() {
  return Response.json({ detail: 'EE pricing is not available in CE' }, { status: 404 });
}

// ── Store stubs ──────────────────────────────────────────────────────────────
// Minimal no-op stores so CE code that subscribes to these doesn't crash.
type UsageMetric = { used?: number; unlimited?: boolean; limit?: number; percentage?: number };
const noop = async () => {};
const noopOpts = async (_opts?: unknown) => {};

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
    isOnboardingActive: false,
    startOnboarding: () => {},
    skipOnboarding: () => {},
    shouldOfferOnboardingMinimal: () => false,
    recordOnboardingNudgeAfterOffer: () => {},
    steps: [] as unknown[],
    currentStep: null,
    advance: async () => {},
  };
}
export function useSubscriptionStore() {
  return {
    planType: 'free' as PricingPlanKey,
    subscription: null as Record<string, unknown> | null,
    usage: {} as Record<string, UsageMetric | undefined>,
    features: {} as Record<string, boolean>,
    loading: false,
    lastFetchedAt: null as number | null,
    refresh: noop,
    refreshUsage: noopOpts,
    init: noop,
    refreshIfStale: async (_maxAgeMs?: number) => {},
  };
}
export const useSubscription = useSubscriptionStore;
