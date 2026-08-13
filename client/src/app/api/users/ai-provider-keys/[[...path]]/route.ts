import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

type RouteParams = { path?: string[] };
type RouteContext = { params?: RouteParams | Promise<RouteParams> };

/**
 * Proxies GET/PUT /api/users/ai-provider-keys[/{provider}] to FastAPI with auth + cookies.
 * App Router takes precedence over pages/api/[...path] so Docker can use API_TARGET.
 */
async function proxyJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return new NextResponse(null, { status: response.status });
  }
  try {
    return NextResponse.json(JSON.parse(text), { status: response.status });
  } catch {
    return NextResponse.json({ detail: text }, { status: response.status });
  }
}

function forwardOrganizationHeader(request: NextRequest, headers: Record<string, string>) {
  const organizationId = request.headers.get('X-Organization-Id') || request.headers.get('x-organization-id');
  if (organizationId) {
    headers['X-Organization-Id'] = organizationId;
  }
}

export async function GET(request: NextRequest) {
  try {
    const backendUrl = getBackendUrlForProxy();
    const headers = buildProxyAuthHeaders(request);
    forwardOrganizationHeader(request, headers);
    const response = await fetch(`${backendUrl}/api/users/ai-provider-keys`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    return proxyJson(response);
  } catch {
    return NextResponse.json({ detail: 'Failed to load provider keys' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const params = await Promise.resolve(context?.params ?? {});
    const provider = Array.isArray(params?.path) ? params.path[0] : undefined;
    if (!provider) {
      return NextResponse.json({ detail: 'provider is required' }, { status: 400 });
    }
    const body = await request.json();
    const backendUrl = getBackendUrlForProxy();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildProxyAuthHeaders(request),
    };
    forwardOrganizationHeader(request, headers);
    const response = await fetch(`${backendUrl}/api/users/ai-provider-keys/${provider}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    return proxyJson(response);
  } catch {
    return NextResponse.json({ detail: 'Failed to save provider key' }, { status: 500 });
  }
}
