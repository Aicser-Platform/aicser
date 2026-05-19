import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEChatPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.ChatPage })),
  { ssr: false }
);

export default function ChatPage() {
  if (!isEE) redirect('/dashboards');
  return <EEChatPage />;
}
