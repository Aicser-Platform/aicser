'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Button, Input, Space, Spin, Typography, Alert } from 'antd';
import { RocketOutlined, RobotOutlined, ReloadOutlined, CloseOutlined, SendOutlined } from '@ant-design/icons';
import { getChatHref } from '@/utils/appPaths';
import { useRouter } from 'next/navigation';
import { ChartTypeSelect } from '@/components/charts/ChartTypeSelect';
import { DASHBOARD_SWITCHABLE_CHART_TYPES } from '@/components/charts/chartTypeCatalog';
import { fetchApi } from '@/utils/api';
import { useProjectStore } from '@/stores/useProjectStore';

interface ExplainChartDrawerProps {
  open: boolean;
  onClose: () => void;
  widget: {
    title?: string;
    chartType?: string;
    chartData?: any;
    chartQuery?: any;
    dataSourceId?: string;
  } | null;
  /** Called when user picks a different chart type from the inline switcher */
  onChangeChartType?: (chartType: string) => void;
}

/** User-facing error only — never echo prompts, payloads, or pydantic dumps. */
function formatExplainError(err: unknown): string {
  const fallback = 'Could not generate explanation. Try again or continue in AI Chat.';
  if (!(err instanceof Error)) return fallback;
  const raw = err.message?.trim() || '';
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.detail === 'string') return parsed.detail;
    if (typeof parsed?.message === 'string' && parsed.message.length < 180) return parsed.message;
    if (parsed?.error === 'validation_error') {
      return 'Explanation request failed validation. Try again or open in AI Chat.';
    }
  } catch {
    /* plain text */
  }

  if (
    raw.length > 180 ||
    raw.includes('You are a data analyst') ||
    raw.includes('"question"') ||
    raw.includes('"query"') ||
    raw.includes('pydantic') ||
    raw.includes('Field required')
  ) {
    return fallback;
  }
  return raw;
}

function buildDataSummary(widget: ExplainChartDrawerProps['widget']): string {
  if (!widget) return '';
  const parts: string[] = [];

  if (widget.chartType) parts.push(`Chart type: ${widget.chartType}`);
  if (widget.chartQuery?.tableName) parts.push(`Table: ${widget.chartQuery.tableName}`);
  if (widget.chartQuery?.x) parts.push(`X-axis field: ${widget.chartQuery.x}`);

  const yMetrics: any[] = widget.chartQuery?.yMetrics || [];
  if (yMetrics.length) {
    const metricDesc = yMetrics
      .map((m: any) => `${m.aggregation ?? 'count'}(${m.field ?? ''})`)
      .join(', ');
    parts.push(`Metrics: ${metricDesc}`);
  }

  const data = widget.chartData;
  if (data) {
    if (Array.isArray(data.x) && data.x.length) {
      const preview = data.x.slice(0, 5).join(', ');
      parts.push(
        `Categories sample: ${preview}${data.x.length > 5 ? ` (+ ${data.x.length - 5} more)` : ''}`,
      );
    }
    if (Array.isArray(data.y) && data.y.length) {
      const nums = data.y.filter((v: any) => typeof v === 'number');
      if (nums.length) {
        const min = Math.min(...nums).toLocaleString();
        const max = Math.max(...nums).toLocaleString();
        const avg = (nums.reduce((a: number, b: number) => a + b, 0) / nums.length).toLocaleString();
        parts.push(`Values — min: ${min}, max: ${max}, avg: ${avg}`);
      }
    }
    const series: any[] = data.series || [];
    if (series.length) {
      parts.push(`Series count: ${series.length}`);
    }
  }

  return parts.join('\n');
}

/** Plain user question — no system-role instructions (those belong on the server). */
function buildExplainQuery(title: string, summary: string, followUp?: string): string {
  if (followUp?.trim()) {
    return `Regarding the dashboard widget "${title}":\n${summary}\n\n${followUp.trim()}`;
  }
  return `Explain the insights from the dashboard widget "${title}" in clear business language. Focus on trends, outliers, and actionable takeaways (3–5 short paragraphs).\n\nWidget data context:\n${summary || 'No summary available.'}`;
}

async function ensureExplainConversation(opts: {
  title: string;
  projectId?: string | number | null;
  dataSourceId?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    title: `Explain: ${opts.title}`.slice(0, 100),
    type: 'chat2chart',
    json_metadata: JSON.stringify({ source: 'widget_explain', ephemeral: true }),
  };
  if (opts.projectId != null && String(opts.projectId).trim()) {
    body.project_id = String(opts.projectId);
  }
  if (opts.dataSourceId) {
    body.data_source_id = opts.dataSourceId;
  }
  const conv = await fetchApi<{ id: string }>('/conversations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!conv?.id) throw new Error('Could not start explanation session');
  return conv.id;
}

/** Parse SSE lines from a streamed fetch response */
async function* streamAnalyze(args: {
  query: string;
  conversationId: string;
  dataSourceId?: string;
  projectId?: string | number | null;
}): AsyncGenerator<string> {
  const body: Record<string, unknown> = {
    query: args.query,
    conversation_id: args.conversationId,
    analytics_type: 'descriptive',
    analysis_mode: 'standard',
    stream: true,
  };
  if (args.dataSourceId) body.data_source_id = args.dataSourceId;
  if (args.projectId != null && String(args.projectId).trim()) {
    body.project_id = String(args.projectId);
  }

  const response = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const err = await response.text().catch(() => 'Unknown error');
    throw new Error(err);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') return;
        try {
          const parsed = JSON.parse(raw);
          const token =
            parsed?.choices?.[0]?.delta?.content ??
            parsed?.text ??
            parsed?.content ??
            parsed?.answer ??
            parsed?.delta ??
            '';
          if (token) yield String(token);
        } catch {
          if (raw && raw !== '[DONE]') yield raw;
        }
      }
    }
  }
}

