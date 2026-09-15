import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';
import { pipeTolerantStream } from '@/app/api/lib/streamProxy';

/** Tail a still-running analyze job after refresh or navigation. */
export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get('conversation_id');
    if (!conversationId) {
      return NextResponse.json({ success: false, error: 'conversation_id is required' }, { status: 400 });
    }
    const backendBase = getBackendUrlForApi();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    Object.assign(headers, buildProxyAuthHeaders(request));
    const url = new URL(`${backendBase}/ai/analyze/watch`);
    url.searchParams.set('conversation_id', conversationId);
    const response = await fetch(url.toString(), { method: 'GET', headers });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { success: false, error: `Backend error: ${response.status}`, details: errorText },
        { status: response.status },
      );
    }
    if (!response.body) {
      return NextResponse.json({ success: false, error: 'No response body' }, { status: 502 });
    }
    return new NextResponse(pipeTolerantStream(response.body), {
      status: response.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('AI analyze watch proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to watch in-flight run' },
      { status: 500 },
    );
  }
}
