import { redirect } from 'next/navigation';
import ChatPageClient from './ChatPageClient';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export default function ChatPage() {
  if (!isEE) redirect('/dashboards');
  return <ChatPageClient />;
}
