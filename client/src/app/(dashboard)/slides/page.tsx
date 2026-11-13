'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OfficeFilesPage } from '@/components/office/OfficeFilesPage';
import { importPptx } from '@/lib/office/imports';
import { blankPresentation, presentationStore } from '@/lib/slides/model';

function SlidesList() {
  const router = useRouter();
  // `?deleted=<id>`: a presentation was just deleted from inside it, so the list offers Undo.
  const params = useSearchParams();
  const deleted = params?.get('deleted');
  // `?review=1`: opened from an approval notice.
  const review = params?.get('review') === '1';
  const clearDeleted = useCallback(() => router.replace('/slides'), [router]);
  return (
    <OfficeFilesPage
      store={presentationStore}
      noun="presentation"
      title="Slides"
      description="Make presentations like in PowerPoint: layouts, themes, text, shapes and pictures, then present full screen. Open and save .pptx files."
      fileType="slides"
      blank={blankPresentation}
      importFile={{ label: 'Open .pptx', extension: 'pptx', run: importPptx }}
      open={(id) => router.push(`/slides/${encodeURIComponent(id)}`)}
      details={(item) =>
        typeof item.meta.slides === 'number' ? `${item.meta.slides} slide${item.meta.slides === 1 ? '' : 's'}` : null
      }
      deleted={deleted}
      clearDeleted={clearDeleted}
      review={review}
    />
  );
}

export default function SlidesPage() {
  return (
    <Suspense fallback={null}>
      <SlidesList />
    </Suspense>
  );
}
