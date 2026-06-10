'use client';

import { Spin } from 'antd';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** AI Search lives in AI Engine mode selector — legacy route redirects to chat. */
export default function AISearchRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/chat?mode=ai_search');
  }, [router]);

  return <Spin style={{ margin: 48 }} />;
}
