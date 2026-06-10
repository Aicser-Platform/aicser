import * as Sentry from '@sentry/nextjs';

import { getBaseSentryOptions } from './sentry.shared.config';

Sentry.init(getBaseSentryOptions());
