import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';
import { pipeTolerantStream } from '@/app/api/lib/streamProxy';

/**
 * Proxies to backend POST /ai/embed/{assistantId}/analyze — the anonymous/
 * embed_jwt counterpart of /api/ai/analyze (which proxies to the session-
 * gated POST /ai/analyze). Used by client/src/app/embed/chat/page.tsx when
 * the assistant it's talking to is configured for embed_jwt/anonymous auth;
 * mirrors /api/ai/analyze/route.ts's streaming handling exactly, plus
 * forwards the per-visitor identity header the backend uses for isolation
 * and rate limiting (see server/ee/modules/embed/chat_auth.py).
 */

type Ctx = { params: Promise<{ assistantId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { assistantId } = await ctx.params;
  try {
    const body = await request.json();

    if (body.ai_model && !body.model) {
      body.model = body.ai_model;
      delete body.ai_model;
    }

    const stream = body.stream !== false;
    const backendBase = getBackendUrlForApi();
    const url = new URL(`${backendBase}/ai/embed/${encodeURIComponent(assistantId)}/analyze`);
    url.searchParams.set('stream', String(stream));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (stream) {
      headers['Accept'] = 'text/event-stream';
    }

    Object.assign(headers, buildProxyAuthHeaders(request));
    const visitorId =
      request.headers.get('X-Embed-Visitor-Id') || request.headers.get('x-embed-visitor-id');
    if (visitorId) {
      headers['X-Embed-Visitor-Id'] = visitorId;
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
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
      const streamHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      };
      // The backend mints (or confirms) the conversation_id for this embed
      // session and returns it via this header (see chat_router.py) — the
      // embed page reads it from the fetch response to reuse on subsequent
      // sends. Constructing a fresh NextResponse above only carries the
      // headers explicitly listed here, so this must be forwarded by hand or
      // every streaming send silently starts a brand-new conversation.
      const mintedConversationId = response.headers.get('X-Embed-Conversation-Id');
      if (mintedConversationId) {
        streamHeaders['X-Embed-Conversation-Id'] = mintedConversationId;
      }
      return new NextResponse(tolerantBody, {
        status: response.status,
        headers: streamHeaders,
      });
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Embed AI analyze proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        // See generate-code/route.ts's identical fix: prefer the real error
        // (matches formatUserError's network-error classifier) over a
        // hardcoded string that always won and hid it from the user.
        error: error instanceof Error ? error.message : 'Failed to proxy embed analyze request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
