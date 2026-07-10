import { NextRequest } from 'next/server';
import { handleDashboardProxyRequest } from '../proxy';

/**
 * Catch-all proxy route for /api/dashboards/* endpoints.
 * Forwards requests to the backend FastAPI server at /api/dashboards/...
 */
export async function GET(request: NextRequest, context: { params?: any }) {
  return handleDashboardProxyRequest(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: any }) {
  return handleDashboardProxyRequest(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: { params?: any }) {
  return handleDashboardProxyRequest(request, context, 'PUT');
}

export async function PATCH(request: NextRequest, context: { params?: any }) {
  return handleDashboardProxyRequest(request, context, 'PATCH');
}

export async function DELETE(request: NextRequest, context: { params?: any }) {
  return handleDashboardProxyRequest(request, context, 'DELETE');
}
