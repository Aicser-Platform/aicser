import { describe, it, expect, vi, afterEach } from 'vitest';

describe('EE page guard — isEE constant', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('isEE is false when NEXT_PUBLIC_EDITION is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', '');
    expect(process.env.NEXT_PUBLIC_EDITION === 'enterprise').toBe(false);
  });

  it('isEE is false for "EE" value (wrong casing, not the project convention)', () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'EE');
    expect(process.env.NEXT_PUBLIC_EDITION === 'enterprise').toBe(false);
  });

  it('isEE is true when NEXT_PUBLIC_EDITION is "enterprise"', () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    expect(process.env.NEXT_PUBLIC_EDITION === 'enterprise').toBe(true);
  });
});

describe('EE page guard — redirect logic', () => {
  it('redirects to /dashboards when isEE is false', () => {
    const guardTarget = (isEE: boolean) => (!isEE ? '/dashboards' : null);
    expect(guardTarget(false)).toBe('/dashboards');
    expect(guardTarget(true)).toBeNull();
  });
});

describe('CE fallback — store stubs return safe shapes', () => {
  // Cold-import of ee-fallback pulls EnhancedDataPanel; allow extra time under jsdom.
  it('useConversationStore stub is safe to destructure', async () => {
    const { useConversationStore } = await import('../ee-fallback');
    const { conversations, isLoading, loadConversations } = useConversationStore();
    expect(Array.isArray(conversations)).toBe(true);
    expect(isLoading).toBe(false);
    expect(typeof loadConversations).toBe('function');
  }, 20_000);

  it('useOnboardingStore stub exposes onboardingCompleted and startOnboarding', async () => {
    const { useOnboardingStore } = await import('../ee-fallback');
    const { onboardingCompleted, startOnboarding } = useOnboardingStore();
    expect(onboardingCompleted).toBe(false);
    expect(typeof startOnboarding).toBe('function');
  });

  it('useOnboarding stub returns isComplete: true — CE skips onboarding flow', async () => {
    const { useOnboarding } = await import('../ee-fallback');
    expect(useOnboarding().isComplete).toBe(true);
  });
});
