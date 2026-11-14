'use client';

import { useParams } from 'next/navigation';
import { DocumentEditor } from '@/components/docs/DocumentEditor';

export default function DocumentPage() {
  const params = useParams<{ documentId: string }>();
  const documentId = params?.documentId ?? '';
  // key: another document starts with a fresh editor, history and save state.
  return <DocumentEditor key={documentId} documentId={documentId} />;
}
