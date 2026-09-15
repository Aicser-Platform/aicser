'use client';

import { useEffect } from 'react';
import { App } from 'antd';
import { setAntdMessageBridge } from '@/utils/antdMessageBridge';

/** Mount once inside <AntdApp> so non-component code can reach a theme-aware message instance via appMessage. */
export default function AntdMessageBridgeConnector() {
  const { message } = App.useApp();

  useEffect(() => {
    setAntdMessageBridge(message);
    return () => setAntdMessageBridge(null);
  }, [message]);

  return null;
}
