import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/** Cancel an orphaned in-flight analyze run (Stop button). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const conversationId = body.conversation_id;
    if (!conversationId) {
      return NextResponse.json({ success: false, error: 'conversation_id is required' }, { status: 400 });
    }
    const backendBase = getBackendUrlForApi();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    Object.assign(headers, buildProxyAuthHeaders(request));
    const response = await fetch(`${backendBase}/ai/analyze/inflight/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversation_id: conversationId }),
    });
    const json = await response.json().catch(() => ({ success: false }));
    return NextResponse.json(json, { status: response.status });
  } catch (error) {
    console.error('AI analyze inflight cancel proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to cancel in-flight run' },
      { status: 500 },
    );
  }
}
