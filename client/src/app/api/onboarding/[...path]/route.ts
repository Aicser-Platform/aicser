/**
 * Catch-all proxy for /api/onboarding/* so backend receives cookies and onboarding save works.
 * Forwards to FastAPI /api/onboarding/{path} with Cookie header so JWTCookieBearer works.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

async function handleOnboardingRequest(
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
    const base = `${backendBase}/api/onboarding`;
    const pathPart = path ? `/${path}` : '';
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${base}${pathPart}?${queryString}` : `${base}${pathPart}`;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    Object.assign(headers, buildProxyAuthHeaders(request));
    const organizationId = request.headers.get('x-organization-id');
    if (organizationId) headers['X-Organization-Id'] = organizationId;

    const requestOptions: RequestInit = { method, headers, credentials: 'include' };

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      try {
        const body = await request.text();
        if (body) {
          requestOptions.body = body;
          headers['Content-Type'] = contentType || 'application/json';
        }
      } catch {
        // ignore
      }
    }

    const response = await fetch(fullUrl, requestOptions);
    const responseContentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      if (responseContentType.includes('application/json')) {
        try {
          const errorJson = await response.json();
          return NextResponse.json(errorJson, { status: response.status });
        } catch {
          //
        }
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { detail: errorText || `Onboarding API error: ${response.status}` },
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
    console.error('[api/onboarding] Proxy error:', error);
    return NextResponse.json(
      { detail: error?.message || 'Failed to reach onboarding API' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, context: { params?: any }) {
  return handleOnboardingRequest(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: any }) {
  return handleOnboardingRequest(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: { params?: any }) {
  return handleOnboardingRequest(request, context, 'PUT');
}

export async function PATCH(request: NextRequest, context: { params?: any }) {
  return handleOnboardingRequest(request, context, 'PATCH');
}
