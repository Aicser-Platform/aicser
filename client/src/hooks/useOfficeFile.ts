import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/utils/api';
import type { OfficeFileSummary, OfficePatch, OfficeStore } from '@/lib/office/store';

export type OfficeSaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'readonly';

/** How long typing may pause before the change is written. */
const SAVE_DELAY_MS = 800;

/**
 * Loads one Docs / Slides file and autosaves edits: changes are merged into one pending write, saved after a short
 * pause (and on leaving the editor), one write at a time so an older body never lands after a newer one. Each save
 * carries the version it was made on; when the file changed elsewhere (409) saving stops until the user reloads.
 * Ported from the desktop app's useLocalItem (local workspace) to the server API.
 */
export function useOfficeFile<Body>(store: OfficeStore<Body>, id: string) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; error: Error }
    | { status: 'ready'; summary: OfficeFileSummary; title: string; body: Body }
  >({ status: 'loading' });
  const [saveState, setSaveState] = useState<OfficeSaveState>('saved');
  const [reloadKey, setReloadKey] = useState(0);
  const pendingRef = useRef<OfficePatch<Body> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writingRef = useRef<Promise<void> | null>(null);
  const versionRef = useRef(0);
  const blockedRef = useRef(false);

  useEffect(() => {
    let live = true;
    store.get(id).then(
      ({ summary, body }) => {
        if (!live) return;
        versionRef.current = summary.version;
        blockedRef.current = summary.role === 'view';
        pendingRef.current = null;
        setSaveState(summary.role === 'view' ? 'readonly' : 'saved');
        setState({ status: 'ready', summary, title: summary.title, body });
      },
      (error: unknown) => {
        if (live) setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) });
      }
    );
    return () => {
      live = false;
    };
  }, [store, id, reloadKey]);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Wait for the write in flight; whatever arrived meanwhile goes in the next one.
    while (writingRef.current) await writingRef.current;
    const patch = pendingRef.current;
    if (!patch || blockedRef.current) return;
    pendingRef.current = null;
    setSaveState('saving');
    const write = store.update(id, patch, versionRef.current).then(
      (summary) => {
        versionRef.current = summary.version;
        setState((s) => (s.status === 'ready' ? { ...s, summary: { ...s.summary, ...summary } } : s));
        if (!pendingRef.current) setSaveState('saved');
      },
      (error: unknown) => {
        // Keep the unsaved parts so the next edit (or Retry) writes them again.
        pendingRef.current = { ...patch, ...pendingRef.current };
        if (error instanceof ApiError && error.status === 409) {
          blockedRef.current = true;
          setSaveState('conflict');
        } else {
          setSaveState('error');
        }
      }
    );
    writingRef.current = write;
    await write;
    writingRef.current = null;
  }, [store, id]);

  const schedule = useCallback(
    (patch: OfficePatch<Body>) => {
      if (blockedRef.current) return;
      pendingRef.current = { ...pendingRef.current, ...patch };
      setSaveState('dirty');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush]
  );

  // Leaving the editor saves what is left.
  useEffect(() => () => void flush(), [flush]);

  // Closing the tab with unsaved changes asks first.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current && !blockedRef.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flush]);

  const setBody = useCallback(
    // The editor owns the body while it is open: only the write is scheduled (no re-render per keystroke).
    (body: Body, meta?: Record<string, unknown>) => {
      schedule(meta ? { body, meta } : { body });
    },
    [schedule]
  );

  const rename = useCallback(
    (title: string) => {
      setState((s) => (s.status === 'ready' ? { ...s, title } : s));
      // An empty title is shown while typing but not saved.
      if (title.trim()) schedule({ title: title.trim() });
    },
    [schedule]
  );

  return {
    state,
    saveState,
    setBody,
    rename,
    flush,
    reload: () => {
      setState({ status: 'loading' });
      setReloadKey((k) => k + 1);
    },
  };
}

export const SAVE_LABELS: Record<OfficeSaveState, string> = {
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Not saved: check your connection',
  conflict: 'Changed somewhere else: reload to keep editing',
  readonly: 'View only',
};
