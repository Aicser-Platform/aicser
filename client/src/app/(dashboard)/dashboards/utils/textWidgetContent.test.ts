import { describe, expect, it } from 'vitest';
import { textWidgetHtml } from './textWidgetContent';

describe('textWidgetHtml', () => {
  it('renders the markdown AI writes', () => {
    const html = textWidgetHtml('### Key Healthcare Insights\n- **Patient Encounters**: steady volume.\n- **Cost**: 4.2 days.');
    expect(html).toContain('<h3>Key Healthcare Insights</h3>');
    expect(html).toContain('<strong>Patient Encounters</strong>');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).not.toContain('###');
    expect(html).not.toContain('**');
  });

  it('handles a summary the server wrapped in one paragraph', () => {
    const html = textWidgetHtml('<p>### Summary\n\nRevenue is **up**.</p>');
    expect(html).toContain('<h3>Summary</h3>');
    expect(html).toContain('<strong>up</strong>');
  });

  it('leaves what the editor saved as it is', () => {
    const saved = '<p style="text-align: center;">Hello <b>team</b> ** not markdown</p>';
    expect(textWidgetHtml(saved)).toBe(saved);
  });

  it('keeps money amounts and plain sentences readable', () => {
    expect(textWidgetHtml('Loan book is $5.11M across $999.14K.')).toBe('<p>Loan book is $5.11M across $999.14K.</p>');
  });

  it('is empty for nothing', () => {
    expect(textWidgetHtml('')).toBe('');
    expect(textWidgetHtml(null)).toBe('');
  });

  it('removes scripts, from markdown and from saved HTML', () => {
    for (const bad of ['<img src=x onerror=alert(1)>', '<p onclick="alert(1)">x</p>', '<script>alert(1)</script>', '[x](javascript:alert(1))']) {
      const html = textWidgetHtml(bad);
      expect(html).not.toMatch(/onerror|onclick|<script|javascript:/i);
    }
  });
});
