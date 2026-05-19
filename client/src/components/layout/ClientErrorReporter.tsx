'use client';

import React, { useEffect } from 'react';

export default function ClientErrorReporter() {
  useEffect(() => {
    const send = async (payload: any) => {
      try {
        await fetch('/debug/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        // ignore
      }
    };

    const onError = (message: any, source: any, lineno: any, colno: any, error: any) => {
      send({ type: 'error', message, source, lineno, colno, stack: error?.stack });
      return false;
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason: any = (event && (event.reason as any)) || undefined;
      const reasonString = typeof reason === 'string' ? reason : (reason?.message ?? String(reason));
      send({ type: 'unhandledrejection', reason: reasonString, stack: reason && reason.stack });
    };

    const errorListener = (e: ErrorEvent) => onError(e.message, e.filename, e.lineno, e.colno, e.error);
    window.addEventListener('error', errorListener);
    window.addEventListener('unhandledrejection', onRejection as any);

    return () => {
      window.removeEventListener('error', errorListener);
      window.removeEventListener('unhandledrejection', onRejection as any);
    };
  }, []);

  return null;
}
