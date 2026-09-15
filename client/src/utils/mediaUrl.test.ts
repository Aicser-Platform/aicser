import { describe, expect, it } from 'vitest';
import { isVideoMediaUrl } from './mediaUrl';

describe('isVideoMediaUrl', () => {
  it('detects common video extensions and data URLs', () => {
    expect(isVideoMediaUrl('/media/feed-thumbnails/chart.webm')).toBe(true);
    expect(isVideoMediaUrl('https://cdn.example.com/clip.mp4?token=1')).toBe(true);
    expect(isVideoMediaUrl('data:video/webm;base64,AAA')).toBe(true);
    expect(isVideoMediaUrl('/media/feed-thumbnails/chart.webp')).toBe(false);
    expect(isVideoMediaUrl(undefined)).toBe(false);
  });
});
