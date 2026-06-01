'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Button, Input, Space, Spin, Typography, Alert } from 'antd';
import { RocketOutlined, RobotOutlined, ReloadOutlined, CloseOutlined, SendOutlined } from '@ant-design/icons';
import { getChatHref } from '@/utils/appPaths';
import { useRouter } from 'next/navigation';
import { ChartTypeSelect } from '@/components/charts/ChartTypeSelect';
import { INTERACTIVE_CHART_TYPES } from '@/components/charts/chartTypeCatalog';

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

/** Parse SSE lines from a streamed fetch response */
async function* streamAnalyze(prompt: string, dataContext: string): AsyncGenerator<string> {
  const response = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: prompt,
      context: dataContext,
      mode: 'analytics',
      stream: true,
    }),
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
            '';
          if (token) yield token;
        } catch {
          // Non-JSON SSE line — yield as-is (some backends send plain text)
          if (raw && raw !== '[DONE]') yield raw;
        }
      }
    }
  }
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
      parts.push(`Categories sample: ${preview}${data.x.length > 5 ? ` (+ ${data.x.length - 5} more)` : ''}`);
    }
    if (Array.isArray(data.y) && data.y.length) {
      const nums = data.y.filter((v: any) => typeof v === 'number').slice(0, 5);
      if (nums.length) {
        const min = Math.min(...nums).toLocaleString();
        const max = Math.max(...nums).toLocaleString();
        const sum = nums.reduce((a: number, b: number) => a + b, 0);
        const avg = (sum / nums.length).toLocaleString();
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

export const ExplainChartDrawer: React.FC<ExplainChartDrawerProps> = ({ open, onClose, widget, onChangeChartType }) => {
  const router = useRouter();
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState('');
  const abortRef = useRef<(() => void) | null>(null);

  const title = widget?.title || 'this chart';

  /** Navigate to /chat with this widget pre-loaded as context */
  const openInChat = () => {
    router.push(
      getChatHref({
        prompt: `Explain this chart: "${title}". ${buildDataSummary(widget)}`,
        dataSourceId: widget?.dataSourceId,
      }),
    );
    onClose();
  };

  /** Ask a follow-up question in the drawer */
  const askFollowUp = () => {
    if (!followUp.trim()) return;
    const q = followUp.trim();
    setFollowUp('');
    const summary = buildDataSummary(widget);
    const prompt = `Regarding the chart "${title}" with the following data context:\n${summary}\n\nQuestion: ${q}`;
    setLoading(true);
    setError(null);
    setResponse('');
    let cancelled = false;
    abortRef.current = () => { cancelled = true; };
    (async () => {
      try {
        for await (const token of streamAnalyze(prompt, summary)) {
          if (cancelled) break;
          setResponse((prev) => prev + token);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
  };

  const runExplain = async () => {
    if (!widget) return;
    setLoading(true);
    setError(null);
    setResponse('');

    const summary = buildDataSummary(widget);
    const prompt = `You are a data analyst. Explain the insights from this dashboard widget in clear, concise business language. Focus on trends, outliers, and actionable takeaways. Keep your explanation to 3-5 paragraphs.\n\nWidget title: "${title}"\n\nData context:\n${summary}`;

    let cancelled = false;
    abortRef.current = () => { cancelled = true; };

    try {
      for await (const token of streamAnalyze(prompt, summary)) {
        if (cancelled) break;
        setResponse((prev) => prev + token);
      }
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to get AI explanation');
      }
    } finally {
      if (!cancelled) setLoading(false);
    }
  };

  // Auto-run when drawer opens
  useEffect(() => {
    if (open && widget) {
      void runExplain();
    }
    return () => {
      abortRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, widget?.title, widget?.chartType]);

  const handleClose = () => {
    abortRef.current?.();
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
          <Button
            size="small"
            icon={<RocketOutlined />}
            onClick={openInChat}
            type="primary"
            ghost
          >
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0', color: 'var(--ant-color-text-secondary)' }}>
          <Spin size="small" />
          <Typography.Text type="secondary">Analyzing chart data…</Typography.Text>
        </div>
      )}

      {response && (
        <div className="explain-chart-response">
          <Typography.Paragraph
            style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 14 }}
          >
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

      {/* Chart type switcher */}
      {onChangeChartType && widget?.chartType && (
        <div style={{
          marginTop: 16,
          padding: '10px 12px',
          background: 'var(--ant-color-fill-quaternary)',
          borderRadius: 8,
        }}>
          <ChartTypeSelect
            className="chart-type-select"
            value={(widget.chartType || 'bar').toLowerCase()}
            availableTypes={INTERACTIVE_CHART_TYPES}
            onChange={(type) => {
              if (type !== (widget.chartType || '').toLowerCase()) onChangeChartType(type);
            }}
          />
        </div>
      )}

      {/* Follow-up question input */}
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
