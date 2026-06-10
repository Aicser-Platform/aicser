import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

export async function GET(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'POST');
}

async function proxy(
  request: NextRequest,
  context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> },
  method: string
) {
  try {
    const rawParams = context?.params;
    const resolvedParams = rawParams && typeof (rawParams as Promise<unknown>).then === 'function' ? await rawParams : rawParams;
    const pathSegments = (resolvedParams as { path?: string[] })?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');
    const backendBase = getBackendUrlForProxy();
    const backendUrl = `${backendBase}/api/jobs/${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    Object.assign(headers, buildProxyAuthHeaders(request));
    const init: RequestInit = { method, headers, credentials: 'include' };
    if (method === 'POST') {
      const body = await request.text();
      if (body) init.body = body;
    }
    const response = await fetch(backendUrl, init);
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Proxy failed' }, { status: 500 });
  }
}
