import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Proxies to backend GET /ai/embed/{assistantId}/config — display-safe
 * assistant config (name/capabilities/allowed_modes/library_ids), gated by
 * the same embed-token auth as the analyze endpoint. Distinct from
 * /api/embed/assistants/{id} (which requires an authenticated admin session
 * with embed:manage — fine for the Settings > Embed preview, but a real
 * anonymous visitor never has that session); this route is what lets an
 * actual anonymous visitor's browser learn the assistant's allowed_modes
 * before sending the first message, so it doesn't send an analysis_mode the
 * backend then has to reject.
 */

type Ctx = { params: Promise<{ assistantId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { assistantId } = await ctx.params;
  try {
    const backendBase = getBackendUrlForApi();
    const url = `${backendBase}/ai/embed/${encodeURIComponent(assistantId)}/config`;

    const headers: Record<string, string> = {};
    Object.assign(headers, buildProxyAuthHeaders(request));

    const response = await fetch(url, { method: 'GET', headers });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy failed' },
      { status: 500 }
    );
  }
}
