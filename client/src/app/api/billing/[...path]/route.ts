import { NextRequest } from 'next/server';
import { proxyEeBillingRequest } from '@/ee';

type RouteContext = { params?: Promise<Record<string, unknown>> | Record<string, unknown> };

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyEeBillingRequest(request, context, 'GET');
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyEeBillingRequest(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyEeBillingRequest(request, context, 'PUT');
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyEeBillingRequest(request, context, 'PATCH');
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyEeBillingRequest(request, context, 'DELETE');
}
