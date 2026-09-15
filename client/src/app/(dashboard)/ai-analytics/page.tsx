'use client';

import { Spin } from 'antd';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy QA/debug surface — all NL analysis lives in AI Engine. */
export default function AIAnalyticsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/chat');
  }, [router]);

  return <Spin style={{ margin: 48 }} />;
}
