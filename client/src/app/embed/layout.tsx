'use client';

import React, { useEffect } from 'react';
import { notifyEmbedReady, notifyEmbedError } from '@/utils/embedMessaging';
import { captureClientException } from '@/lib/observability/capture';
import '@/app/globals.css';

class EmbedErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    captureClientException(error, { surface: 'embed' });
    notifyEmbedError(error.message || 'Embed render error');
  }

  render() {
    if (this.state?.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    notifyEmbedReady({ route: typeof window !== 'undefined' ? window.location.pathname : '' });
  }, []);

  return (
    <EmbedErrorBoundary>
      <div
        className="aicser-embed-root"
        style={{
          minHeight: '100vh',
          width: '100%',
          margin: 0,
          padding: 0,
          background: 'var(--ant-color-bg-layout, var(--color-bg-base))',
          overflow: 'hidden',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {children}
      </div>
    </EmbedErrorBoundary>
  );
}
