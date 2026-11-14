import type { Report, ReportSection } from './report';

export interface TextBlock {
  kind: 'paragraph' | 'bullet' | 'heading';
  text: string;
}

/** Inline Markdown the AI writes (**bold**, _italic_, `code`, [link](url)) as plain text. */
export const plainText = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();

/** AI text as paragraphs, bullets and small headings (lines joined inside a paragraph). */
export function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: plainText(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (heading?.[1]) {
      flush();
      blocks.push({ kind: 'heading', text: plainText(heading[1]) });
    } else if (bullet?.[1]) {
      flush();
      blocks.push({ kind: 'bullet', text: plainText(bullet[1]) });
    } else paragraph.push(line);
  }
  flush();
  return blocks.filter((b) => b.text);
}

/** "Standard report · Prepared for Ada · Acme · 11 November 2026". */
export function reportByline(report: Report, date = new Date()): string {
  const tier = report.tierLabel || (report.tier ? report.tier[0]?.toUpperCase() + report.tier.slice(1) : '');
  return [
    tier ? `${tier} report` : 'Analysis report',
    report.industry,
    report.preparedFor ? `Prepared for ${report.preparedFor}` : '',
    report.organization,
    date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** KPI tiles shown under the summary: every KPI section's values, first eight. */
export const headlineKpis = (sections: ReportSection[]) =>
  sections.flatMap((s) => (s.type === 'kpi' ? s.kpis : [])).slice(0, 8);

export const PRIORITY_LABEL: Record<string, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};
