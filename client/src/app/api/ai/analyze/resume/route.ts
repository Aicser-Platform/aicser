import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';
import { pipeTolerantStream } from '@/app/api/lib/streamProxy';

/**
 * Canonical resume endpoint for human-in-the-loop clarification.
 * Proxies to backend POST /ai/analyze/resume.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      conversation_id,
      resume,
      query,
      data_source_id,
      kb_data_source_id,
      analytics_type,
      analysis_mode,
      model,
    } = body;

    if (!conversation_id) {
      return NextResponse.json(
        { success: false, error: 'conversation_id is required' },
        { status: 400 }
      );
    }

    const backendBase = getBackendUrlForApi();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };

    Object.assign(headers, buildProxyAuthHeaders(request));

    const response = await fetch(`${backendBase}/ai/analyze/resume`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversation_id,
        resume: resume !== undefined && resume !== null ? resume : '',
        query: query ?? '',
        data_source_id: data_source_id ?? null,
        kb_data_source_id: kb_data_source_id ?? null,
        analytics_type: analytics_type ?? null,
        analysis_mode: analysis_mode ?? 'standard',
        model: model ?? null,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { success: false, error: `Backend error: ${response.status}`, details: errorText },
        { status: response.status }
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
    console.error('AI analyze resume proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to proxy resume request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