export const ExplainChartDrawer: React.FC<ExplainChartDrawerProps> = ({
  open,
  onClose,
  widget,
  onChangeChartType,
}) => {
  const router = useRouter();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState('');
  const abortRef = useRef<(() => void) | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  const title = widget?.title || 'this chart';

  const openInChat = () => {
    const summary = buildDataSummary(widget);
    router.push(
      getChatHref({
        prompt: buildExplainQuery(title, summary),
        dataSourceId: widget?.dataSourceId,
      }),
    );
    onClose();
  };

  const runStream = async (query: string) => {
    if (!widget) return;
    setLoading(true);
    setError(null);
    setResponse('');

    let cancelled = false;
    abortRef.current = () => {
      cancelled = true;
    };

    try {
      if (!conversationIdRef.current) {
        conversationIdRef.current = await ensureExplainConversation({
          title,
          projectId,
          dataSourceId: widget.dataSourceId,
        });
      }
      for await (const token of streamAnalyze({
        query,
        conversationId: conversationIdRef.current,
        dataSourceId: widget.dataSourceId,
        projectId,
      })) {
        if (cancelled) break;
        setResponse((prev) => prev + token);
      }
    } catch (err) {
      if (!cancelled) setError(formatExplainError(err));
    } finally {
      if (!cancelled) setLoading(false);
    }
  };

  const askFollowUp = () => {
    if (!followUp.trim()) return;
    const q = followUp.trim();
    setFollowUp('');
    const summary = buildDataSummary(widget);
    void runStream(buildExplainQuery(title, summary, q));
  };

  const runExplain = async () => {
    if (!widget) return;
    const summary = buildDataSummary(widget);
    await runStream(buildExplainQuery(title, summary));
  };

  useEffect(() => {
    if (open && widget) {
      conversationIdRef.current = null;
      void runExplain();
    }
    return () => {
      abortRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, widget?.title, widget?.chartType]);

  const handleClose = () => {
    abortRef.current?.();
    conversationIdRef.current = null;
    onClose();
  };

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RobotOutlined style={{ color: 'var(--ant-color-primary)' }} />
          <span>Explain: {title}</span>
        </div>
      }
      placement="right"
      width={420}
      open={open}
      onClose={handleClose}
      closeIcon={<CloseOutlined />}
      extra={
        <Space size="small">
          <Button size="small" icon={<RocketOutlined />} onClick={openInChat} type="primary" ghost>
            Open in AI Chat
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void runExplain()}
            loading={loading}
            disabled={loading}
          >
            Redo
          </Button>
        </Space>
      }
      styles={{
        body: { padding: '16px 20px', overflowY: 'auto' },
      }}
    >
      {error && (
        <Alert
          type="error"
          message="Could not generate explanation"
          description={error}
          showIcon
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setError(null)}
        />
      )}

      {loading && !response && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '24px 0',
            color: 'var(--ant-color-text-secondary)',
          }}
        >
          <Spin size="small" />
          <Typography.Text type="secondary">Analyzing chart data…</Typography.Text>
        </div>
      )}

      {response && (
        <div className="explain-chart-response">
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 14 }}>
            {response}
            {loading && <span className="explain-cursor">▋</span>}
          </Typography.Paragraph>
        </div>
      )}

      {!loading && !response && !error && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ant-color-text-quaternary)' }}>
          <RobotOutlined style={{ fontSize: 32, marginBottom: 12 }} />
          <Typography.Text type="secondary" style={{ display: 'block' }}>
            AI explanation will appear here
          </Typography.Text>
        </div>
      )}

      {onChangeChartType && widget?.chartType && (
        <div
          style={{
            marginTop: 16,
            padding: '10px 12px',
            background: 'var(--ant-color-fill-quaternary)',
            borderRadius: 8,
          }}
        >
          <ChartTypeSelect
            className="chart-type-select"
            value={(widget.chartType || 'bar').toLowerCase()}
            availableTypes={DASHBOARD_SWITCHABLE_CHART_TYPES}
            onChange={(type) => {
              if (type !== (widget.chartType || '').toLowerCase()) onChangeChartType(type);
            }}
          />
        </div>
      )}

      {!loading && (response || error) && (
        <div style={{ marginTop: 20, borderTop: '1px solid var(--ant-color-border-secondary)', paddingTop: 14 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
            Ask a follow-up question about this chart
          </Typography.Text>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="small"
              placeholder="e.g. What's driving the spike in March?"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onPressEnter={askFollowUp}
            />
            <Button
              size="small"
              type="primary"
              icon={<SendOutlined />}
              onClick={askFollowUp}
              disabled={!followUp.trim()}
            />
          </Space.Compact>
          <Button
            type="link"
            size="small"
            icon={<RocketOutlined />}
            onClick={openInChat}
            style={{ padding: 0, marginTop: 6, fontSize: 12 }}
          >
            Continue this analysis in AI Chat →
          </Button>
        </div>
      )}
    </Drawer>
  );
};

export default ExplainChartDrawer;
