'use client';

import { ChevronLeft, ChevronRight, Loader2, NotebookText, Smartphone, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/aicser-ui/button';
import { qrModules } from '@/lib/office/qr';
import { remoteApi } from '@/lib/office/sharing';
import { SLIDE_HEIGHT, SLIDE_WIDTH, slideTitle, type Slide, type Theme } from '@/lib/slides/model';
import { QrCode } from './QrCode';
import { SlideView } from './SlideView';

/** How often the presenting browser asks for the phone's presses. */
const REMOTE_POLL_MS = 700;

type Remote =
  | { status: 'starting' }
  | {
      status: 'ready';
      sessionId: string;
      url: string;
      qr: { size: number; modules: string };
      connected: boolean;
      showQr: boolean;
    }
  | { status: 'failed'; message: string };

/**
 * Presenting: the page goes full screen (browser Fullscreen API) and shows one slide at a time on black.
 * → / Space / Page Down / click = next, ← / Page Up = previous, Home / End, Esc = stop. A number then Enter jumps
 * to that slide (as in PowerPoint). S shows / hides the speaker notes under the slide.
 * R (or the phone button) starts the phone remote when `fileId` is given (signed in, the file's own page): a QR code
 * the phone scans to get Previous / Next and this slide's notes. Unlike the desktop app's LAN page it goes through the
 * server, so the phone can be on any network. It stops when the slide show ends.
 */
export function PresentMode({
  slides,
  theme,
  start,
  onExit,
  fileId,
}: Readonly<{ slides: Slide[]; theme: Theme; start: number; onExit: (index: number) => void; fileId?: string }>) {
  const [index, setIndex] = useState(Math.min(start, slides.length - 1));
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [showNotes, setShowNotes] = useState(false);
  const [remote, setRemote] = useState<Remote | null>(null);
  const remoteRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef('');
  const rootRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLElement>(null);
  const indexRef = useRef(index);
  const onExitRef = useRef(onExit);
  useLayoutEffect(() => {
    indexRef.current = index;
    onExitRef.current = onExit;
  });

  useEffect(() => {
    const root = rootRef.current;
    root?.focus();
    // Best effort: if the browser refuses, presenting still fills the window.
    root?.requestFullscreen?.().catch(() => undefined);
    // Leaving full screen with the browser's own Esc ends the slide show too.
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onExitRef.current(indexRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useLayoutEffect(() => {
    const fit = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const go = (next: number) => setIndex(Math.max(0, Math.min(slides.length - 1, next)));
  const slide = slides[index];

  const openRemote = () => {
    if (!fileId) return;
    if (remote?.status === 'ready') {
      setRemote({ ...remote, showQr: !remote.showQr });
      return;
    }
    if (remote?.status === 'starting') return;
    setRemote({ status: 'starting' });
    remoteApi.start(fileId).then(
      (started) => {
        const url = `${window.location.origin}${started.path}`;
        setRemote({
          status: 'ready',
          sessionId: started.session_id,
          url,
          qr: qrModules(url),
          connected: false,
          showQr: true,
        });
      },
      (error: unknown) =>
        setRemote({
          status: 'failed',
          message: `The phone remote couldn't start: ${error instanceof Error ? error.message : String(error)}`,
        })
    );
  };

  // While the remote is on: collect the phone's presses, and end it with the slide show.
  const sessionId = remote?.status === 'ready' ? remote.sessionId : null;
  useEffect(() => {
    if (!fileId || !sessionId) return;
    let live = true;
    let after = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { commands, connected } = await remoteApi.commands(fileId, sessionId, after);
        if (!live) return;
        for (const c of commands) {
          after = Math.max(after, c.seq);
          setIndex((i) => Math.max(0, Math.min(slides.length - 1, i + (c.action === 'next' ? 1 : -1))));
        }
        // The QR code goes away once the phone has connected.
        setRemote((r) =>
          r?.status === 'ready' && r.connected !== connected
            ? { ...r, connected, showQr: connected ? false : r.showQr }
            : r
        );
      } catch {
        // A missed poll is retried; the slide show goes on.
      }
      if (live) timer = setTimeout(() => void poll(), REMOTE_POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
      void remoteApi.end(fileId, sessionId).catch(() => undefined);
    };
  }, [fileId, sessionId, slides.length]);

  // The phone shows the slide on screen (number, title, notes).
  useEffect(() => {
    if (!fileId || !sessionId || !slide) return;
    void remoteApi
      .report(fileId, sessionId, { index, total: slides.length, title: slideTitle(slide), notes: slide.notes })
      .catch(() => undefined);
  }, [fileId, sessionId, index, slide, slides.length]);
  // The notes panel takes the bottom of the screen; the slide shrinks to fit above it.
  const notesHeight = showNotes ? Math.round(size.height * 0.25) : 0;
  const scale = Math.min(size.width / SLIDE_WIDTH, (size.height - notesHeight) / SLIDE_HEIGHT);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Presenting"
      tabIndex={-1}
      className="group fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-black outline-none"
      // A click advances, except in the notes (reading or scrolling them) or the phone remote panel.
      onClick={(e) => {
        const target = e.target as Node;
        if (notesRef.current?.contains(target) || remoteRef.current?.contains(target)) return;
        go(index + 1);
      }}
      onKeyDown={(e) => {
        const k = e.key;
        // Esc first closes the QR panel, then ends the slide show.
        if (k === 'Escape' && remote && (remote.status !== 'ready' || remote.showQr))
          setRemote(remote.status === 'ready' ? { ...remote, showQr: false } : null);
        else if (k === 'Escape') onExit(index);
        else if ((k === 'r' || k === 'R') && fileId) openRemote();
        else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'n'].includes(k)) go(index + 1);
        else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) go(index - 1);
        else if (k === 'Home') go(0);
        else if (k === 'End') go(slides.length - 1);
        else if (k === 's' || k === 'S') setShowNotes((v) => !v);
        else if (/^\d$/.test(k)) {
          typedRef.current += k;
          return;
        } else if (k === 'Enter' && typedRef.current) go(Number(typedRef.current) - 1);
        else return;
        typedRef.current = '';
        e.preventDefault();
      }}
    >
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {slide && <SlideView slide={slide} theme={theme} scale={scale} />}
      </div>
      {showNotes && (
        <section
          ref={notesRef}
          aria-label="Speaker notes"
          className="w-full shrink-0 overflow-y-auto border-t border-white/20 bg-neutral-900 px-8 py-4 text-lg whitespace-pre-wrap text-white"
          style={{ height: notesHeight }}
        >
          {slide?.notes.trim() ? slide.notes : <span className="text-white/60">No notes for this slide.</span>}
        </section>
      )}
      {remote && (remote.status !== 'ready' || remote.showQr) && (
        <div
          ref={remoteRef}
          role="region"
          aria-label="Phone remote"
          className="absolute top-6 right-6 flex w-72 flex-col items-center gap-3 rounded-xl bg-neutral-900/95 p-5 text-center text-sm text-white shadow-lg"
        >
          {remote.status === 'starting' && (
            <p className="m-0 flex items-center gap-2" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Starting the phone remote…
            </p>
          )}
          {remote.status === 'failed' && (
            <p role="alert" className="m-0 text-white/90">
              {remote.message}
            </p>
          )}
          {remote.status === 'ready' && (
            <>
              <p className="m-0 font-medium">Scan with your phone</p>
              <QrCode
                size={remote.qr.size}
                modules={remote.qr.modules}
                label="QR code for the phone remote"
                className="size-52 rounded-md"
              />
              <p className="m-0 text-xs text-white/70">
                Works on any network. Use Previous / Next and read your notes on the phone. It stops when the slide show
                ends.
              </p>
            </>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRemote(remote.status === 'ready' ? { ...remote, showQr: false } : null)}
          >
            Close
          </Button>
        </div>
      )}
      <div
        className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-sm text-white opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ bottom: notesHeight + 16 }}
        role="toolbar"
        aria-label="Slide show"
      >
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-white"
          aria-label="Previous slide"
          onClick={() => go(index - 1)}
        >
          <ChevronLeft />
        </Button>
        <span role="status">
          {index + 1} / {slides.length}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-white"
          aria-label="Next slide"
          onClick={() => go(index + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-white"
          aria-label={showNotes ? 'Hide speaker notes (S)' : 'Show speaker notes (S)'}
          aria-pressed={showNotes}
          onClick={() => setShowNotes((v) => !v)}
        >
          <NotebookText />
        </Button>
        {fileId && (
          <Button
            size="icon-xs"
            variant="ghost"
            className={remote?.status === 'ready' && remote.connected ? 'text-green-400' : 'text-white'}
            aria-label={
              remote?.status === 'ready' && remote.connected ? 'Phone remote connected (R)' : 'Phone remote (R)'
            }
            aria-pressed={remote?.status === 'ready' && remote.showQr}
            onClick={openRemote}
          >
            <Smartphone />
          </Button>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-white"
          aria-label="End slide show"
          onClick={() => onExit(index)}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
