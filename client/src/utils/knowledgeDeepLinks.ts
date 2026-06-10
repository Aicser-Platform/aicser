/**
 * Deep links from chat citations → Knowledge module.
 */

export type KnowledgeCitationLinkParams = {
  documentId: string;
  chunkId?: string;
  dataSourceId?: string;
  libraryId?: string;
  excerpt?: string;
  source?: string;
  pages?: string;
};

export function buildKnowledgeCitationHref(params: KnowledgeCitationLinkParams): string | null {
  const documentId = params.documentId?.trim();
  if (!documentId) return null;

  const q = new URLSearchParams();
  q.set('document_id', documentId);
  if (params.chunkId) q.set('chunk_id', params.chunkId);
  if (params.libraryId) q.set('library_id', params.libraryId);
  else if (params.dataSourceId) q.set('data_source_id', params.dataSourceId);
  if (params.excerpt?.trim()) {
    q.set('excerpt', params.excerpt.trim().slice(0, 240));
  }
  if (params.source?.trim()) q.set('source', params.source.trim().slice(0, 120));
  if (params.pages?.trim()) q.set('pages', params.pages.trim().slice(0, 40));
  q.set('tab', 'documents');
  q.set('from', 'citation');
  return `/knowledge?${q.toString()}`;
}

export function resolveCitationChunkId(citation: {
  chunk_id?: string;
  chunk_ids?: string[];
}): string | undefined {
  if (citation.chunk_id) return citation.chunk_id;
  const ids = citation.chunk_ids;
  if (Array.isArray(ids) && ids.length > 0) return ids[0];
  return undefined;
}
