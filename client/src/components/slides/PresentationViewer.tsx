'use client';

import { Play } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/aicser-ui/button';
import { SLIDE_WIDTH, slideTitle, themeById, type PresentationBody } from '@/lib/slides/model';
import { PresentMode } from './PresentMode';
import { SlideView } from './SlideView';

/** A presentation read-only (view links): every slide in order, with its notes, and Present. */
export function PresentationViewer({ body }: Readonly<{ body: PresentationBody }>) {
  const theme = themeById(body.themeId);
  const [presenting, setPresenting] = useState<number | null>(null);
  const width = 720;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/60">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <div className="flex justify-end">
          <Button onClick={() => setPresenting(0)} disabled={!body.slides.length}>
            <Play /> Present
          </Button>
        </div>
        <ol className="m-0 flex list-none flex-col gap-6 p-0" aria-label="Slides">
          {body.slides.map((slide, i) => (
            <li key={slide.id} className="flex flex-col gap-2">
              <button
                type="button"
                aria-label={`Present from slide ${i + 1}${slideTitle(slide) ? `: ${slideTitle(slide)}` : ''}`}
                className="w-fit cursor-pointer overflow-hidden rounded-md border-0 bg-transparent p-0 shadow-md"
                onClick={() => setPresenting(i)}
              >
                <SlideView slide={slide} theme={theme} scale={width / SLIDE_WIDTH} className="pointer-events-none" />
              </button>
              <span className="text-xs text-muted-foreground">
                {i + 1} / {body.slides.length}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {presenting !== null && (
        <PresentMode slides={body.slides} theme={theme} start={presenting} onExit={() => setPresenting(null)} />
      )}
    </div>
  );
}
