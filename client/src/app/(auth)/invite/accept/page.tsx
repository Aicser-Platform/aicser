import { notFound } from 'next/navigation';
import InviteAcceptRouteClient from './InviteAcceptRouteClient';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || process.env.EDITION || '').toLowerCase(),
);

export default function AcceptInviteRoute() {
  if (!isEnterpriseEdition) {
    notFound();
  }

  return <InviteAcceptRouteClient />;
}

