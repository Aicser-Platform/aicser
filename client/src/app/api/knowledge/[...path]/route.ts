import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Catch-all proxy route for /api/knowledge/* endpoints
 * Forwards requests to the backend FastAPI /knowledge/ router.
 */
export async function GET(
  request: NextRequest,
  context: { params?: any }
) {
  return handleKnowledgeRequest(request, context, 'GET');
}

export async function POST(
  request: NextRequest,
  context: { params?: any }
) {
  return handleKnowledgeRequest(request, context, 'POST');
}

export async function PUT(
  request: NextRequest,
  context: { params?: any }
) {
  return handleKnowledgeRequest(request, context, 'PUT');
}

export async function DELETE(
  request: NextRequest,
  context: { params?: any }
) {
  return handleKnowledgeRequest(request, context, 'DELETE');
}

async function handleKnowledgeRequest(
  request: NextRequest,
  context: { params?: any },
  method: string
) {
  try {
    // Resolve params (may be a Promise in Next.js 15+)
    const rawParams = context?.params;
    const resolvedParams = rawParams && typeof rawParams.then === 'function' ? await rawParams : rawParams;
    const pathSegments = resolvedParams?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForApi();
    const backendUrl = `${backendBase}/knowledge/${path}`;

    // Extract query string
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    Object.assign(headers, buildProxyAuthHeaders(request));

    const requestOptions: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };

    // Add body for POST/PUT/PATCH requests
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('multipart/form-data')) {
        // Multipart: preserve boundary by passing raw blob
        try {
          const clonedRequest = request.clone();
          const blob = await clonedRequest.blob();
          requestOptions.body = blob;
          headers['Content-Type'] = ct;
        } catch (e) {
          console.error('[api/knowledge] Failed to handle multipart body:', e);
          try {
            const clonedRequest = request.clone();
            const arrayBuffer = await clonedRequest.arrayBuffer();
            requestOptions.body = arrayBuffer;
            headers['Content-Type'] = ct;
          } catch (e2) {
            console.error('[api/knowledge] Failed to read body:', e2);
          }
        }
      } else {
        try {
          const body = await request.text();
          if (body) {
            requestOptions.body = body;
            headers['Content-Type'] = ct || 'application/json';
          }
        } catch {
          // Body already consumed or not available
        }
      }
    }

    const response = await fetch(fullUrl, requestOptions);

    const responseContentType = response.headers.get('content-type') || '';

    if (!response.ok) {
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

    if (responseContentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    const text = await response.text();
    return NextResponse.json({ data: text }, { status: response.status });
  } catch (error: any) {
    console.error(`[api/knowledge] Proxy error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to proxy request to backend',
        details: error instanceof Error ? error.stack : String(error),
      },
      { status: 500 }
    );
  }
}
