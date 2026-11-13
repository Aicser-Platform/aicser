'use client';

import { ChevronLeft, ChevronRight, Loader2, NotebookText, WifiOff } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AicserUi } from '@/components/aicser-ui/scope';
import { Button } from '@/components/aicser-ui/button';
import { phoneApi, type PhoneView, type RemoteAction } from '@/lib/office/sharing';

const POLL_MS = 1200;

/**
 * The phone remote for a slide show presented on the web (desktop: the app's LAN page). Opened from the QR code in
 * Present mode; the token in the address is the only key, so it works without signing in, on any network, and
 * stops working when the slide show ends.
 */
export function PhoneRemote() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const [view, setView] = useState<PhoneView | null>(null);
  const [state, setState] = useState<'connecting' | 'live' | 'ended' | 'offline'>('connecting');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: PhoneView | null) => {
    if (next) {
      setView(next);
      setState('live');
    } else setState('ended');
  }, []);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await phoneApi.view(token);
        if (!live) return;
        apply(next);
        if (!next) return;
      } catch {
        if (live) setState((s) => (s === 'ended' ? s : 'offline'));
      }
      if (live) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [token, apply]);

  const press = async (action: RemoteAction) => {
    setBusy(true);
    try {
      apply(await phoneApi.press(token, action));
      navigator.vibrate?.(15);
    } catch {
      setState('offline');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AicserUi>
      <main className="flex h-dvh flex-col gap-4 bg-background p-4 text-foreground">
        <header className="flex items-center gap-2">
          <span className="text-sm font-semibold">Slide show remote</span>
          <span className="ml-auto text-sm text-muted-foreground" role="status">
            {state === 'live' && view ? `${view.index + 1} / ${view.total}` : null}
            {state === 'connecting' && 'Connecting…'}
            {state === 'offline' && 'Reconnecting…'}
          </span>
        </header>

        {state === 'ended' ? (
          <p role="alert" className="m-auto max-w-xs text-center text-sm text-muted-foreground">
            The slide show has ended. Scan the QR code again in Present mode to use your phone as a remote.
          </p>
        ) : state === 'connecting' ? (
          <p className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Connecting to the slide show…
          </p>
        ) : (
          <>
            {state === 'offline' && (
              <p className="m-0 flex items-center gap-2 text-xs text-destructive">
                <WifiOff className="size-4" aria-hidden="true" /> No connection. Trying again…
              </p>
            )}
            <h1 className="m-0 truncate text-lg font-semibold">{view?.title || 'Untitled slide'}</h1>
            <section
              aria-label="Speaker notes"
              className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card p-3 text-base whitespace-pre-wrap"
            >
              <p className="m-0 mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                <NotebookText className="size-3.5" aria-hidden="true" /> Speaker notes
              </p>
              {view?.notes.trim() ? (
                view.notes
              ) : (
                <span className="text-muted-foreground">No notes for this slide.</span>
              )}
            </section>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-20 text-base"
                disabled={busy || !view || view.index <= 0}
                onClick={() => void press('previous')}
              >
                <ChevronLeft className="size-6" /> Previous
              </Button>
              <Button
                className="h-20 text-base"
                disabled={busy || !view || view.index >= view.total - 1}
                onClick={() => void press('next')}
              >
                Next <ChevronRight className="size-6" />
              </Button>
            </div>
          </>
        )}
      </main>
    </AicserUi>
  );
}
