import { documentStore } from '@/lib/docs/model';
import { presentationStore } from '@/lib/slides/model';
import type { Report } from './report';

export type OfficeTarget = 'docs' | 'slides';

/** The detail that ties a Docs / Slides file to the report it was made from (one file per report and kind). */
export const reportSource = (conversationId: string, messageId: string) => `report:${conversationId}:${messageId}`;

/**
 * Opens the report as a Docs document or Slides presentation in the current project. The first time it is saved as
 * a new file (the person's own, private until shared; charts become pictures); after that the same file opens
 * again, with the person's edits, instead of a new copy each time (`source` ties them together). Returns where to
 * open it.
 */
export async function openReportInOffice(
  report: Report,
  target: OfficeTarget,
  projectId: string | null,
  source?: string
): Promise<string> {
  const store = target === 'docs' ? documentStore : presentationStore;
  const base = target === 'docs' ? '/docs' : '/slides';
  if (source) {
    const existing = (await store.list(projectId)).find((f) => f.isOwner && f.meta.source === source);
    if (existing) return `${base}/${encodeURIComponent(existing.id)}`;
  }
  const tag = (meta: Record<string, unknown>) => (source ? { ...meta, source } : meta);
  let created;
  if (target === 'docs') {
    const doc = (await import('./reportDocument')).reportToDocument(report);
    created = await documentStore.create({ ...doc, meta: tag(doc.meta) }, projectId);
  } else {
    const deck = (await import('./reportSlides')).reportToPresentation(report);
    created = await presentationStore.create({ ...deck, meta: tag(deck.meta) }, projectId);
  }
  return `${base}/${encodeURIComponent(created.id)}`;
}

/**
 * The chat shows reports in a sandboxed iframe that may not navigate the page around it, so it asks the chat page
 * with this message (same origin only) to open the new Docs / Slides file.
 */
export const OPEN_OFFICE_MESSAGE = 'aicser:open-office-file';

/** Only our own editor pages may be opened that way. */
export const isOfficeHref = (href: unknown): href is string =>
  typeof href === 'string' && /^\/(docs|slides)\/[A-Za-z0-9-]+$/.test(href);
