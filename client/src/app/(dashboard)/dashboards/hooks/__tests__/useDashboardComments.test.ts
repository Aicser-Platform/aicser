import { describe, expect, it } from 'vitest';
import { mergeCommentEvent } from '../useDashboardComments';
import type { DashboardComment, DashboardCommentThread } from '../../utils/collaborationTypes';

const comment = (id: string, over: Partial<DashboardComment> = {}): DashboardComment => ({
  id,
  dashboard_id: 'd1',
  widget_id: null,
  parent_id: null,
  author: { id: 'u1', name: 'Alice' },
  body: `body ${id}`,
  deleted: false,
  edited_at: null,
  resolved_at: null,
  resolved_by: null,
  created_at: '2026-09-28T10:00:00Z',
  ...over,
});

const thread = (id: string, replies: DashboardComment[] = []): DashboardCommentThread => ({ ...comment(id), replies });

describe('mergeCommentEvent', () => {
  it('adds a new thread once, even when the socket echoes our own create', () => {
    let threads = mergeCommentEvent([], 'comment:created', comment('a'));
    threads = mergeCommentEvent(threads, 'comment:created', comment('a'));
    expect(threads.map((t) => t.id)).toEqual(['a']);
    expect(threads[0].replies).toEqual([]);
  });

  it('adds replies to their thread without duplicates', () => {
    const reply = comment('r', { parent_id: 'a' });
    let threads = mergeCommentEvent([thread('a')], 'comment:created', reply);
    threads = mergeCommentEvent(threads, 'comment:created', reply);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['r']);
  });

  it('updates a thread (resolve) and keeps its replies', () => {
    const threads = mergeCommentEvent(
      [thread('a', [comment('r', { parent_id: 'a' })])],
      'comment:updated',
      comment('a', { resolved_at: '2026-09-28T11:00:00Z' }),
    );
    expect(threads[0].resolved_at).toBe('2026-09-28T11:00:00Z');
    expect(threads[0].replies).toHaveLength(1);
  });

  it('removes a deleted reply, and leaves a placeholder for a deleted thread with replies', () => {
    const start = [thread('a', [comment('r', { parent_id: 'a' })]), thread('b')];
    let threads = mergeCommentEvent(start, 'comment:deleted', { id: 'a', parent_id: null });
    expect(threads[0]).toMatchObject({ id: 'a', deleted: true, body: '' });
    threads = mergeCommentEvent(threads, 'comment:deleted', { id: 'b', parent_id: null });
    expect(threads.map((t) => t.id)).toEqual(['a']);
    threads = mergeCommentEvent(threads, 'comment:deleted', { id: 'r', parent_id: 'a' });
    expect(threads[0].replies).toEqual([]);
  });

  it('ignores updates for threads it has not loaded', () => {
    expect(mergeCommentEvent([], 'comment:updated', comment('x'))).toEqual([]);
  });
});
