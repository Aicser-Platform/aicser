import * as Sentry from '@sentry/nextjs';

import { getBaseSentryOptions } from './sentry.shared.config';

Sentry.init({
  ...getBaseSentryOptions(),
  integrations: [Sentry.browserTracingIntegration()],
});

if (process.env.NEXT_PUBLIC_OTEL_ENABLED === 'true') {
  void import('./src/lib/observability/browser-otel').then(({ initBrowserOtel }) => initBrowserOtel());
}
