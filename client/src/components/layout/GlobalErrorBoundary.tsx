"use client";

import React from "react";

type Props = { children: React.ReactNode };

export default class GlobalErrorBoundary extends React.Component<Props, { hasError: boolean }> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  componentDidCatch(error: any, info: any) {
    // Ignore "Extension context invalidated" — comes from browser extensions (e.g. React DevTools)
    // on page refresh; not an app bug and should not show the error UI.
    const msg = String(error?.message || error);
    if (msg.includes('Extension context invalidated')) {
      // eslint-disable-next-line no-console
      console.debug('Ignoring extension context error (browser extension, not app):', msg);
      return;
    }
    try {
      // Log to client debug endpoint (best-effort)
      fetch('/api/debug/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: String(error?.message || error), stack: error?.stack || null, info, url: typeof window !== 'undefined' ? window.location.href : '' }),
        credentials: 'include'
      }).catch(() => {});
    } catch (e) {}
    // still set local fallback UI
    this.setState({ hasError: true });
    // also print to console
    // eslint-disable-next-line no-console
    console.error('GlobalErrorBoundary caught error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <h2>Application error</h2>
          <p>Something went wrong. The error has been reported for investigation.</p>
        </div>
      );
    }
    return this.props.children as any;
  }
}


