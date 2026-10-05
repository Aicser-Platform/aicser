import { afterEach, describe, expect, it } from 'vitest';
import { allowedCorsOrigin } from '../proxy';

describe('API CORS allowlist', () => {
  afterEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('answers this app and its configured origins', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.aicser.com';
    process.env.CORS_ALLOWED_ORIGINS = 'https://admin.example.com, https://ops.example.com/';
    expect(allowedCorsOrigin('http://localhost:3001', 'http://localhost:3001')).toBe('http://localhost:3001');
    expect(allowedCorsOrigin('https://app.aicser.com', 'http://internal:3000')).toBe('https://app.aicser.com');
    expect(allowedCorsOrigin('https://ops.example.com', 'http://internal:3000')).toBe('https://ops.example.com');
  });

  it('gives any other site nothing (it used to echo every origin with credentials)', () => {
    expect(allowedCorsOrigin('https://evil.example', 'https://app.aicser.com')).toBeNull();
    expect(allowedCorsOrigin('https://sub.app.aicser.com', 'https://app.aicser.com')).toBeNull();
    expect(allowedCorsOrigin(null, 'https://app.aicser.com')).toBeNull();
  });
});
