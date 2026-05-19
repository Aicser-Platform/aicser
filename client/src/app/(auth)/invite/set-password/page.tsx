import { notFound } from 'next/navigation';
import InviteSetPasswordRouteClient from './InviteSetPasswordRouteClient';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || process.env.EDITION || '').toLowerCase(),
);

export default function InviteSetPasswordRoute() {
  if (!isEnterpriseEdition) {
    notFound();
  }

  return <InviteSetPasswordRouteClient />;
}

