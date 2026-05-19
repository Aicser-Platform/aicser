'use client';

import React from 'react';
import nextDynamic from 'next/dynamic';

const InviteAcceptPage = nextDynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.InviteAcceptPageEE }))) as any,
  { ssr: false },
) as React.ComponentType;

export default function InviteAcceptRouteClient() {
  return <InviteAcceptPage />;
}

