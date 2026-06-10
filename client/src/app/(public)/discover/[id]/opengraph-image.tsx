import { ImageResponse } from 'next/og';
import { fetchPublicFeedItemMeta } from '@/lib/publicFeedApi';

export const runtime = 'edge';
export const alt = 'Aicser Discover insight';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Props = { params: { id: string } };

export default async function DiscoverOpenGraphImage({ params }: Props) {
  const item = await fetchPublicFeedItemMeta(params.id);
  const title = item?.title?.trim() || 'Public data insight';
  const author = item?.author?.name || item?.author?.username || 'Aicser creator';
  const description =
    item?.description?.trim()?.slice(0, 140) ||
    'Trusted snapshot shared on Aicser Discover — explore dashboards, charts, and AI answers.';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 45%, #0ea5e9 100%)',
          color: '#f8fafc',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            A
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, opacity: 0.95 }}>Aicser Discover</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 960 }}>
          <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.15, letterSpacing: -1 }}>{title}</div>
          <div style={{ fontSize: 26, lineHeight: 1.4, opacity: 0.88 }}>{description}</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 22 }}>
          <span style={{ opacity: 0.85 }}>by {author}</span>
          <span
            style={{
              padding: '10px 20px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.18)',
              fontWeight: 600,
            }}
          >
            Snapshot · Trusted public insight
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
