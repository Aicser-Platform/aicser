import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Proxy GET /api/organizations/workspace-config → FastAPI.
 * Must be a static route (not [id]) — otherwise Next matches id=workspace-config and returns 405.
 */
export async function GET(request: NextRequest) {
  try {
    const backendUrl = getBackendUrlForProxy();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    Object.assign(headers, buildProxyAuthHeaders(request));

    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) headers['cookie'] = cookieHeader;

    const response = await fetch(`${backendUrl}/api/organizations/workspace-config`, {
      method: 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': contentType || 'text/plain' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/organizations/workspace-config] GET Exception:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
