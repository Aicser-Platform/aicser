import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

export async function GET(request: NextRequest) {
  try {
    const backendUrl = getBackendUrlForProxy();
    const headers = buildProxyAuthHeaders(request);

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
      ...buildProxyAuthHeaders(request),
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
