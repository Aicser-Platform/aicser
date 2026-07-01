import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Catch-all proxy route for /api/data/* endpoints
 * Forwards requests to the backend FastAPI server
 */
export async function GET(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'GET');
}

export async function POST(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'POST');
}

export async function PUT(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'PUT');
}

export async function PATCH(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'PATCH');
}

export async function DELETE(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'DELETE');
}

async function handleDataRequest(
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
    const backendUrl = `${backendBase}/data/${path}`;
    
    // Extract query string
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;
    
    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    Object.assign(headers, buildProxyAuthHeaders(request));
    
    // Prepare request options — 35 s timeout so schema fetches don't hang the proxy
    const requestOptions: RequestInit = {
      method,
      headers,
      credentials: 'include',
      signal: AbortSignal.timeout(35_000),
    };
    
    // Add body for POST/PUT/PATCH requests. Stream it through so uploads do not
    // get fully buffered by the Next.js proxy before FastAPI sees them.
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const contentType = request.headers.get('content-type') || '';
      if (contentType) {
        headers['Content-Type'] = contentType;
      }
      if (request.body) {
        requestOptions.body = request.body as any;
        (requestOptions as any).duplex = 'half';
      }
    }
    
    const response = await fetch(fullUrl, requestOptions);
    
    // Handle response
    const responseContentType = response.headers.get('content-type') || '';
    
    if (!response.ok) {
      // Forward JSON error responses from backend as-is (preserves structured error details)
      const responseContentType = response.headers.get('content-type') || '';
      if (responseContentType.includes('application/json')) {
        try {
          const errorJson = await response.json();
          return NextResponse.json(errorJson, { status: response.status });
        } catch {
          // Fall through to text handling
        }
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { 
          success: false,
          error: errorText || `Backend error: ${response.status}`,
          detail: errorText
        },
        { status: response.status }
      );
    }
    
    // No-content responses (e.g. 204 from DELETE) have an empty body — forward
    // the status without trying to parse JSON, which would throw on empty input.
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return new NextResponse(null, { status: response.status });
    }

    // Return JSON response. Guard against an empty body that still advertises a
    // JSON content-type, which would make response.json() throw.
    if (responseContentType.includes('application/json')) {
      const raw = await response.text();
      if (!raw) {
        return new NextResponse(null, { status: response.status });
      }
      return new NextResponse(raw, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Return text response
    const text = await response.text();
    return NextResponse.json({ data: text }, { status: response.status });
    
  } catch (error: any) {
    console.error(`[api/data/${context?.params?.path}] Proxy error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to proxy request to backend',
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}
