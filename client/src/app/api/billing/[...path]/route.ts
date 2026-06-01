import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

function mapBillingPath(path: string, method: string): string {
  const suffix = path.replace(/^\/+/, '');
  if (suffix === 'portal') return 'pricing/billing-portal';
  if (suffix === 'invoices') return 'pricing/payment-history';
  if (suffix === 'cancel') return 'pricing/cancel-subscription';
  if (suffix === 'payment-methods' && method === 'POST') return 'pricing/payment-methods/setup-intent';
  return `pricing/${suffix}`;
}

async function proxy(
  request: NextRequest,
  context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> },
  method: string,
) {
  try {
    const rawParams = context?.params;
    const resolvedParams =
      rawParams && typeof (rawParams as Promise<unknown>).then === 'function' ? await rawParams : rawParams;
    const pathSegments = (resolvedParams as { path?: string[] })?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForProxy().replace(/\/$/, '');
    const backendUrl = `${backendBase}/${mapBillingPath(path, method)}`;

    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    Object.assign(headers, buildProxyAuthHeaders(request));
    const orgHeader = request.headers.get('X-Organization-Id');
    if (orgHeader) headers['X-Organization-Id'] = orgHeader;

    const requestOptions: RequestInit = { method, headers, credentials: 'include' };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      try {
        const body = await request.text();
        if (body) {
          requestOptions.body = body;
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
      } catch {
        /* no body */
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
          /* fall through */
        }
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json({ detail: { message: errorText } }, { status: response.status });
    }

    if (responseContentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    const text = await response.text();
    return NextResponse.json({ data: text }, { status: response.status });
  } catch (error: unknown) {
    console.error('[api/billing] Proxy error:', error);
    return NextResponse.json(
      { detail: { message: 'The request could not be completed. Please try again.' } },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> },
) {
  return proxy(request, context, 'GET');
}

export async function POST(
  request: NextRequest,
  context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> },
) {
  return proxy(request, context, 'POST');
}

export async function PUT(
  request: NextRequest,
  context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> },
) {
  return proxy(request, context, 'PUT');
}

export async function PATCH(
  request: NextRequest,
  context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> },
) {
  return proxy(request, context, 'PATCH');
}

export async function DELETE(
  request: NextRequest,
  context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> },
) {
  return proxy(request, context, 'DELETE');
}
