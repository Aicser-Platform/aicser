import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Proxy route for /api/ai/models
 * Forwards requests to the backend /ai/models endpoint
 */
export async function GET(request: NextRequest) {
  try {
    const backendBase = getBackendUrlForApi();
    const backendUrl = `${backendBase}/ai/models`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Forward auth so backend can validate (cookie or Bearer)
    Object.assign(headers, buildProxyAuthHeaders(request));

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const body: { success?: boolean; error?: string; detail?: string } = {
        success: false,
        error: errorText || `Backend error: ${response.status}`,
        detail: errorText,
      };
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.detail) body.detail = parsed.detail;
        if (parsed?.error) body.error = parsed.error;
      } catch {
        // use body as above
      }
      return NextResponse.json(body, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
    
  } catch (error: any) {
    console.error('[api/ai/models] Proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to proxy request to backend',
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}





