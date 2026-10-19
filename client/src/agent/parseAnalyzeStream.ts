/**
 * Minimal SSE consumer for /api/ai/analyze (embedded copilot).
 * Uses the same line parser as full Ask (drainSSEBuffer).
 */

import {
  analyzeCompleteFromEvent,
  analyzeErrorFromEvent,
  analyzeProgressMessage,
  isAnalyzeCompleteEvent,
  pickAnalyzeSummary,
  type AnalyzeStreamResult,
} from '@/agent/analyzeStreamComplete';
import { drainSSEBuffer } from '@/utils/sseBuffer';

export type { AnalyzeStreamResult };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function processAnalyzeStreamEvent(
  raw: unknown,
  ctx: { lastProgress: string; onProgress?: (message: string) => void },
): { complete: AnalyzeStreamResult | null; lastProgress: string } {
  const data = asRecord(raw);
  if (!data) return { complete: null, lastProgress: ctx.lastProgress };

  let lastProgress = ctx.lastProgress;
  const progressMsg = analyzeProgressMessage(data);
  if (progressMsg && progressMsg !== lastProgress) {
    lastProgress = progressMsg;
    ctx.onProgress?.(progressMsg);
  }

  const err = analyzeErrorFromEvent(data);
  if (err) return { complete: { error: err }, lastProgress };

  if (isAnalyzeCompleteEvent(data)) {
    return { complete: analyzeCompleteFromEvent(data), lastProgress };
  }

  return { complete: null, lastProgress };
}

export async function consumeAnalyzeStream(
  response: Response,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
  },
): Promise<AnalyzeStreamResult> {
  if (!response.body) {
    const json = await response.json().catch(() => ({}));
    const rec = asRecord(json) ?? {};
    return {
      message: pickAnalyzeSummary(rec),
      dashboard_created: rec.dashboard_created,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastProgress = '';
  let complete: AnalyzeStreamResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        drainSSEBuffer(`${buffer}\n`, (raw) => {
          const out = processAnalyzeStreamEvent(raw, {
            lastProgress,
            onProgress: opts?.onProgress,
          });
          lastProgress = out.lastProgress;
          if (out.complete) complete = out.complete;
        });
      }
      break;
    }
    buffer = drainSSEBuffer(buffer + decoder.decode(value, { stream: true }), (raw) => {
      const out = processAnalyzeStreamEvent(raw, {
        lastProgress,
        onProgress: opts?.onProgress,
      });
      lastProgress = out.lastProgress;
      if (out.complete) complete = out.complete;
    });
    if (opts?.signal?.aborted) break;
  }

  return complete ?? { message: lastProgress || 'Done.' };
}
