'use client';

import React from 'react';
import nextDynamic from 'next/dynamic';

const InviteSetPasswordPage = nextDynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.InviteSetPasswordPageEE }))) as any,
  { ssr: false },
) as React.ComponentType;

export default function InviteSetPasswordRouteClient() {
  return <InviteSetPasswordPage />;
}

