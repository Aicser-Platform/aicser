const PENDING_CHAT_CONTEXT_KEY = 'aiser_pending_chat_context';

export interface PendingChatContext {
  /** Text to insert into the chat composer on landing - never sent automatically. */
  prompt: string;
  /** A small sample of the actual result rows (not the full set - see writePendingChatContext),
   * so the AI has real values to work with immediately instead of re-running the query blind. */
  sampleRows?: Record<string, unknown>[];
  /** Total row count of the real result, distinct from sampleRows.length. */
  totalRowCount?: number;
}

const MAX_SAMPLE_ROWS = 20;

/**
 * Hand-off for "Ask AI about these results" (Query Editor, chart results,
 * etc.): previously the full SQL text was embedded directly in the /chat URL
 * via getChatHref({ prompt: ... }) - a query can reference sensitive
 * table/column names or literal values, and a URL query string ends up in
 * browser history, is visible in the address bar, and can be captured by any
 * proxy/CDN/server access log that records full request URLs (a real
 * exposure path many compliance frameworks explicitly flag). It's also
 * capped by practical URL length limits that a long analytical query can
 * exceed.
 *
 * sessionStorage avoids all of that, and - unlike a URL param - has room to
 * carry an actual sample of the query's result rows, not just column names,
 * so the destination chat starts from real data instead of asking the LLM to
 * blindly re-run the same query (extra cost/latency, and can return
 * different rows if the underlying data changed in between).
 *
 * window.open() to the same origin gives the new tab a same-origin copy of
 * the opener's sessionStorage at the moment it's created (see the HTML
 * spec's browsing-context storage rules) - reliable for this one-shot,
 * single-tab hand-off, the same guarantee chatFeedDraft.ts and
 * pendingFeedAttachment.ts already depend on for their own sessionStorage
 * hand-offs.
 */
export function writePendingChatContext(context: PendingChatContext): void {
  if (typeof window === 'undefined') return;
  try {
    const capped: PendingChatContext = {
      ...context,
      sampleRows: context.sampleRows?.slice(0, MAX_SAMPLE_ROWS),
    };
    sessionStorage.setItem(PENDING_CHAT_CONTEXT_KEY, JSON.stringify(capped));
  } catch {
    // ignore quota errors - the prompt still lands via the plain text fallback callers pass in the URL
  }
}

/** Reads and clears in one step - this is a one-shot hand-off, not durable state. */
export function consumePendingChatContext(): PendingChatContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PENDING_CHAT_CONTEXT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_CHAT_CONTEXT_KEY);
    return JSON.parse(raw) as PendingChatContext;
  } catch {
    return null;
  }
}
