// Verifies all EE exports resolve to non-undefined values in the CE fallback.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/components/data/SQLEditor/QueryEditorDataPanel', () => ({
  default: () => null,
}));

import * as fallback from '../ee-fallback';

const COMPONENT_EXPORTS = [
  'BillingSuccessHandler',
  'TrialExpiryBanner',
  'ProjectSelectorModal',
  'PricingModalEE',
  'EnhancedDataPanel',
  'AnimatedAIAvatar',
  'ActivityInboxBell',
  'OrganizationSettingsTab',
  'TeamSettingsTab',
  'IntegrationSettingsTab',
  'SubscriptionSettingsTab',
  'ThemeCustomizer',
  'AlertsPage',
  'ChatPage',
  'ProjectsPage',
  'DataPlatformPage',
  'InviteAcceptPageEE',
  'InviteSetPasswordPageEE',
] as const;

const FUNCTION_EXPORTS = [
  'loginWithKeycloak',
  'handleKeycloakCallback',
] as const;

const HOOK_EXPORTS = [
  'useConversationStore',
  'useOnboardingStore',
  'useOnboarding',
] as const;

describe('ee-fallback — CE stubs', () => {
  it.each(COMPONENT_EXPORTS)('%s is a function that returns null', (name) => {
    const stub = fallback[name] as () => null;
    expect(typeof stub).toBe('function');
    expect(stub()).toBeNull();
  });

  it.each(FUNCTION_EXPORTS)('%s is a function', (name) => {
    expect(typeof fallback[name]).toBe('function');
  });

  it('eeAuthActions is an object with login/signup/logout', () => {
    const { eeAuthActions } = fallback;
    expect(typeof eeAuthActions).toBe('object');
    expect(typeof eeAuthActions.login).toBe('function');
    expect(typeof eeAuthActions.signup).toBe('function');
    expect(typeof eeAuthActions.logout).toBe('function');
  });

  it('eeAuthActions.signup resolves to a failed SignupResult', async () => {
    const result = await fallback.eeAuthActions.signup('', '', '');
    expect(result.success).toBe(false);
    expect(typeof result.message).toBe('string');
  });

  it.each(HOOK_EXPORTS)('%s is a function', (name) => {
    expect(typeof fallback[name]).toBe('function');
  });

  it('useConversationStore returns expected shape', () => {
    const store = fallback.useConversationStore();
    expect(Array.isArray(store.conversations)).toBe(true);
    expect(typeof store.loadConversations).toBe('function');
    expect(store.isLoading).toBe(false);
  });

  it('useOnboardingStore returns expected shape including CE-required properties', () => {
    const store = fallback.useOnboardingStore();
    expect(typeof store.fetchStatus).toBe('function');
    expect(typeof store.startOnboarding).toBe('function');
    expect(store.onboardingCompleted).toBe(false);
  });

  it('useOnboarding returns isComplete: true so CE never shows onboarding flow', () => {
    const result = fallback.useOnboarding();
    expect(result.isComplete).toBe(true);
  });
});
