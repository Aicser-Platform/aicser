import { NextRequest } from 'next/server';
import { proxyEePricingRequest } from '@/ee';

type RouteContext = { params?: Promise<Record<string, unknown>> | Record<string, unknown> };

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyEePricingRequest(request, context, 'GET');
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyEePricingRequest(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyEePricingRequest(request, context, 'PUT');
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyEePricingRequest(request, context, 'PATCH');
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyEePricingRequest(request, context, 'DELETE');
}
