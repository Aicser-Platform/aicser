import type { BrowserOptions, EdgeOptions, NodeOptions } from '@sentry/nextjs';

export const sentryEnabled = Boolean(
  process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
);

function sampleRate(name: string, fallback: string): number {
  const raw = process.env[name] ?? fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0.1;
}

export function getBaseSentryOptions(): NodeOptions & BrowserOptions & EdgeOptions {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  return {
    dsn,
    enabled: sentryEnabled && Boolean(dsn),
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
      process.env.SENTRY_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.SENTRY_RELEASE,
    tracesSampleRate: sampleRate(
      'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE',
      process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1',
    ),
    sendDefaultPii: false,
    attachStacktrace: true,
    ignoreErrors: ['Extension context invalidated'],
  };
}
