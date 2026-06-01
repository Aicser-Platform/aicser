/**
 * Secure Authentication Utilities
 * Provides secure token handling with validation and no leaks
 */

import { getCeBearerToken } from '@/auth/ce/bearerToken';

/**
 * Validates if a token is secure and valid
 * @param token - Token string to validate
 * @returns true if token is valid, false otherwise
 */
export function isValidToken(token: string | null | undefined): boolean {
  if (!token) return false;
  if (token === 'null' || token === 'undefined' || token === '') return false;
  // JWT tokens should be at least 50 characters (header.payload.signature)
  // Short tokens are likely invalid or test tokens
  if (token.length < 50) return false;
  // Basic JWT format check (should have 3 parts separated by dots)
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  return true;
}

/**
 * Gets secure authentication headers using Supabase session token or CE bearer token.
 * @param session - Supabase session object with access_token (optional)
 * @returns Headers object with Bearer token authentication when available
 */
export function getSecureAuthHeaders(session: { access_token?: string } | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let token = session?.access_token;
  if (!token || !isValidToken(token)) {
    token = getCeBearerToken() ?? undefined;
  }

  if (token && isValidToken(token)) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([_, value]) => value !== undefined)
  ) as Record<string, string>;
}

/** User-friendly text for common fetch/API failures so we don't show raw "Failed to fetch" or "network error". */
const NETWORK_OR_RATE_MSG =
  'Connection or server temporarily unavailable. Wait a moment and try again, or check your connection.';

/**
 * Sanitizes error messages to prevent sensitive data leaks and maps common errors to user-friendly text.
 * @param error - Error object or string
 * @returns Sanitized error message safe for user display
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred';

  let raw: string;
  if (typeof error === 'string') {
    raw = error;
  } else if (error instanceof Error) {
    raw = error.message;
  } else {
    return 'An unexpected error occurred';
  }

  const lower = raw.toLowerCase();
  if (
    lower.includes('failed to fetch') ||
    lower === 'network error' ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('connection refused')
  ) {
    return NETWORK_OR_RATE_MSG;
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'API rate limit reached. Please wait a moment and try again.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Request timed out. Please try again.';
  }

  // Remove potential token leaks
  return raw
    .replace(/Bearer\s+[A-Za-z0-9\-._~+\/]+/gi, 'Bearer [REDACTED]')
    .replace(/token['":\s]*[A-Za-z0-9\-._~+\/]{20,}/gi, 'token: [REDACTED]')
    .replace(/Authorization['":\s]*[A-Za-z0-9\-._~+\/]+/gi, 'Authorization: [REDACTED]');
}

/**
 * Checks if response indicates authentication failure
 * @param response - Fetch Response object
 * @returns true if authentication failed
 */
export function isAuthError(response: Response): boolean {
  return response.status === 401 || response.status === 403;
}

/**
 * Handles authentication errors securely
 * Clears invalid tokens and redirects to login
 */
export function handleAuthError(): void {
  try {
    // Clear all potential token storage locations
    localStorage.removeItem('token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('aiser_access_token');
    
    // Redirect to login after a short delay
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }, 1000);
  } catch (error) {
    console.error('Failed to handle auth error:', error);
  }
}

