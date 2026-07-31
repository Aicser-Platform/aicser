import { redirect } from 'next/navigation';
import ChatPageClient from './ChatPageClient';
import { isAiFrontendEnabled } from '@/utils/aiAvailability';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export default function ChatPage() {
  if (!isEE) redirect('/dashboards');
  if (!isAiFrontendEnabled()) redirect('/dashboards');
  return <ChatPageClient />;
}
