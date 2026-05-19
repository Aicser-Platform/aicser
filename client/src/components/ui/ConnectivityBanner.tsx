'use client';

import React, { useEffect, useState } from 'react';
import { getBackendUrl } from '@/utils/backendUrl';

let shownOnce = false;

export default function ConnectivityBanner() {
  const [status, setStatus] = useState<'ok' | 'fail' | 'checking'>('checking');
  const [target, setTarget] = useState<string>('');

  useEffect(() => {
    // Prefer same-origin proxy endpoint to check backend connectivity from the browser
    const url = `/api/health`;
    setTarget(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (r) => {
        if (r.ok) {
          setStatus('ok');
        } else {
          setStatus('fail');
        }
      })
      .catch(async () => {
        // Automatic fallback: try alternate loopback host
        try {
          const loc = window.location;
          const altHost = loc.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
          const alt = `${loc.protocol}//${altHost}:8000/health`;
          const altResp = await fetch(alt, { credentials: 'include' });
          if (altResp.ok) {
            // Persist override and reload to apply globally
            window.localStorage.setItem('aiser_api_base', `${loc.protocol}//${altHost}:8000`);
            setTarget(alt);
            setStatus('ok');
            // Soft reload so subsequent API calls use the override
            setTimeout(() => window.location.reload(), 200);
            return;
          }
        } catch {
          // ignore
        }
        setStatus('fail');
      })
      .finally(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);

  if (status !== 'fail' || shownOnce) return null;
  shownOnce = true;

  return (
    <div style={{ background: '#fff1f0', borderBottom: '1px solid #ffa39e', padding: '8px 12px', color: '#cf1322' }}>
      Backend not reachable at {target}. Please ensure chat2chart server is running (port 8000).
    </div>
  );
}


