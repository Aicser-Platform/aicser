import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Proxy route for /api/pipeline/* endpoints
 * Handles dbt dynamic generation, run commands, and pipeline definitions.
 */
export async function GET(request: NextRequest, context: { params?: any }) {
  return handlePipelineRequest(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: any }) {
  return handlePipelineRequest(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: { params?: any }) {
  return handlePipelineRequest(request, context, 'PUT');
}

export async function DELETE(request: NextRequest, context: { params?: any }) {
  return handlePipelineRequest(request, context, 'DELETE');
}

async function handlePipelineRequest(
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
    const backendUrl = `${backendBase}/api/pipeline/${path}`;

    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    Object.assign(headers, buildProxyAuthHeaders(request));

    const organizationId = request.headers.get('X-Organization-Id') || request.headers.get('x-organization-id');
    if (organizationId) {
      headers['X-Organization-Id'] = organizationId;
    }

    const requestOptions: RequestInit = {
      method,
      headers,
      credentials: 'include',
      signal: AbortSignal.timeout(120_000), // dbt run may take some time
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

    const responseContentType = response.headers.get('content-type') || '';
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
    console.error(`[api/pipeline] Proxy error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to proxy pipeline request to backend',
        details: error instanceof Error ? error.stack : String(error),
      },
      { status: 500 }
    );
  }
}
