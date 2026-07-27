export async function register() {
  // Skip Sentry entirely when no DSN — importing @sentry/nextjs can still crash
  // on OpenTelemetry sampler enums (AlwaysOn) under Next 16 + mismatched OTel.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  if (!dsn?.trim()) return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      await import('./sentry.server.config');
    } catch (err) {
      console.warn('[instrumentation] Sentry server init failed:', err);
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    try {
      await import('./sentry.edge.config');
    } catch (err) {
      console.warn('[instrumentation] Sentry edge init failed:', err);
    }
  }
}
