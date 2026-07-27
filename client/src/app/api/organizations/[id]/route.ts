import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const backendUrl = getBackendUrlForProxy();
    const body = await request.json();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    Object.assign(headers, buildProxyAuthHeaders(request));

    const response = await fetch(`${backendUrl}/api/organizations/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[api/organizations/${id}] PATCH Exception:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const backendUrl = getBackendUrlForProxy();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    Object.assign(headers, buildProxyAuthHeaders(request));

    const response = await fetch(`${backendUrl}/api/organizations/${id}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[api/organizations/${id}] DELETE Exception:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
