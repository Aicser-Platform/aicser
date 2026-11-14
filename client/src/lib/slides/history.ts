// Undo / redo for the Slides editor: whole-presentation snapshots (bodies are small apart from pictures, and
// pictures are shared between snapshots, not copied). Consecutive edits with the same `merge` key (typing in the
// notes, nudging with the arrow keys) within a second become one step.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastMerge: { key: string; at: number } | null;
}

const LIMIT = 100;
const MERGE_MS = 1000;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], lastMerge: null });

export function commit<T>(h: History<T>, next: T, merge?: string, now = Date.now()): History<T> {
  if (next === h.present) return h;
  const merging = merge && h.lastMerge?.key === merge && now - h.lastMerge.at < MERGE_MS;
  return {
    past: merging ? h.past : [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: [],
    lastMerge: merge ? { key: merge, at: now } : null,
  };
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future], lastMerge: null };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest, lastMerge: null };
}
