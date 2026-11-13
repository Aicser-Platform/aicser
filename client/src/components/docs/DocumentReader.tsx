'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useLayoutEffect, useState } from 'react';
import { ZoomControl } from '@/components/office/ZoomControl';
import { documentExtensions } from '@/lib/docs/extensions';
import { PAGE_MARGINS, pageDimensions, type DocumentBody } from '@/lib/docs/model';
import { Pagination, setPageGeometry } from '@/lib/docs/pagination';
import { clampZoom } from '@/lib/office/zoom';

const PX_PER_MM = 96 / 25.4;
const PAGE_GAP = 24;

/** A document read-only, on the same pages as the editor (view links). */
export function DocumentReader({ body }: Readonly<{ body: DocumentBody }>) {
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(1);
  const editor = useEditor({
    extensions: [...documentExtensions({ placeholder: false }), Pagination],
    content: body.content,
    injectCSS: false,
    editable: false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'doc-content', 'aria-label': 'Document', 'aria-readonly': 'true' } },
  });
  const { widthMm, heightMm } = pageDimensions(body.page);
  const pageHeight = heightMm * PX_PER_MM;
  const margin = PAGE_MARGINS[body.page.margins].mm * PX_PER_MM;
  const stride = pageHeight + PAGE_GAP;
  useLayoutEffect(() => {
    if (editor) setPageGeometry(editor, { stride, contentHeight: pageHeight - 2 * margin }, setPages);
  }, [editor, stride, pageHeight, margin]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="doc-desk min-h-0 flex-1 overflow-auto bg-muted/60 py-8">
        <div style={{ zoom }} className="mx-auto w-fit">
          <div className="relative" style={{ width: `${widthMm}mm`, height: pages * stride - PAGE_GAP }}>
            {Array.from({ length: pages }, (_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="absolute inset-x-0 bg-white shadow-md"
                style={{ top: i * stride, height: pageHeight }}
              />
            ))}
            <div className="doc-page relative h-full text-black" style={{ padding: margin }}>
              <EditorContent editor={editor} className="h-full" />
            </div>
          </div>
        </div>
      </div>
      <footer className="flex items-center gap-4 border-t bg-background px-4 py-1 text-xs text-muted-foreground">
        <span>
          {pages} {pages === 1 ? 'page' : 'pages'}
        </span>
        <span className="ml-auto" />
        <ZoomControl zoom={zoom} onZoom={(z) => setZoom(clampZoom(z))} />
      </footer>
    </div>
  );
}
