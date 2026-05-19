import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Force dynamic rendering for all routes
export function middleware(request: NextRequest) {
  // Add headers to force dynamic rendering
  const response = NextResponse.next();
  
  // Force dynamic rendering
  response.headers.set('x-nextjs-data', '1');
  response.headers.set('x-nextjs-render', 'dynamic');
  
  return response;
}

// Apply to all routes
// Disable middleware matcher to avoid accidental interception of static asset
// requests during local development. If middleware is needed later, re-enable
// and scope it explicitly to API routes only.
export const config = {
  matcher: [],
};
