/** Matches server MASKED_PLACEHOLDER and legacy abc...xyz masks. */
export const MASKED_CREDENTIAL_PLACEHOLDER = '••••••••••••';

export function isRedactedCredential(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s) return true;
  if (s === MASKED_CREDENTIAL_PLACEHOLDER || s.startsWith('••••')) return true;
  if (s.length > 6 && s.includes('...') && !s.startsWith('http')) return true;
  return false;
}

/** Omit redacted secrets from payloads sent on update. */
export function stripRedactedSecrets(
  config: Record<string, unknown>,
  keys: string[] = ['password', 'pass', 'api_key', 'bearer_token', 'token', 'secret', 'secret_key'],
): Record<string, unknown> {
  const out = { ...config };
  for (const key of keys) {
    if (key in out && isRedactedCredential(out[key])) {
      delete out[key];
    }
  }
  return out;
}
