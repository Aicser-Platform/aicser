import type { PickedAttachment } from './AttachmentPicker';

const PENDING_FEED_ATTACHMENT_KEY = 'aiser_pending_feed_attachment';

/**
 * Hand-off for "Attach to a new post" from Chart Designer / Dashboards: the
 * snapshot is captured immediately (reusing the exact same
 * buildDashboardAttachmentSnapshot/buildChartAttachmentSnapshot + saved
 * chartId logic those pages already use for "Publish to Feed"), stashed
 * here, then the user is routed to /feed where NewPostComposer picks it up
 * on mount and drops it straight into the composer as a pending attachment -
 * so the author writes their own commentary around a chart/dashboard they
 * were just looking at, instead of first navigating to /feed and re-finding
 * it through the attachment picker's browse list.
 *
 * sessionStorage, not a query param: a snapshot payload (widget data, layout,
 * narrative) is too large to round-trip through a URL, and this hand-off is
 * inherently single-use / single-tab (same pattern as chatFeedDraft.ts).
 */
export function writePendingFeedAttachment(attachment: PickedAttachment): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PENDING_FEED_ATTACHMENT_KEY, JSON.stringify(attachment));
  } catch {
    // ignore quota errors — worst case the user just re-attaches from the picker
  }
}

/** Reads and clears in one step — this is a one-shot hand-off, not durable state. */
export function consumePendingFeedAttachment(): PickedAttachment | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PENDING_FEED_ATTACHMENT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_FEED_ATTACHMENT_KEY);
    return JSON.parse(raw) as PickedAttachment;
  } catch {
    return null;
  }
}
