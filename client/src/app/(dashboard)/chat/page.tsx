import { redirect } from 'next/navigation';
import ChatPageClient from './ChatPageClient';
import { isAiFrontendEnabled } from '@/utils/aiAvailability';

import { isEnterpriseEdition } from '@/utils/appPaths';

const isEE = isEnterpriseEdition();

export default function ChatPage() {
  if (!isEE) redirect('/dashboards');
  if (!isAiFrontendEnabled()) redirect('/dashboards');
  return <ChatPageClient />;
}
