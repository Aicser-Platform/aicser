'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OfficeFilesPage } from '@/components/office/OfficeFilesPage';
import { blankDocument, documentStore } from '@/lib/docs/model';
import { importDocx } from '@/lib/office/imports';

function DocsList() {
  const router = useRouter();
  // `?deleted=<id>`: a document was just deleted from inside it, so the list offers Undo.
  const params = useSearchParams();
  const deleted = params?.get('deleted');
  // `?review=1`: opened from an approval notice.
  const review = params?.get('review') === '1';
  const clearDeleted = useCallback(() => router.replace('/docs'), [router]);
  return (
    <OfficeFilesPage
      store={documentStore}
      noun="document"
      title="Docs"
      description="Write documents like in Word: headings, fonts (English and Khmer), lists, tables and images. Open and save .docx files."
      fileType="doc"
      blank={blankDocument}
      importFile={{ label: 'Open .docx', extension: 'docx', run: importDocx }}
      open={(id) => router.push(`/docs/${encodeURIComponent(id)}`)}
      details={(item) => (typeof item.meta.words === 'number' ? `${item.meta.words} words` : null)}
      deleted={deleted}
      clearDeleted={clearDeleted}
      review={review}
    />
  );
}

export default function DocsPage() {
  return (
    <Suspense fallback={null}>
      <DocsList />
    </Suspense>
  );
}
