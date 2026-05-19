"use client";

import React, { useEffect, useState } from "react";

export default function ClientDebugOverlay() {
    const [visible, setVisible] = useState<boolean>(false);
    const [data, setData] = useState<Record<string, any>>({});

    useEffect(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            const show = params.get('debug') === '1' || localStorage.getItem('show_debug_overlay') === '1';
            setVisible(show);
        } catch {}
    }, []);

    useEffect(() => {
        if (!visible) return;
        const keys = ['last_login_at', 'last_logout_at', 'last_auth_check', 'last_auth_error', 'aiser_user'];
        const obj: Record<string, any> = {};
        for (const k of keys) {
            try { obj[k] = localStorage.getItem(k); } catch { obj[k] = null; }
        }
        setData(obj);
    }, [visible]);

    if (!visible) return null;

    return (
        <div style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 9999, width: 360, maxHeight: '60vh', overflow: 'auto', background: 'rgba(0,0,0,0.8)', color: '#fff', padding: 12, borderRadius: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>Client Debug</strong>
                <button onClick={() => { setVisible(false); try { localStorage.setItem('show_debug_overlay','0'); } catch {} }} style={{ background: 'transparent', color: '#fff', border: 'none' }}>Close</button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>
        </div>
    );
}


