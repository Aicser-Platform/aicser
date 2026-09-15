import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/** Snapshot of a still-running analyze job (progress UI after refresh). */
export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get('conversation_id');
    if (!conversationId) {
      return NextResponse.json({ success: false, error: 'conversation_id is required' }, { status: 400 });
    }
    const backendBase = getBackendUrlForApi();
    const headers: Record<string, string> = { Accept: 'application/json' };
    Object.assign(headers, buildProxyAuthHeaders(request));
    const url = new URL(`${backendBase}/ai/analyze/inflight`);
    url.searchParams.set('conversation_id', conversationId);
    const response = await fetch(url.toString(), { method: 'GET', headers });
    const body = await response.json().catch(() => ({ success: false }));
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error('AI analyze inflight proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch in-flight status' },
      { status: 500 },
    );
  }
}
