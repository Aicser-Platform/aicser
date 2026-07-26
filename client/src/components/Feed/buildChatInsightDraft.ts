import { buildChatMessagePinSource, type ChatMessagePinSource } from '@/components/charts/buildChatChartPinPayload';
import { hydrateChartConfigFromQueryResult } from '@/components/charts/hydrateChartConfig';
import { resolveSharedChartProps } from '@/components/charts/echartsToSharedWidget';
import { extractEchartsSnapshotOption } from '@/components/charts/resolveChatChart';
import type { ChartData } from '@/app/(dashboard)/dashboards/widgets/WidgetRendererConfig';
import {
  type ChatFeedDraft,
  type ChatFeedChartPreview,
  getQuestionFromThread,
  truncateWithEllipsis,
} from './chatFeedDraft';
import { buildInsightSnapshotPayload } from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';

function extractChartTitleFromConfig(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  const title = c.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  if (title && typeof title === 'object') {
    const text = (title as { text?: string }).text;
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return null;
}

function extractPreviewData(chartData: ChartData): number[] {
  const series = chartData.series?.[0]?.data;
  if (Array.isArray(series) && series.length > 0) {
    return series.slice(0, 8).map((v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (v && typeof v === 'object' && 'value' in (v as object)) {
        return Number((v as { value: unknown }).value) || 0;
      }
      return Number(v) || 0;
    });
  }
  if (Array.isArray(chartData.y) && chartData.y.length > 0) {
    return chartData.y.slice(0, 8).map((v) => Number(v) || 0);
  }
  return [];
}

function resolvePreviewType(chartType: string): string {
  if (chartType === 'pie' || chartType === 'donut') return 'pie';
  if (chartType === 'line' || chartType === 'area') return 'line';
  if (chartType === 'bar') return 'bar';
  return 'insight';
}

/**
 * Chat answers are markdown meant for the chat bubble (bold, headers, fenced
 * SQL blocks) — used verbatim as a feed excerpt, the raw syntax and embedded
 * query leak straight through ("**SQL Query:** ```sql SELECT...```"). Strips
 * that down to the plain-text sentence a reader is meant to see.
 */
function plainTextExcerpt(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks (SQL, etc.) — not excerpt material
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/^#{1,6}\s+/gm, '') // headers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildChatInsightDraft(params: {
  conversationId: string;
  messageId: string;
  messages: Array<{ query?: string; answer?: string }>;
  messageIndex: number;
  message: Record<string, unknown>;
  sqlSnippet?: string | null;
}): ChatFeedDraft {
  const { conversationId, messageId, messages, messageIndex, message, sqlSnippet } = params;
  const pinSource: ChatMessagePinSource = buildChatMessagePinSource(message as ChatMessagePinSource);
  const queryResult = (message.queryResult as Record<string, unknown>[] | null | undefined) ?? null;
  const rawConfig = message.echartsConfig || message.chartConfig;
  const hydrated = hydrateChartConfigFromQueryResult(rawConfig, queryResult);
  const shared = resolveSharedChartProps(hydrated, queryResult, message);
  const questionTitle = getQuestionFromThread(messages, messageIndex);
  const chartTitle =
    extractChartTitleFromConfig(hydrated) ||
    (pinSource.title && pinSource.title !== 'Chart from chat' ? pinSource.title : null);

  const title =
    chartTitle ||
    questionTitle ||
    truncateWithEllipsis(String(message.answer || 'Insight'), 120);

  const hasChart = Boolean(rawConfig);
  const hasSql = Boolean(sqlSnippet?.trim());

  let chartPreview: ChatFeedChartPreview | undefined;
  let previewType = 'insight';
  let previewData: number[] = [];

  if (shared) {
    chartPreview = {
      chartType: shared.chartType,
      chartData: shared.chartData,
      chartOptions: { ...shared.chartOptions, __source: 'ai_chat' },
      chartQuery: shared.chartQuery,
    };
    previewData = extractPreviewData(shared.chartData);
    previewType = resolvePreviewType(shared.chartType);
  } else if (hasChart) {
    const snapshot = extractEchartsSnapshotOption(hydrated);
    if (snapshot) {
      chartPreview = {
        chartType: pinSource.chartType || 'bar',
        chartOptions: { __echartsSnapshot: snapshot, __source: 'ai_chat' },
        chartQuery: pinSource.chartQuery as Record<string, unknown> | undefined,
      };
      previewType = resolvePreviewType(pinSource.chartType || 'bar');
    }
  }

  // Prefer the purpose-built executive summary (short, clean prose) over the
  // full chat answer, which routinely embeds a stats dump and a fenced SQL
  // block meant for the chat bubble, not a feed excerpt.
  const executiveSummary =
    typeof message.executiveSummary === 'string'
      ? message.executiveSummary
      : typeof message.executive_summary === 'string'
        ? message.executive_summary
        : '';
  const answerText = typeof message.answer === 'string' ? message.answer.trim() : '';
  const excerptSource = executiveSummary.trim() || answerText;
  const cleanExcerpt = excerptSource ? plainTextExcerpt(excerptSource) : '';

  return {
    conversationId,
    messageId,
    title,
    questionTitle,
    description: undefined,
    excerpt: cleanExcerpt ? truncateWithEllipsis(cleanExcerpt, 320) : undefined,
    hasChart,
    hasSql,
    chartPreview,
    previewMetadata: {
      previewType,
      previewData,
      previewLabel: title,
      hasChart,
      hasSql,
      conversationId,
      messageId,
      ...(questionTitle ? { questionTitle } : {}),
      ...(cleanExcerpt ? { excerpt: truncateWithEllipsis(cleanExcerpt, 2000) } : {}),
      ...(sqlSnippet ? { sql: sqlSnippet.slice(0, 500) } : {}),
      ...(chartPreview ? { chartWidget: chartPreview } : {}),
    },
    snapshotPayload: buildInsightSnapshotPayload({
      title,
      questionTitle,
      excerpt: cleanExcerpt ? truncateWithEllipsis(cleanExcerpt, 320) : undefined,
      chartPreview,
      conversationId,
      messageId,
    }),
  };
}
