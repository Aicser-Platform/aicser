'use client';

import { useEffect } from 'react';
import { captureClientException } from '@/lib/observability/capture';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError = /loading (css )?chunk .+ failed/i.test(error?.message || '');

  useEffect(() => {
    captureClientException(error);
    if (isChunkError && typeof window !== 'undefined') {
      // Auto-reload to recover from superseded dev server chunks after container restart
      window.location.reload();
    }
  }, [error, isChunkError]);

  return (
    <html lang="en">
      <body style={{ padding: 40, fontFamily: 'Inter, sans-serif' }}>
        <h2>Something went wrong</h2>
        <p>{error.message || 'An unexpected error occurred.'}</p>
        <button
          type="button"
          onClick={() => {
            if (isChunkError && typeof window !== 'undefined') {
              window.location.reload();
            } else {
              reset();
            }
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
