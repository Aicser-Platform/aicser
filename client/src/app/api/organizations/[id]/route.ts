import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const id = params.id;
        const backendUrl = getBackendUrlForProxy();
        const body = await request.json();

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        const authHeader = request.headers.get('Authorization');
        if (authHeader) headers['Authorization'] = authHeader;

        const cookieHeader = request.headers.get('cookie');
        if (cookieHeader) headers['cookie'] = cookieHeader;

        const response = await fetch(`${backendUrl}/api/organizations/${id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(body),
            credentials: 'include',
        });

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error: any) {
        console.error(`[api/organizations/${params.id}] PATCH Exception:`, error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const id = params.id;
        const backendUrl = getBackendUrlForProxy();

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        const authHeader = request.headers.get('Authorization');
        if (authHeader) headers['Authorization'] = authHeader;

        const cookieHeader = request.headers.get('cookie');
        if (cookieHeader) headers['cookie'] = cookieHeader;

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
    } catch (error: any) {
        console.error(`[api/organizations/${params.id}] DELETE Exception:`, error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
