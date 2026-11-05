import { describe, expect, it } from 'vitest';
import { onThisApp } from './embedSnippet';

describe('onThisApp', () => {
  it('keeps the link on the app that created it, path and token intact', () => {
    // jsdom serves the test page from http://localhost:3000 (vitest default).
    const url = onThisApp('https://app.aicser.com/embed/chart/abc?token=t.k.n#x');
    expect(url).toBe(`${window.location.origin}/embed/chart/abc?token=t.k.n#x`);
  });

  it('leaves an empty or unparsable link alone', () => {
    expect(onThisApp('')).toBe('');
  });
});
