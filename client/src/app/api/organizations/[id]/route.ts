import { NextRequest, NextResponse } from 'next/server';

const getBackendUrl = () => {
    // Check environment variables first
    const env = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
    if (env) return env;
    
    // Docker container environment detection:
    // In Docker, HOSTNAME is the container ID (12-char hex)
    const hostname = process.env.HOSTNAME || '';
    const isDocker = /^[a-f0-9]{12}$/i.test(hostname) || process.env.DOCKER_CONTAINER === 'true';
    
    if (isDocker) {
        // Use container name for inter-container communication
        return 'http://aiser-chat2chart-server-dev:8000';
    }
    
    // Local development outside Docker
    return 'http://localhost:8000';
};

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const id = params.id;
        const backendUrl = getBackendUrl();
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
        const backendUrl = getBackendUrl();

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
