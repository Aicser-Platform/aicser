import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Catch-all BFF proxy for /api/platform/* → backend /platform/*
 */
async function handlePlatformRequest(
  request: NextRequest,
  context: { params?: Promise<{ path?: string[] }> | { path?: string[] } },
  method: string
) {
  try {
    const rawParams = context?.params;
    const resolvedParams = rawParams && typeof (rawParams as Promise<unknown>).then === 'function' ? await rawParams : rawParams;
    const pathSegments = (resolvedParams as { path?: string[] })?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForApi();
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const backendUrl = `${backendBase}/platform/${path}${queryString ? `?${queryString}` : ''}`;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;

    Object.assign(headers, buildProxyAuthHeaders(request));

    const requestOptions: RequestInit = { method, headers, credentials: 'include' };

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      try {
        const body = await request.text();
        if (body) {
          requestOptions.body = body;
          headers['Content-Type'] = contentType || 'application/json';
        }
      } catch {
        // no body
      }
    }

    const response = await fetch(backendUrl, requestOptions);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { success: false, error: errorText || `Backend error: ${response.status}` },
        { status: response.status }
      );
    }

    const responseContentType = response.headers.get('content-type') || '';
    if (responseContentType.includes('application/json')) {
      return NextResponse.json(await response.json(), { status: response.status });
    }
    const text = await response.text();
    return NextResponse.json({ data: text }, { status: response.status });
  } catch (error: unknown) {
    console.error('[api/platform] Proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, context: { params?: Promise<{ path?: string[] }> | { path?: string[] } }) {
  return handlePlatformRequest(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: Promise<{ path?: string[] }> | { path?: string[] } }) {
  return handlePlatformRequest(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: { params?: Promise<{ path?: string[] }> | { path?: string[] } }) {
  return handlePlatformRequest(request, context, 'PUT');
}

export async function PATCH(request: NextRequest, context: { params?: Promise<{ path?: string[] }> | { path?: string[] } }) {
  return handlePlatformRequest(request, context, 'PATCH');
}

export async function DELETE(request: NextRequest, context: { params?: Promise<{ path?: string[] }> | { path?: string[] } }) {
  return handlePlatformRequest(request, context, 'DELETE');
}
