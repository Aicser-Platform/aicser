'use client';

import { FileText, Loader2, Lock, Presentation } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AicserUi } from '@/components/aicser-ui/scope';
import { Button } from '@/components/aicser-ui/button';
import { TooltipProvider } from '@/components/aicser-ui/tooltip';
import { DocumentReader } from '@/components/docs/DocumentReader';
import { PresentationViewer } from '@/components/slides/PresentationViewer';
import { DocumentBodySchema, type DocumentBody } from '@/lib/docs/model';
import { openLink, type OpenResult } from '@/lib/office/sharing';
import { PresentationBodySchema, type PresentationBody } from '@/lib/slides/model';

type Shown =
  | { kind: 'document'; title: string; body: DocumentBody }
  | { kind: 'presentation'; title: string; body: PresentationBody };

function parse(result: Extract<OpenResult, { status: 'open' }>): Shown {
  const { kind, title, body } = result.link;
  return kind === 'document'
    ? { kind, title, body: DocumentBodySchema.parse(body) as DocumentBody }
    : { kind, title, body: PresentationBodySchema.parse(body) as PresentationBody };
}

/** A Docs document or Slides presentation opened from its view link: read only, nothing to edit. */
export function OfficeLinkPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const [state, setState] = useState<
    | { status: 'opening' }
    | { status: 'open'; shown: Shown }
    | { status: 'sign_in' }
    | { status: 'refused'; message: string }
  >({ status: 'opening' });

  useEffect(() => {
    let live = true;
    openLink(slug).then(
      (result) => {
        if (!live) return;
        if (result.status === 'open') {
          try {
            setState({ status: 'open', shown: parse(result) });
          } catch {
            setState({ status: 'refused', message: "This file couldn't be read." });
          }
        } else setState(result);
      },
      () => live && setState({ status: 'refused', message: "This link couldn't be opened. Check your connection." })
    );
    return () => {
      live = false;
    };
  }, [slug]);

  useEffect(() => {
    if (state.status === 'open') document.title = `${state.shown.title} · Aicser`;
  }, [state]);

  return (
    <AicserUi>
      <TooltipProvider>
        <div className="flex h-dvh flex-col bg-background text-foreground">
          {state.status === 'open' ? (
            <>
              <header className="flex items-center gap-2 border-b px-4 py-2">
                {state.shown.kind === 'document' ? (
                  <FileText className="size-5 text-file-doc" aria-hidden="true" />
                ) : (
                  <Presentation className="size-5 text-file-slides" aria-hidden="true" />
                )}
                <h1 className="m-0 truncate text-lg font-semibold">{state.shown.title}</h1>
                <span className="ml-auto text-xs text-muted-foreground">View only</span>
              </header>
              {state.shown.kind === 'document' ? (
                <DocumentReader body={state.shown.body} />
              ) : (
                <PresentationViewer body={state.shown.body} />
              )}
            </>
          ) : (
            <main className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center">
              {state.status === 'opening' && (
                <p role="status" className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening…
                </p>
              )}
              {state.status === 'sign_in' && (
                <>
                  <Lock className="size-6 text-muted-foreground" aria-hidden="true" />
                  <p className="m-0 text-sm">This link is for people in the organization. Sign in to open it.</p>
                  <Button asChild>
                    <a href={`/login?next=${encodeURIComponent(`/o/${slug}`)}`}>Sign in</a>
                  </Button>
                </>
              )}
              {state.status === 'refused' && (
                <>
                  <Lock className="size-6 text-muted-foreground" aria-hidden="true" />
                  <p role="alert" className="m-0 text-sm">
                    {state.message}
                  </p>
                </>
              )}
            </main>
          )}
        </div>
      </TooltipProvider>
    </AicserUi>
  );
}
