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
  useEffect(() => {
    captureClientException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ padding: 40, fontFamily: 'Inter, sans-serif' }}>
        <h2>Something went wrong</h2>
        <p>{error.message || 'An unexpected error occurred.'}</p>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
      </body>
    </html>
  );
}
