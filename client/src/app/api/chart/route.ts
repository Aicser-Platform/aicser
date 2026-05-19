import { getBackendUrl } from '@/utils/backendUrl';
import { NextRequest, NextResponse } from 'next/server';

const backendBase = getBackendUrl();
const backendUrl = `${backendBase}/api/chart`;

async function forwardRequest(method: string, request?: NextRequest) {
  try {
    const { searchParams } = request ? new URL(request.url) : { searchParams: new URLSearchParams() };
    const query = searchParams.toString();
    const targetUrl = query ? `${backendUrl}?${query}` : backendUrl;

    const authHeader = request?.headers.get('Authorization');
    const cookieHeader = request?.headers.get('Cookie');

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
    };

    if (request && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      const body = await request.json();
      options.body = JSON.stringify(body);
    }

    console.log(`[API Proxy] ${method} ${targetUrl}`);
    const response = await fetch(targetUrl, options);

    if (!response.ok) {
        const errorData = await response.text();
        console.error(`[API Proxy] Backend error: ${response.status} - ${errorData}`);
        return NextResponse.json({ success: false, error: `Backend error: ${response.status}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[API Proxy] Exception:`, error);
    return NextResponse.json({ success: false, error: 'Backend connection failed' }, { status: 500 });
  }
}

/**
 * GET
 */
export async function GET(request: NextRequest) {
  return forwardRequest('GET', request);
}

/**
 * POST
 */
export async function POST(request: NextRequest) {
  return forwardRequest('POST', request);
}

/**
 * PUT
 */
export async function PUT(request: NextRequest) {
  return forwardRequest('PUT', request);
}

/**
 * DELETE
 */
export async function DELETE(request: NextRequest) {
  return forwardRequest('DELETE', request);
}
