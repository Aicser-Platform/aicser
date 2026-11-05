import DOMPurify from 'dompurify';
import { marked } from 'marked';

const HTML_TAG = /<\/?(?:p|div|span|br|ul|ol|li|h[1-6]|strong|b|em|i|u|s|a|table|font|blockquote)\b[^>]*>/i;
/** A generated summary wrapped in one paragraph, with nothing inside it but text. */
const ONE_PARAGRAPH = /^<p>([^<]*)<\/p>$/i;

/**
 * What a text widget shows. The editor saves HTML, but AI-written text arrives as markdown, so it is
 * converted here, where it is read: dashboards saved earlier are fixed too, with no data change.
 * Everything is sanitized, because this goes straight into the page, shared dashboards included.
 */
export function textWidgetHtml(content: string | null | undefined): string {
  const text = (content ?? '').trim();
  if (!text) return '';
  const inner = text.match(ONE_PARAGRAPH)?.[1] ?? text;
  const html = HTML_TAG.test(inner)
    ? inner
    // The editor keeps line breaks (pre-wrap), so the breaks between converted blocks must go.
    : (marked.parse(inner, { gfm: true, breaks: true, async: false }) as string).replace(/>\s+</g, '><').trim();
  return DOMPurify.sanitize(html);
}
