'use client';

import React, { useEffect, useState } from 'react';
import { Image, Skeleton } from 'antd';
import { useTranslations } from 'next-intl';
import { fetchApiBlob } from '@/utils/api';
import type { FeedImage } from '@/services/socialFeedService';

/**
 * One feed image. Images are served by an authorised endpoint (the post's own visibility),
 * and auth is a bearer token, so a plain <img src> can't load them — fetch as a blob instead.
 */
export function FeedImageView({ image, height }: { image: FeedImage; height?: number }) {
  const t = useTranslations('feed_page');
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setFailed(false);
    fetchApiBlob(image.url)
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
  }, [image.url]);

  const ratio = image.width && image.height ? `${image.width} / ${image.height}` : '16 / 9';
  if (failed) {
    return <div className="feed-image feed-image--failed">{t('image_unavailable')}</div>;
  }
  if (!src) {
    return (
      <div className="feed-image" style={{ aspectRatio: ratio, height }}>
        <Skeleton.Image active style={{ width: '100%', height: '100%' }} />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={image.alt || t('image_alt_default')}
      className="feed-image"
      style={{ objectFit: 'cover', width: '100%', height: height ?? '100%' }}
      rootClassName="feed-image-root"
    />
  );
}

/** Up to four images: one fills the width, more share a 2-column grid. */
export function FeedImages({ images, compact = false }: { images?: FeedImage[]; compact?: boolean }) {
  if (!images?.length) return null;
  const single = images.length === 1;
  return (
    <Image.PreviewGroup>
      <div
        className={compact ? 'px-3 pb-2' : 'px-4 pb-3'}
        style={{
          display: 'grid',
          gridTemplateColumns: single ? '1fr' : '1fr 1fr',
          gap: 6,
        }}
      >
        {images.map((img) => (
          <div key={img.id} style={{ borderRadius: 8, overflow: 'hidden', maxHeight: single ? 420 : 220 }}>
            <FeedImageView image={img} height={single ? undefined : 220} />
          </div>
        ))}
      </div>
    </Image.PreviewGroup>
  );
}

export default FeedImages;
