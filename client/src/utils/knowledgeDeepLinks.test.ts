import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeCitationHref,
  resolveCitationChunkId,
} from '@/utils/knowledgeDeepLinks';

describe('knowledgeDeepLinks', () => {
  it('builds href with document and chunk ids', () => {
    const href = buildKnowledgeCitationHref({
      documentId: 'doc-123',
      chunkId: 'chunk-456',
      libraryId: 'lib-789',
      excerpt: 'Refund policy allows returns within 30 days.',
      source: 'Policy.pdf',
    });
    expect(href).toContain('/knowledge?');
    expect(href).toContain('document_id=doc-123');
    expect(href).toContain('chunk_id=chunk-456');
    expect(href).toContain('library_id=lib-789');
    expect(href).toContain('from=citation');
    expect(href).toContain('tab=documents');
  });

  it('returns null without document id', () => {
    expect(buildKnowledgeCitationHref({ documentId: '' })).toBeNull();
  });

  it('resolves chunk id from chunk_ids array', () => {
    expect(resolveCitationChunkId({ chunk_ids: ['a', 'b'] })).toBe('a');
    expect(resolveCitationChunkId({ chunk_id: 'direct' })).toBe('direct');
  });
});

describe('createAnalyzeStreamSession', () => {
  it('accumulates events and builds complete payload', async () => {
    const { createAnalyzeStreamSession } = await import(
      '@/ee/app/(dashboard)/chat/hooks/useAnalyzeRun'
    );
    const session = createAnalyzeStreamSession();
    session.apply({
      type: 'progress',
      stage: 'nl2sql',
      message: 'Preparing query',
      percentage: 40,
    } as never);
    expect(session.getAccumulator().percentage).toBe(40);
    session.apply({
      type: 'complete',
      partial_results: { narration: 'Done', success: true },
    } as never);
    const complete = session.buildComplete('test query', 'fallback');
    expect(complete.query).toBe('test query');
    expect(complete.narration || complete.message).toBeTruthy();
  });
});
