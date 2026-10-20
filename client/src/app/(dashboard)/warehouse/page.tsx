'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy URL — canonical lakehouse hub is `/lakehouse`. */
export default function WarehouseAliasPage() {
  const router = useRouter();
  useEffect(() => {
    const path = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/lakehouse';
    const target = path.replace(/^\/warehouse/, '/lakehouse');
    router.replace(target);
  }, [router]);
  return null;
}
