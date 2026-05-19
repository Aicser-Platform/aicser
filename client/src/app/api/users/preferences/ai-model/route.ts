import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';

function forwardAuthHeaders(incoming: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth =
    incoming.headers.get('authorization') ||
    incoming.headers.get('Authorization');
  if (auth) headers['Authorization'] = auth;
  const cookie =
    incoming.headers.get('cookie') || incoming.headers.get('Cookie');
  if (cookie) headers['Cookie'] = cookie;
  return headers;
}

export async function GET(request: NextRequest) {
  try {
    const backendUrl = getBackendUrlForProxy();
    const headers = forwardAuthHeaders(request);

    const response = await fetch(`${backendUrl}/api/users/preferences/ai-model`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error fetching AI model preference:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI model preference' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const backendUrl = getBackendUrlForProxy();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...forwardAuthHeaders(request),
    };

    const response = await fetch(`${backendUrl}/api/users/preferences/ai-model`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error updating AI model preference:', error);
    return NextResponse.json(
      { error: 'Failed to update AI model preference' },
      { status: 500 }
    );
  }
}
