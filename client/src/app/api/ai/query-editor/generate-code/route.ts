import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Proxy for backend POST /ai/query-editor/generate-code.
 * Keeps query editor AI generation on the canonical app-router proxy layer.
 */
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

    const response = await fetch(`${backendBase}/ai/query-editor/generate-code`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      let detail: unknown = errorText;
      try {
        detail = JSON.parse(errorText);
      } catch {
        // keep text detail
      }
      return NextResponse.json(
        { success: false, error: `Backend error: ${response.status}`, detail },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    console.error('AI query-editor generate-code proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        // Prefer the real error (e.g. "fetch failed" when the backend is
        // briefly unreachable) - formatUserError's network-error classifier
        // matches on that text. The old hardcoded string here always won,
        // discarding it and showing raw internal plumbing text to the user
        // instead of "Could not reach the server, try again."
        error: error instanceof Error ? error.message : 'Failed to proxy query-editor generate-code request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
