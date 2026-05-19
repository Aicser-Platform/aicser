import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';

/**
 * Catch-all proxy route for /api/data/* endpoints
 * Forwards requests to the backend FastAPI server
 */
export async function GET(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'GET');
}

export async function POST(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'POST');
}

export async function PUT(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'PUT');
}

export async function PATCH(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'PATCH');
}

export async function DELETE(
  request: NextRequest,
  context: { params?: any }
) {
  return handleDataRequest(request, context, 'DELETE');
}

async function handleDataRequest(
  request: NextRequest,
  context: { params?: any },
  method: string
) {
  try {
    // Resolve params (may be a Promise in Next.js 15+)
    const rawParams = context?.params;
    const resolvedParams = rawParams && typeof rawParams.then === 'function' ? await rawParams : rawParams;
    const pathSegments = resolvedParams?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');
    
    const backendBase = getBackendUrlForApi();
    const backendUrl = `${backendBase}/data/${path}`;
    
    // Extract query string
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;
    
    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;

    // Forward Authorization header if present
    const authHeader = request.headers.get('Authorization');
    if (authHeader) headers['Authorization'] = authHeader;

    // Forward cookies so backend auth (JWTCookieBearer) works for /data/sources and schema
    const cookie = request.headers.get('Cookie');
    if (cookie) headers['Cookie'] = cookie;
    
    // Prepare request options
    const requestOptions: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };
    
    // Add body for POST/PUT/PATCH requests
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      // Check if this is a file upload (multipart/form-data)
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        // For multipart/form-data, clone the request to get a fresh body stream
        // Then read as blob to preserve the multipart structure
        try {
          const clonedRequest = request.clone();
          const blob = await clonedRequest.blob();
          requestOptions.body = blob;
          // Preserve the original Content-Type header with boundary - CRITICAL for multipart
          headers['Content-Type'] = contentType;
        } catch (e) {
          console.error('[api/data] Failed to handle multipart body:', e);
          // If blob fails, try arrayBuffer as fallback
          try {
            const clonedRequest = request.clone();
            const arrayBuffer = await clonedRequest.arrayBuffer();
            requestOptions.body = arrayBuffer;
            headers['Content-Type'] = contentType;
          } catch (e2) {
            console.error('[api/data] Failed to read body:', e2);
          }
        }
      } else {
        // For other content types (e.g., application/json), read as text
        try {
          const body = await request.text();
          if (body) {
            requestOptions.body = body;
            headers['Content-Type'] = contentType || 'application/json';
          }
        } catch (e) {
          // Body already consumed or not available
        }
      }
    }
    
    const response = await fetch(fullUrl, requestOptions);
    
    // Handle response
    const responseContentType = response.headers.get('content-type') || '';
    
    if (!response.ok) {
      // Forward JSON error responses from backend as-is (preserves structured error details)
      const responseContentType = response.headers.get('content-type') || '';
      if (responseContentType.includes('application/json')) {
        try {
          const errorJson = await response.json();
          return NextResponse.json(errorJson, { status: response.status });
        } catch {
          // Fall through to text handling
        }
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { 
          success: false,
          error: errorText || `Backend error: ${response.status}`,
          detail: errorText
        },
        { status: response.status }
      );
    }
    
    // Return JSON response
    if (responseContentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }
    
    // Return text response
    const text = await response.text();
    return NextResponse.json({ data: text }, { status: response.status });
    
  } catch (error: any) {
    console.error(`[api/data/${context?.params?.path}] Proxy error:`, error);
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

