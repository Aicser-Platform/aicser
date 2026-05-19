import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';

/** Timeout for intent backend call (ms). Prevents UND_ERR_HEADERS_TIMEOUT when backend is slow. */
const INTENT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Proxy for backend POST /ai/chat/intent.
 * Lightweight intent: returns suggested_analytics_type (keyword-based, no LLM).
 * Frontend uses this to show "Use Predictive mode for this question?" [Yes] [No, keep Descriptive].
 */
export async function POST(request: NextRequest) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INTENT_FETCH_TIMEOUT_MS);

  try {
    const body = await request.json();
    const { query, conversation_id, current_analytics_type } = body;

    const backendBase = getBackendUrlForApi();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const authHeader = request.headers.get('Authorization');
    if (authHeader) headers['Authorization'] = authHeader;
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) headers['cookie'] = cookieHeader;

    const response = await fetch(`${backendBase}/ai/chat/intent`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: query ?? '',
        conversation_id: conversation_id ?? null,
        current_analytics_type: current_analytics_type ?? null,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { success: false, error: `Backend error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    clearTimeout(timeoutId);

    const isTimeout =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        (error as { cause?: { code?: string } }).cause?.code === 'UND_ERR_HEADERS_TIMEOUT');

    if (isTimeout) {
      console.warn('AI chat intent proxy: backend timeout — returning descriptive fallback');
      return NextResponse.json(
        {
          success: true,
          suggested_analytics_type: 'descriptive',
          intent_timeout_fallback: true,
        },
        { status: 200 }
      );
    }

    console.error('AI chat intent proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to proxy intent request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
