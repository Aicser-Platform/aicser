import { NextRequest } from 'next/server';
import { handleDashboardProxyRequest } from './proxy';

export async function GET(request: NextRequest) {
  return handleDashboardProxyRequest(request, { params: { path: [] } }, 'GET');
}

export async function POST(request: NextRequest) {
  return handleDashboardProxyRequest(request, { params: { path: [] } }, 'POST');
}

export async function PUT(request: NextRequest) {
  return handleDashboardProxyRequest(request, { params: { path: [] } }, 'PUT');
}

export async function PATCH(request: NextRequest) {
  return handleDashboardProxyRequest(request, { params: { path: [] } }, 'PATCH');
}
  
export async function DELETE(request: NextRequest) {
  return handleDashboardProxyRequest(request, { params: { path: [] } }, 'DELETE');
}
