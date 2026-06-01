"use client";

import React from "react";
import { captureClientException } from "@/lib/observability/capture";
import { ErrorFallback } from "./ErrorFallback";

type Props = { children: React.ReactNode };

export default class GlobalErrorBoundary extends React.Component<Props, { hasError: boolean }> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const msg = String((error as Error)?.message || error);
    if (msg.includes('Extension context invalidated')) {
      console.debug('Ignoring extension context error (browser extension, not app):', msg);
      return;
    }
    captureClientException(error, { componentStack: info?.componentStack });
    try {
      fetch('/api/debug/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          stack: (error as Error)?.stack || null,
          info,
          url: typeof window !== 'undefined' ? window.location.href : '',
        }),
        credentials: 'include',
      }).catch(() => {});
    } catch {
      /* ignore */
    }
    this.setState({ hasError: true });
    console.error('GlobalErrorBoundary caught error', error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
