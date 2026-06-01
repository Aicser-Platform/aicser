import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';
import { pipeTolerantStream } from '@/app/api/lib/streamProxy';

/**
 * Unified proxy for backend POST /ai/analyze.
 * Single entry point: stream=true (default) for SSE, stream=false for JSON.
 * Replaces /api/ai/chat/analyze and /api/ai/chat/analyze/stream.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.ai_model && !body.model) {
      body.model = body.ai_model;
      delete body.ai_model;
    }

    const stream = body.stream !== false;
    const backendBase = getBackendUrlForApi();
    const url = new URL(`${backendBase}/ai/analyze`);
    url.searchParams.set('stream', String(stream));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (stream) {
      headers['Accept'] = 'text/event-stream';
    }

    Object.assign(headers, buildProxyAuthHeaders(request));

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Forward JSON error responses from backend as-is (preserves structured error details)
      const errContentType = response.headers.get('content-type') || '';
      if (errContentType.includes('application/json')) {
        try {
          const errorJson = await response.json();
          return NextResponse.json(errorJson, { status: response.status });
        } catch {
          // Fall through to text handling
        }
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { success: false, error: `Backend error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    if (stream) {
      if (!response.body) {
        return NextResponse.json({ success: false, error: 'No response body' }, { status: 502 });
      }
      const tolerantBody = pipeTolerantStream(response.body);
      return new NextResponse(tolerantBody, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('AI analyze proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to proxy analyze request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
