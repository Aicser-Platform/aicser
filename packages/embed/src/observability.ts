export interface EmbedObservabilityOptions {
  /** Optional Sentry DSN for the host page (install @sentry/browser as peer). */
  sentryDsn?: string;
  environment?: string;
  release?: string;
}

let sentryReady = false;

async function ensureSentry(options: EmbedObservabilityOptions): Promise<boolean> {
  if (!options.sentryDsn || sentryReady) return sentryReady;

  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn: options.sentryDsn,
      environment: options.environment || 'production',
      release: options.release,
      sendDefaultPii: false,
    });
    sentryReady = true;
    return true;
  } catch {
    return false;
  }
}

export async function initEmbedObservability(
  options?: EmbedObservabilityOptions,
): Promise<void> {
  if (!options?.sentryDsn) return;
  await ensureSentry(options);
}

export async function captureEmbedError(
  error: unknown,
  context: Record<string, unknown>,
  options?: EmbedObservabilityOptions,
): Promise<void> {
  if (!options?.sentryDsn) return;

  const ready = await ensureSentry(options);
  if (!ready) return;

  try {
    const Sentry = await import('@sentry/browser');
    Sentry.withScope((scope: { setTag: (k: string, v: string) => void; setExtra: (k: string, v: unknown) => void }) => {
      scope.setTag('component', 'aicser-embed');
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
      Sentry.captureException(error);
    });
  } catch {
    // Observability must never break embed mounting.
  }
}
