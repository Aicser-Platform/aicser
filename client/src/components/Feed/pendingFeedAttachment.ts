import type { PickedAttachment } from './AttachmentPicker';

const PENDING_FEED_ATTACHMENT_KEY = 'aiser_pending_feed_attachment';

/**
 * Hand-off from Share to Feed → "Add a note on Feed": the snapshot is already
 * captured in PublishToFeedModal / FeedPublishComposer, stashed here, then
 * /feed's NewPostComposer picks it up on mount. sessionStorage (not a query
 * param) because snapshot payloads are too large for URLs.
 *
 * Returns false when nothing could be stored (quota / private mode). Callers
 * should surface an error instead of navigating to an empty composer.
 * On quota pressure we retry without snapshot_payload — the feed attach API
 * rebuilds from the live asset when needed.
 */
export function writePendingFeedAttachment(attachment: PickedAttachment): boolean {
  if (typeof window === 'undefined') return false;

  const tryWrite = (payload: PickedAttachment): boolean => {
    try {
      sessionStorage.setItem(PENDING_FEED_ATTACHMENT_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  if (tryWrite(attachment)) return true;

  // Drop heavy snapshot; keep asset identity so the server can rebuild.
  if (attachment.snapshot_payload != null) {
    const slim: PickedAttachment = {
      ...attachment,
      snapshot_payload: null,
    };
    if (tryWrite(slim)) return true;
  }

  return false;
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
