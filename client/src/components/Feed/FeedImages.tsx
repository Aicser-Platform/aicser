'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogTitle } from '@/components/aicser-ui/dialog';
import { AicserUi } from '@/components/aicser-ui/scope';
import { Skeleton } from '@/components/aicser-ui/skeleton';
import { cn } from '@/lib/ui/utils';
import { fetchApiBlob } from '@/utils/api';
import type { FeedImage } from '@/services/socialFeedService';

/** Loads an image from the authorised endpoint: auth is a bearer token, so a plain <img src> can't load it. */
function useImageBlob(url: string) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setSrc(null);
    fetchApiBlob(url)
      .then(({ blob }) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => !revoked && setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return { src, failed };
}

/** One feed image; clicking it opens it full size. */
export function FeedImageView({ image, height }: { image: FeedImage; height?: number }) {
  const t = useTranslations('feed_page');
  const { src, failed } = useImageBlob(image.url);
  const [open, setOpen] = useState(false);
  const ratio = image.width && image.height ? `${image.width} / ${image.height}` : '16 / 9';
  const alt = image.alt || t('image_alt_default');

  return (
    <AicserUi>
      {failed ? (
        <div
          className="feed-image feed-image--failed flex items-center justify-center bg-muted p-4 text-xs text-muted-foreground"
          style={{ aspectRatio: ratio, height }}
        >
          {t('image_unavailable')}
        </div>
      ) : !src ? (
        <Skeleton className="feed-image w-full rounded-none" style={{ aspectRatio: ratio, height }} />
      ) : (
        <>
          <button
            type="button"
            className="block w-full cursor-zoom-in border-0 bg-transparent p-0"
            onClick={() => setOpen(true)}
            aria-label={alt}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL from an authorised fetch */}
            <img
              src={src}
              alt={alt}
              className="feed-image block w-full object-cover"
              style={{ height: height ?? '100%' }}
            />
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-[min(96vw,1200px)] p-2 sm:max-w-[min(96vw,1200px)]">
              <DialogTitle className="sr-only">{alt}</DialogTitle>
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL from an authorised fetch */}
              <img src={src} alt={alt} className="max-h-[85vh] w-full rounded-lg object-contain" />
            </DialogContent>
          </Dialog>
        </>
      )}
    </AicserUi>
  );
}

/** Up to four images: one fills the width, more share a 2-column grid. */
export function FeedImages({ images, compact = false }: { images?: FeedImage[]; compact?: boolean }) {
  if (!images?.length) return null;
  const single = images.length === 1;
  return (
    <AicserUi>
      <div className={cn('grid gap-1.5', single ? 'grid-cols-1' : 'grid-cols-2', compact ? 'px-4 pb-2' : 'px-4 pb-3')}>
        {images.map((img) => (
          <div key={img.id} className="overflow-hidden rounded-lg" style={{ maxHeight: single ? 420 : 220 }}>
            <FeedImageView image={img} height={single ? undefined : 220} />
          </div>
        ))}
      </div>
    </AicserUi>
  );
}

export default FeedImages;
