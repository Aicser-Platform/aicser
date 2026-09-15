'use client';

import React from 'react';
import { Button, Result } from 'antd';

interface ErrorFallbackProps {
  onRetry: () => void;
}

// Deliberately no next-intl here: this renders when GlobalErrorBoundary
// replaces its children, which unmounts LocaleProvider (and thus
// NextIntlClientProvider) along with everything else. A fallback that
// depends on the provider tree it's meant to survive would itself crash
// the moment it's actually needed.
export function ErrorFallback({ onRetry }: ErrorFallbackProps) {
  return (
    <div style={{ padding: 24, minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Result
        status="error"
        title="Something went wrong"
        subTitle="The app hit an unexpected error. You can try again or return to your dashboards."
        extra={[
          <Button type="primary" key="retry" onClick={onRetry}>
            Try again
          </Button>,
          <Button key="home" href="/dashboards">
            Go to dashboards
          </Button>,
        ]}
      />
    </div>
  );
}
