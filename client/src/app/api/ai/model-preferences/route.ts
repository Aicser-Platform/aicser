import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

async function proxyModelPreferences(request: NextRequest, method: string) {
  try {
    const backendBase = getBackendUrlForApi();
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const url = `${backendBase}/ai/model-preferences${queryString ? `?${queryString}` : ''}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildProxyAuthHeaders(request),
    };
    const organizationId = request.headers.get('X-Organization-Id') || request.headers.get('x-organization-id');
    if (organizationId) {
      headers['X-Organization-Id'] = organizationId;
    }

    const init: RequestInit = { method, headers, credentials: 'include' };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = await request.text();
    }

    const response = await fetch(url, init);
    if (response.status === 404) {
      return NextResponse.json({ success: false, error: 'Not implemented' }, { status: 404 });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      return NextResponse.json({ success: false, error: text }, { status: response.status });
    }
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return proxyModelPreferences(request, 'GET');
}

export async function PUT(request: NextRequest) {
  return proxyModelPreferences(request, 'PUT');
}
