import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';
import { pipeTolerantStream } from '@/app/api/lib/streamProxy';

/**
 * Proxy route for /api/sync/* endpoints
 * Handles POST /api/sync/trigger, GET /api/sync/{job_id}/status, and live SSE GET /api/sync/{job_id}/events
 */
export async function GET(request: NextRequest, context: { params?: any }) {
  return handleSyncRequest(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: any }) {
  return handleSyncRequest(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: { params?: any }) {
  return handleSyncRequest(request, context, 'PUT');
}

export async function DELETE(request: NextRequest, context: { params?: any }) {
  return handleSyncRequest(request, context, 'DELETE');
}

async function handleSyncRequest(
  request: NextRequest,
  context: { params?: any },
  method: string
) {
  try {
    const rawParams = context?.params;
    const resolvedParams = rawParams && typeof rawParams.then === 'function' ? await rawParams : rawParams;
    const pathSegments = resolvedParams?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForApi();
    const backendUrl = `${backendBase}/api/sync/${path}`;

    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const isEventStream = path.endsWith('/events') || request.headers.get('accept')?.includes('text/event-stream');

    const headers: Record<string, string> = {};
    if (isEventStream) {
      headers['Accept'] = 'text/event-stream';
    } else {
      headers['Content-Type'] = 'application/json';
    }

    Object.assign(headers, buildProxyAuthHeaders(request));
    const organizationId = request.headers.get('X-Organization-Id') || request.headers.get('x-organization-id');
    if (organizationId) {
      headers['X-Organization-Id'] = organizationId;
    }

    const requestOptions: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const body = await request.text();
      if (body) {
        requestOptions.body = body;
      }
    }

    const response = await fetch(fullUrl, requestOptions);

    if (!response.ok) {
      const responseContentType = response.headers.get('content-type') || '';
      if (responseContentType.includes('application/json')) {
        try {
          const errorJson = await response.json();
          return NextResponse.json(errorJson, { status: response.status });
        } catch {}
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        {
          success: false,
          error: errorText || `Backend error: ${response.status}`,
          detail: errorText,
        },
        { status: response.status }
      );
    }

    // Handle SSE streams
    const responseContentType = response.headers.get('content-type') || '';
    if (isEventStream || responseContentType.includes('text/event-stream')) {
      if (!response.body) {
        return NextResponse.json({ success: false, error: 'No stream body' }, { status: 502 });
      }
      const stream = pipeTolerantStream(response.body);
      return new NextResponse(stream, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    if (responseContentType.includes('application/json')) {
      const raw = await response.text();
      return new NextResponse(raw || '{}', {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const text = await response.text();
    return new NextResponse(text, { status: response.status });
  } catch (error: any) {
    console.error(`[api/sync] Proxy error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to proxy sync request to backend',
        details: error instanceof Error ? error.stack : String(error),
      },
      { status: 500 }
    );
  }
}
