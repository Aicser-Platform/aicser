import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';

export async function GET(request: NextRequest) {
  try {
    const backendUrl = getBackendUrlForProxy();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const authHeader = request.headers.get('Authorization');
    if (authHeader) headers['Authorization'] = authHeader;

    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) headers['cookie'] = cookieHeader;

    const response = await fetch(`${backendUrl}/api/organizations`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/organizations] GET Exception:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const backendUrl = getBackendUrlForProxy();
    const body = await request.json();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const authHeader = request.headers.get('Authorization');
    if (authHeader) headers['Authorization'] = authHeader;

    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) headers['cookie'] = cookieHeader;

    const response = await fetch(`${backendUrl}/api/organizations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
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
    console.error('[api/organizations] POST Exception:', error);
    return NextResponse.json({ error: 'Proxy Error', message }, { status: 500 });
  }
}
