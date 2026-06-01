type AuthErrorBody = {
  detail?: string | { message?: string; error?: string; details?: unknown[] };
  message?: string;
  error?: string;
  details?: Array<{ loc?: (string | number)[]; msg?: string }>;
};

function formatValidationDetails(details: AuthErrorBody['details']): string | null {
  if (!Array.isArray(details) || !details.length) return null;
  const first = details[0];
  const field = Array.isArray(first?.loc)
    ? first.loc.filter((p) => p !== 'body' && p !== 'query').pop()
    : null;
  if (field === 'email') return 'Please enter a valid email address.';
  if (field === 'password') return 'Please enter your password.';
  if (first?.msg) return String(first.msg);
  return null;
}

/** Map auth API responses to short, user-facing error text. */
export function parseAuthResponseError(status: number, body: AuthErrorBody): string {
  if (status === 502 || body.detail === 'Backend unreachable') {
    return 'The server is starting or temporarily unavailable. Wait a moment and try again.';
  }

  if (status === 401) {
    return 'Invalid email or password.';
  }

  if (body.error === 'validation_error' || status === 422) {
    const fromDetails = formatValidationDetails(body.details);
    if (fromDetails) return fromDetails;
    if (body.message && body.message !== 'Request validation failed') {
      return body.message;
    }
    return 'Check your email and password, then try again.';
  }

  if (typeof body.detail === 'string' && body.detail.trim()) {
    return body.detail;
  }

  if (body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)) {
    const nested = body.detail as { message?: string };
    if (nested.message?.trim()) return nested.message;
  }

  if (body.message?.trim() && body.message !== 'Request validation failed') {
    return body.message;
  }

  if (status >= 500) {
    return 'Something went wrong on our side. Please try again shortly.';
  }

  return 'Sign in failed. Please try again.';
}
