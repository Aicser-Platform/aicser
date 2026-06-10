/** Report client errors to Sentry when configured (no-op otherwise). */
export function captureClientException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  void import('@sentry/browser')
    .then((Sentry) => {
      Sentry.captureException(error, context ? { extra: context } : undefined);
    })
    .catch(() => {});
}
