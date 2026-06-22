import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Catch-all proxy for CE NL2SQL endpoints → backend /api/nl2sql/*
 */
export async function GET(
  request: NextRequest,
  context: { params?: { path?: string[] } | Promise<{ path?: string[] }> },
) {
  return handleNl2sqlRequest(request, context, 'GET');
}

export async function POST(
  request: NextRequest,
  context: { params?: { path?: string[] } | Promise<{ path?: string[] }> },
) {
  return handleNl2sqlRequest(request, context, 'POST');
}

async function handleNl2sqlRequest(
  request: NextRequest,
  context: { params?: { path?: string[] } | Promise<{ path?: string[] }> },
  method: string,
) {
  try {
    const rawParams = context?.params;
    const resolvedParams = rawParams && typeof (rawParams as Promise<unknown>).then === 'function'
      ? await rawParams
      : rawParams;
    const pathSegments = resolvedParams?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForApi();
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const backendUrl = `${backendBase}/api/nl2sql/${path}`;
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    Object.assign(headers, buildProxyAuthHeaders(request));

    const requestOptions: RequestInit = { method, headers, credentials: 'include' };
    if (method === 'POST') {
      const body = await request.text();
      if (body) requestOptions.body = body;
    }

    const response = await fetch(fullUrl, requestOptions);
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      let detail: unknown = errorText;
      try {
        detail = JSON.parse(errorText);
      } catch {
        /* keep text */
      }
      return NextResponse.json(
        { success: false, error: `Backend error: ${response.status}`, detail },
        { status: response.status },
      );
    }

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    const text = await response.text();
    return NextResponse.json({ data: text }, { status: response.status });
  } catch (error) {
    console.error('[api/nl2sql] Proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to proxy NL2SQL request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
