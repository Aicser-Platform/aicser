import type { JSONContent } from '@tiptap/react';
import { shownSections, type Report, type ReportKpi } from './report';
import { countWords, documentText, type DocumentBody } from '@/lib/docs/model';
import { renderChartImage, sectionChartOption } from './chartImage';
import { PRIORITY_LABEL, headlineKpis, plainText, reportByline, textBlocks } from './reportText';

const MUTED = '#656d76';
const ACCENT = '#0e7490';

const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const colored = (color: string) => [{ type: 'textStyle', attrs: { color } }];
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const heading = (level: number, value: string): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const bulletList = (items: string[]): JSONContent => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [paragraph(text(item))] })),
});

function prose(value: string): JSONContent[] {
  const out: JSONContent[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(bulletList(bullets));
    bullets = [];
  };
  for (const block of textBlocks(value)) {
    if (block.kind === 'bullet') {
      bullets.push(block.text);
      continue;
    }
    flush();
    out.push(block.kind === 'heading' ? heading(3, block.text) : paragraph(text(block.text)));
  }
  flush();
  return out;
}

/** KPI tiles as a table: labels on one row, values (bold) under them, four per row. */
function kpiTable(kpis: ReportKpi[]): JSONContent {
  const cell = (content: JSONContent[]): JSONContent => ({ type: 'tableCell', content: [paragraph(...content)] });
  const rows: JSONContent[] = [];
  for (let i = 0; i < kpis.length; i += 4) {
    const group = kpis.slice(i, i + 4);
    rows.push({ type: 'tableRow', content: group.map((k) => cell(k.label ? [text(k.label, colored(MUTED))] : [])) });
    rows.push({
      type: 'tableRow',
      content: group.map((k) => cell(k.value ? [text(k.value, [{ type: 'bold' }])] : [])),
    });
  }
  return { type: 'table', content: rows };
}

/**
 * The report as a Docs document (editor JSON): the same parts as the PDF and Word files, charts as inline
 * pictures, so it opens in Aicser Docs to edit and export from there.
 */
export function reportToDocument(
  report: Report,
  date = new Date()
): { title: string; body: DocumentBody; meta: Record<string, unknown> } {
  const title = report.title || 'Analysis report';
  const blocks: JSONContent[] = [heading(1, title), paragraph(text(reportByline(report, date), colored(MUTED)))];
  if (report.summary) blocks.push(heading(2, 'Executive summary'), ...prose(report.summary));
  const kpis = headlineKpis(report.sections);
  if (kpis.length) blocks.push(heading(2, 'Key metrics'), kpiTable(kpis));

  shownSections(report).forEach((section, index) => {
    blocks.push(heading(2, `${index + 1}. ${section.title}`));
    if (section.keyMetric && section.keyMetricValue) {
      blocks.push(
        paragraph(text(`${section.keyMetric}: ${section.keyMetricValue}`, [{ type: 'bold' }, ...colored(ACCENT)]))
      );
    }
    if (section.type !== 'kpi' && section.kpis.length) blocks.push(kpiTable(section.kpis));
    const option = sectionChartOption(section);
    const image = option ? renderChartImage(option, { width: 660, height: 330, type: 'png' }) : null;
    if (image) blocks.push({ type: 'image', attrs: { src: image.dataUrl, alt: `Chart: ${section.title}` } });
    if (section.narrative) blocks.push(...prose(section.narrative));
  });

  if (report.recommendations.length) {
    blocks.push(heading(2, 'Recommendations'), {
      type: 'orderedList',
      content: report.recommendations.map((rec) => {
        const priority = PRIORITY_LABEL[rec.priority];
        const parts: JSONContent[] = [
          paragraph(
            text(plainText(rec.title), [{ type: 'bold' }]),
            ...(priority ? [text(`  ${priority}`, colored(ACCENT))] : [])
          ),
        ];
        if (rec.action) parts.push(paragraph(text(plainText(rec.action))));
        if (rec.rationale) parts.push(paragraph(text(`Why: ${plainText(rec.rationale)}`, colored(MUTED))));
        return { type: 'listItem', content: parts };
      }),
    });
  }
  if (report.followUps.length) {
    blocks.push(heading(2, 'Questions to explore next'), bulletList(report.followUps.map(plainText)));
  }

  const content: JSONContent = { type: 'doc', content: blocks };
  return {
    title,
    body: { content, page: { size: 'a4', margins: 'normal', orientation: 'portrait' } },
    meta: { words: countWords(documentText(content)) },
  };
}
