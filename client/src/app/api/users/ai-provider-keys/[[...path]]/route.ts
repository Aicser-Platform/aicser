import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Proxies GET/PUT /api/users/ai-provider-keys[/{provider}] to FastAPI with auth + cookies.
 * App Router takes precedence over pages/api/[...path] so Docker can use API_TARGET.
 */
export async function GET(request: NextRequest) {
  try {
    const backendUrl = getBackendUrlForProxy();
    const headers = buildProxyAuthHeaders(request);
    const response = await fetch(`${backendUrl}/api/users/ai-provider-keys`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('ai-provider-keys GET proxy error:', error);
    return NextResponse.json({ detail: 'Failed to load provider keys' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path?: string[] } }
) {
  try {
    const provider = params.path?.[0];
    if (!provider) {
      return NextResponse.json({ detail: 'provider is required' }, { status: 400 });
    }
    const body = await request.json();
    const backendUrl = getBackendUrlForProxy();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildProxyAuthHeaders(request),
    };
    const response = await fetch(`${backendUrl}/api/users/ai-provider-keys/${provider}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('ai-provider-keys PUT proxy error:', error);
    return NextResponse.json({ detail: 'Failed to save provider key' }, { status: 500 });
  }
}
