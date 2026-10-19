/**
 * Shared helpers for /api/ai/analyze SSE payloads (copilot + tests).
 * Full chat UI uses consumeAnalyzeSSEStream + applyEvent; copilot uses these for a slim complete payload.
 */

export type AnalyzeStreamResult = {
  message?: string;
  narration?: string;
  executive_summary?: string;
  surface_actions?: unknown;
  dashboard_created?: unknown;
  error?: string;
};

export function partialResultsOf(payload: Record<string, unknown>): Record<string, unknown> {
  const pr = payload.partial_results;
  return pr && typeof pr === 'object' && !Array.isArray(pr)
    ? (pr as Record<string, unknown>)
    : payload;
}

export function pickAnalyzeSummary(payload: Record<string, unknown>): string {
  const pr = partialResultsOf(payload);
  return String(
    pr.message ||
      pr.narration ||
      pr.executive_summary ||
      pr.analysis ||
      pr.answer ||
      payload.message ||
      payload.narration ||
      '',
  );
}

export function isAnalyzeCompleteEvent(data: Record<string, unknown>): boolean {
  const typ = String(data.type || data.event_type || '');
  return typ === 'complete' || Boolean(data.workflow_complete);
}

export function analyzeCompleteFromEvent(data: Record<string, unknown>): AnalyzeStreamResult {
  const pr = partialResultsOf(data);
  return {
    message: pickAnalyzeSummary(data),
    narration: String(pr.narration || ''),
    executive_summary: String(pr.executive_summary || ''),
    surface_actions: pr.surface_actions ?? data.surface_actions,
    dashboard_created: pr.dashboard_created ?? data.dashboard_created,
  };
}

export function analyzeProgressMessage(data: Record<string, unknown>): string {
  const progress = data.progress;
  const prog =
    progress && typeof progress === 'object' && !Array.isArray(progress)
      ? (progress as Record<string, unknown>)
      : undefined;
  const typ = String(data.type || data.event_type || '');
  if (typ === 'progress' || typ === 'stage' || typ === 'node_start' || typ === 'node_complete') {
    return String(
      prog?.message ?? data.progress_message ?? data.message ?? data.progress_message ?? '',
    );
  }
  return '';
}

export function analyzeErrorFromEvent(data: Record<string, unknown>): string | null {
  const typ = String(data.type || data.event_type || '');
  if (typ === 'error' || data.error) {
    return String(data.error || data.message || 'Analyze failed');
  }
  return null;
}
