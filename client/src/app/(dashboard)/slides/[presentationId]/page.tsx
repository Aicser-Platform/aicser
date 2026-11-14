'use client';

import { useParams } from 'next/navigation';
import { PresentationEditor } from '@/components/slides/PresentationEditor';

export default function PresentationPage() {
  const params = useParams<{ presentationId: string }>();
  const presentationId = params?.presentationId ?? '';
  // key: another presentation starts with a fresh editor, history and save state.
  return <PresentationEditor key={presentationId} presentationId={presentationId} />;
}
