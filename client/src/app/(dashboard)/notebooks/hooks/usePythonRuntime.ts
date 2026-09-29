'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Pyodide release served from jsDelivr by default; set NEXT_PUBLIC_PYODIDE_URL to self-host
 * it (for air-gapped installs) — the folder that holds pyodide.js, ending in a slash. */
const PYODIDE_URL = process.env.NEXT_PUBLIC_PYODIDE_URL || 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';

export type Frame = { columns: string[]; rows: unknown[][]; row_count?: number };
export type FrameInfo = { name: string; rows: number; columns: string[] };
export type PythonRun = {
  stdout: string;
  result: ({ kind: 'table' } & Frame) | { kind: 'text'; text: string } | null;
  images: string[];
  duration_ms: number;
  frames: FrameInfo[];
};

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };
export type SourceInfo = { id: string; name: string; type?: string };
/** Does one allowed thing for aicser.* on the viewer's behalf (a query, a model or decision
 * call) and returns a JSON-serialisable result. */
export type DataLoader = (kind: string, payload: Record<string, unknown>) => Promise<unknown>;

/**
 * One Python session per open notebook, running in a Web Worker in the viewer's browser.
 * It starts on the first Python cell (the first start downloads Python and pandas, ~15 MB,
 * cached by the browser afterwards) and can be restarted if code runs away.
 */
export function usePythonRuntime() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const seq = useRef(0);
  const [status, setStatus] = useState<'off' | 'starting' | 'ready' | 'busy' | 'failed'>('off');
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const sentVersions = useRef(new Map<string, number>());
  const loaderRef = useRef<DataLoader | null>(null);

  const spawn = useCallback(() => {
    const worker = new Worker('/notebook/pyodide-worker.js');
    worker.onmessage = (event: MessageEvent) => {
      if (event.data?.op === 'data') {
        const { req, kind, payload } = event.data;
        const loader = loaderRef.current;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(payload || '{}'));
        } catch {
          /* answered below as an error */
        }
        (loader ? loader(String(kind), args) : Promise.reject(new Error('Data loading is not available here')))
          .then((result) => worker.postMessage({ op: 'data_reply', req, ok: true, json: JSON.stringify(result ?? null) }))
          .catch((e: unknown) => worker.postMessage({ op: 'data_reply', req, ok: false, error: e instanceof Error ? e.message : String(e) }));
        return;
      }
      const { id, ok, error, ...rest } = event.data || {};
      const p = pending.current.get(id);
      if (!p) return;
      pending.current.delete(id);
      if (ok) p.resolve(rest);
      else p.reject(new Error(String(error || 'Python failed')));
    };
    worker.onerror = () => setStatus('failed');
    workerRef.current = worker;
    sentVersions.current.clear();
    return worker;
  }, []);

  const call = useCallback(
    (op: string, payload: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const worker = workerRef.current ?? spawn();
        seq.current += 1;
        const id = seq.current;
        pending.current.set(id, { resolve, reject });
        worker.postMessage({ id, op, ...payload });
      }),
    [spawn],
  );

  const start = useCallback(async () => {
    if (status === 'ready' || status === 'busy') return;
    setStatus('starting');
    try {
      await call('init', { indexURL: PYODIDE_URL });
      setStatus('ready');
    } catch (err) {
      setStatus('failed');
      throw err;
    }
  }, [call, status]);

  /** Run code; ``inputs`` are query results to (re)load as DataFrames, with a version so an
   * unchanged result isn't copied again. */
  const run = useCallback(
    async (
      code: string,
      inputs: Record<string, Frame & { version: number }>,
      data?: { sources: SourceInfo[]; load: DataLoader },
    ): Promise<PythonRun> => {
      loaderRef.current = data?.load ?? null;
      if (status !== 'ready' && status !== 'busy') await start();
      const toSend: Record<string, Frame> = {};
      for (const [name, frame] of Object.entries(inputs)) {
        if (sentVersions.current.get(name) !== frame.version) toSend[name] = { columns: frame.columns, rows: frame.rows };
      }
      setStatus('busy');
      try {
        const out = (await call('run', { code, frames: toSend, sources: data?.sources })) as unknown as PythonRun;
        for (const [name, frame] of Object.entries(inputs)) sentVersions.current.set(name, frame.version);
        setFrames(out.frames || []);
        return out;
      } finally {
        setStatus('ready');
      }
    },
    [call, start, status],
  );

  const getFrame = useCallback(
    async (name: string, limit = 5000): Promise<Frame> => {
      const out = await call('get', { name, limit });
      return out.frame as Frame;
    },
    [call],
  );

  const restart = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    pending.current.forEach((p) => p.reject(new Error('Python was restarted')));
    pending.current.clear();
    setFrames([]);
    setStatus('off');
  }, []);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return { status, frames, start, run, getFrame, restart };
}
