 'use client';
export const dynamic = 'force-dynamic';

import React from 'react';

export default function AppError({ error }: { error: Error }) {
  // Hide header when error page is shown
  React.useEffect(() => {
    const header = document.querySelector('.ant-layout-header');
    if (header) {
      (header as HTMLElement).style.display = 'none';
    }
    return () => {
      if (header) {
        (header as HTMLElement).style.display = '';
      }
    };
  }, []);

  return (
    <div 
      data-error-page="true"
      style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        padding: 40, 
        textAlign: 'center',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--ant-color-bg-layout)',
        zIndex: 10000,
      }}
    >
      <h1 style={{ marginBottom: '16px', color: 'var(--ant-color-text)' }}>Application error</h1>
      <p style={{ color: 'var(--ant-color-text-secondary)' }}>{error?.message || 'An unexpected error occurred.'}</p>
    </div>
  );
}


