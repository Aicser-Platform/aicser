import { describe, expect, it } from 'vitest';
import {
  isSameFeedAuthor,
  normalizeFeedHandle,
  resolveFeedAuthorAvatar,
  resolveFeedAuthorName,
} from './resolveFeedAuthorDisplay';

describe('resolveFeedAuthorDisplay', () => {
  it('normalizes handles with or without @', () => {
    expect(normalizeFeedHandle('@Jane')).toBe('jane');
    expect(normalizeFeedHandle('Jane')).toBe('jane');
  });

  it('matches author by id or username', () => {
    expect(isSameFeedAuthor({ id: '1', username: 'a' }, '1', 'b')).toBe(true);
    expect(isSameFeedAuthor({ id: '2', username: 'jane' }, '9', '@Jane')).toBe(true);
    expect(isSameFeedAuthor({ id: '2', username: 'bob' }, '9', 'jane')).toBe(false);
  });

  it('prefers live viewer avatar for own posts', () => {
    expect(
      resolveFeedAuthorAvatar({
        author: { id: 'u1', username: 'me', avatarUrl: 'https://old/avatar.png' },
        viewerId: 'u1',
        viewerAvatarUrl: 'https://new/avatar.png',
      }),
    ).toBe('https://new/avatar.png');
  });

  it('keeps other authors avatar from feed payload', () => {
    expect(
      resolveFeedAuthorAvatar({
        author: { id: 'u2', avatarUrl: 'https://them/a.png' },
        viewerId: 'u1',
        viewerAvatarUrl: 'https://me/a.png',
      }),
    ).toBe('https://them/a.png');
  });

  it('prefers live viewer display name for own posts', () => {
    expect(
      resolveFeedAuthorName({
        author: { id: 'u1', name: 'Old Name' },
        viewerId: 'u1',
        viewerDisplayName: 'New Name',
      }),
    ).toBe('New Name');
  });
});
