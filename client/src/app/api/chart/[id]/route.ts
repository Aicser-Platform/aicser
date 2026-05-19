
import { getBackendUrl } from '@/utils/backendUrl';
import { NextRequest, NextResponse } from 'next/server';

const backendBase = getBackendUrl();
const backendUrl = `${backendBase}/api/chart`;

async function forwardRequest(method: string, id: string, request?: NextRequest) {
  try {
    const targetUrl = `${backendUrl}/${id}`;

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

    console.log(`[API Proxy ID] ${method} ${targetUrl}`);
    const response = await fetch(targetUrl, options);

    if (!response.ok) {
        const errorData = await response.text();
        console.error(`[API Proxy ID] Backend error: ${response.status} - ${errorData}`);
        return NextResponse.json({ success: false, error: `Backend error: ${response.status}` }, { status: response.status });
    }

    if (response.status === 204) {
      return NextResponse.json({ success: true });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[API Proxy ID] Exception:`, error);
    return NextResponse.json({ success: false, error: 'Backend connection failed' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return forwardRequest('GET', params.id, request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return forwardRequest('POST', params.id, request);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return forwardRequest('PUT', params.id, request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return forwardRequest('DELETE', params.id, request);
}
