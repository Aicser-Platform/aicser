 'use client';
export const dynamic = 'force-dynamic';

import React from 'react';

export default function NotFound() {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h1>404 — Page not found</h1>
      <p>The requested page could not be found.</p>
    </div>
  );
}


