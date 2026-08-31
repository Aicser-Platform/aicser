import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const backendBase = getBackendUrlForApi();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    Object.assign(headers, buildProxyAuthHeaders(request));
    const organizationId = request.headers.get('X-Organization-Id') || request.headers.get('x-organization-id');
    if (organizationId) {
      headers['X-Organization-Id'] = organizationId;
    }

    const response = await fetch(`${backendBase}/ai/query-editor/optimize-sql`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      let detail: unknown = errorText;
      try { detail = JSON.parse(errorText); } catch { /* keep text */ }
      return NextResponse.json(
        { success: false, error: `Backend error: ${response.status}`, detail },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 500 }
    );
  }
}
