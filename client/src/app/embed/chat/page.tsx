'use client';

import React, { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Alert, Button, Card, Input, Spin, Typography, Avatar, Tooltip } from 'antd';
import {
  SendOutlined,
  StopOutlined,
  CopyOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslations } from 'next-intl';
import { getBackendUrl } from '@/utils/backendUrl';
import { notifyEmbedError, notifyEmbedReady, notifyEmbedResize } from '@/utils/embedMessaging';
import { resolveChatChartDisplay, withChartAnimationDefaults } from '@/components/charts/resolveChatChart';
import {
  applyEvent,
  buildCompleteFromAccumulator,
  isSubstantiveCompleteEvent,
} from '@/ee/app/(dashboard)/chat/utils/applyEvent';
import { displayText } from '@/ee/app/(dashboard)/chat/utils/mapAccumulatorToMessage';
import { drainSSEBuffer } from '@/ee/app/(dashboard)/chat/utils/parseSSEBuffer';
import type { StreamingAccumulator } from '@/ee/app/(dashboard)/chat/utils/applyEvent';
import { extractAnalyzeRunView } from '@/ee/app/(dashboard)/chat/hooks/useAnalyzeRun';
import {
  CitationSourcesStrip,
  type CitationItem,
} from '@/ee/components/ai/chat/CitationSourcesStrip';
import ThoughtProcessDisplay from '@/ee/app/(dashboard)/chat/components/ChatPanel/ThoughtProcessDisplay';
import { buildDashboardStudioLink } from '@/ee/app/(dashboard)/chat/utils/chatDeepLinks';
import { isDashboardAutoOpenEnabled } from '@/app/(dashboard)/dashboards/utils/dashboardAutoOpenStorage';

const DashboardPlanCard = dynamic(
  () =>
    import('@/ee/app/(dashboard)/chat/components/ChatPanel/DashboardPlanCard').then(
      (m) => m.DashboardPlanCard,
    ),
  { ssr: false, loading: () => <Spin size="small" /> },
);

const SharedChartRenderer = dynamic(
  () => import('@/components/charts/SharedChartRenderer').then((m) => m.SharedChartRenderer),
  { ssr: false, loading: () => <Spin style={{ margin: '12px auto', display: 'block' }} /> },
);

const EmbedEChartsFallback = dynamic(
  () => import('@/components/charts/EmbedEChartsFallback').then((m) => m.EmbedEChartsFallback),
  { ssr: false, loading: () => <Spin style={{ margin: '12px auto', display: 'block' }} /> },
);

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
  chartConfig?: unknown;
  queryResult?: Record<string, unknown>[] | null;
  citations?: CitationItem[];
  progress?: { stage?: string; message?: string; percentage?: number };
  dashboardKpiPlan?: Record<string, unknown>;
  dashboardWidgetsReady?: Array<{
    index: number;
    title: string;
    chart_type: string;
    status?: string;
  }>;
  dashboardCreated?: Record<string, unknown> | null;
  followUpQuestions?: string[];
}

function resolveAnalysisMode(config: { allowed_modes?: string[]; capabilities?: string } | null): string {
  if (!config) return 'standard';
  if (config.allowed_modes?.length) return config.allowed_modes[0];
  return config.capabilities === 'full_engine' ? 'standard' : 'ai_search';
}

function isNarrationToken(evt: Record<string, unknown>): boolean {
  if (evt.type !== 'token' || !evt.chunk) return false;
  return (
    evt.kind === 'narration' ||
    evt.node === 'rag_synthesis' ||
    evt.node === 'conversational' ||
    evt.kind === undefined
  );
}

function buildAssistantPatch(
  acc: StreamingAccumulator,
  narration: string,
  streaming: boolean,
): Partial<ChatMessage> {
  const view = extractAnalyzeRunView(acc);
  const pr = acc.partial_results || {};
  const content =
    narration ||
    displayText(pr, narration) ||
    (typeof acc.message === 'string' ? acc.message : '');
  const chartCfg = view.chartConfig ?? (pr as Record<string, unknown>).primary_chart;

  return {
    content: content || (streaming ? '' : '*(no response)*'),
    streaming,
    chartConfig: chartCfg,
    queryResult: (view.queryResult as Record<string, unknown>[] | null) ?? null,
    citations: (view.citations as CitationItem[]) ?? [],
    progress: view.progress ?? undefined,
    dashboardKpiPlan: view.dashboardKpiPlan,
    dashboardWidgetsReady: (view.dashboardWidgetsReady || []) as ChatMessage['dashboardWidgetsReady'],
    dashboardCreated: view.dashboardCreated ?? null,
    followUpQuestions: view.followUpQuestions,
  };
}

const isEE = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

function EmbedChatContent() {
  const tEmbed = useTranslations('embed_chat');
  const tChatPage = useTranslations('chat_page');
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';
  const assistantId = searchParams?.get('assistant_id') || '';
  const libraryIdsParam = searchParams?.get('library_ids') || '';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantConfig, setAssistantConfig] = useState<{
    library_ids?: string[];
    allowed_modes?: string[];
    capabilities?: string;
    primary_data_source_id?: string;
    name?: string;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dashboardAutoOpenedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    notifyEmbedReady({ kind: 'chat', ee: isEE });
    notifyEmbedResize(520);
  }, []);

  useEffect(() => {
    if (!assistantId || !isEE) return;
    const base = getBackendUrl();
    fetch(`${base}/api/embed/assistants/${assistantId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setAssistantConfig(data);
      })
      .catch(() => {});
  }, [assistantId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    const h = Math.min(720, Math.max(520, 160 + messages.length * 100));
    notifyEmbedResize(h);
  }, [messages]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.streaming
          ? { ...m, streaming: false, content: m.content || tEmbed('cancelled') }
          : m,
      ),
    );
  }, [tEmbed]);

  const openDashboard = useCallback((created: Record<string, unknown>, messageId: string) => {
    const dashId = created.dashboard_id;
    if (typeof dashId !== 'string') return;
    const pageId = typeof created.page_id === 'string' ? created.page_id : undefined;
    const isLive = created.status === 'building';
    const url = buildDashboardStudioLink(dashId, pageId, messageId);
    const qs = isLive ? `${url.includes('?') ? '&' : '?'}live=1` : '';
    window.open(`${url}${qs}`, '_blank', 'noopener,noreferrer');
  }, []);

  const handleSend = useCallback(
    async (overridePrompt?: string) => {
      const text = (overridePrompt ?? prompt).trim();
      if (!text || loading) return;

      setError(null);
      setPrompt('');

      const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: 'user', content: text };
      const aiMsgId = `a_${Date.now()}`;
      const aiMsg: ChatMessage = { id: aiMsgId, role: 'assistant', content: '', streaming: true };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setLoading(true);

      const base = getBackendUrl();
      const libraryIds = assistantConfig?.library_ids?.length
        ? assistantConfig.library_ids
        : libraryIdsParam
          ? libraryIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
          : [];

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        headers['X-Embed-Token'] = token;
      }

      const analysisMode = resolveAnalysisMode(assistantConfig);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${base}/ai/analyze`, {
          method: 'POST',
          headers,
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({
            query: text,
            analysis_mode: analysisMode,
            data_source_id: assistantConfig?.primary_data_source_id || undefined,
            kb_library_ids: libraryIds.length ? libraryIds : undefined,
            stream: true,
          }),
        });

        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.detail || detail.message || `Request failed (${res.status})`);
        }

        const contentType = res.headers.get('content-type') || '';
        const isStream =
          contentType.includes('text/event-stream') || contentType.includes('text/plain');

        if (isStream && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let narration = '';
          let streamAcc: StreamingAccumulator = {};

          const syncAssistant = (acc: StreamingAccumulator, stream: boolean) => {
            const patch = buildAssistantPatch(acc, narration, stream);
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, ...patch } : m)),
            );
            const created = patch.dashboardCreated;
            const dashId =
              created && typeof created.dashboard_id === 'string' ? created.dashboard_id : null;
            if (
              dashId &&
              created?.status === 'building' &&
              isDashboardAutoOpenEnabled() &&
              !dashboardAutoOpenedRef.current.has(dashId)
            ) {
              dashboardAutoOpenedRef.current.add(dashId);
              openDashboard(created, aiMsgId);
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer = drainSSEBuffer(buffer + decoder.decode(value, { stream: true }), (data) => {
              const evt = data as Record<string, unknown>;
              if (isNarrationToken(evt)) {
                narration += String(evt.chunk);
                syncAssistant(streamAcc, true);
                return;
              }

              streamAcc = applyEvent(streamAcc, evt as Parameters<typeof applyEvent>[1]);
              syncAssistant(streamAcc, true);

              const isCompleteEvt =
                evt.type === 'complete' ||
                evt.event_type === 'complete' ||
                evt.type === 'dashboard_created';
              if (isCompleteEvt && isSubstantiveCompleteEvent(evt)) {
                const completePayload = buildCompleteFromAccumulator(
                  streamAcc,
                  text,
                  'Analysis complete.',
                );
                narration =
                  displayText(streamAcc.partial_results, narration) ||
                  String(completePayload.message || narration);
                streamAcc = applyEvent(streamAcc, completePayload as Parameters<typeof applyEvent>[1]);
                syncAssistant(streamAcc, false);
              }
            });
          }

          syncAssistant(streamAcc, false);
        } else {
          const data = await res.json();
          const answer =
            data.summary ||
            data.answer ||
            data.message ||
            data.analysis ||
            (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
          const chartCfg = data.echarts_config || data.chart_config || data.primary_chart;
          const qr = Array.isArray(data.query_result) ? data.query_result : null;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: answer,
                    streaming: false,
                    chartConfig: chartCfg,
                    queryResult: qr,
                    citations: data.citations || data.rag_citations || [],
                  }
                : m,
            ),
          );
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Chat request failed';
        setError(msg);
        notifyEmbedError(msg, 'chat_request_failed');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: `*Error: ${msg}*`, streaming: false, error: true }
              : m,
          ),
        );
      } finally {
        setLoading(false);
        abortRef.current = null;
        setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
      }
    },
    [prompt, loading, assistantConfig, token, libraryIdsParam, openDashboard],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  if (!isEE) {
    return (
      <Alert
        type="info"
        showIcon
        message={tEmbed('ee_required_title')}
        description={tEmbed('ee_required_desc')}
        style={{ margin: 24 }}
      />
    );
  }

  const assistantName = assistantConfig?.name || 'Aicser AI';
  const resolvedAnalysisMode = resolveAnalysisMode(assistantConfig);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 420,
        maxHeight: 720,
        background: 'var(--ant-color-bg-layout, #f5f5f5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          background: 'var(--ant-color-bg-container, #fff)',
          borderBottom: '1px solid var(--ant-color-border, #e8e8e8)',
          flexShrink: 0,
        }}
      >
        <Avatar
          size={30}
          icon={<RobotOutlined />}
          style={{ background: 'var(--ant-color-primary, #1677ff)', flexShrink: 0 }}
        />
        <Text strong style={{ fontSize: 14 }}>
          {assistantName}
        </Text>
        {loading && <Spin size="small" style={{ marginLeft: 'auto' }} />}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Avatar
              size={48}
              icon={<RobotOutlined />}
              style={{ background: 'var(--ant-color-primary, #1677ff)', marginBottom: 12 }}
            />
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              {tEmbed('welcome', { name: assistantName })}
            </Paragraph>
          </div>
        )}

        {messages.map((msg) => {
          const chartDisplay =
            msg.role === 'assistant' && msg.chartConfig
              ? resolveChatChartDisplay(msg.chartConfig, msg.queryResult, msg)
              : { mode: 'none' as const };
          const hasHybridData = !!(msg.chartConfig || (msg.queryResult && msg.queryResult.length > 0));
          const showDashboardPlan =
            msg.role === 'assistant' &&
            (msg.dashboardKpiPlan ||
              msg.dashboardWidgetsReady?.length ||
              msg.dashboardCreated?.dashboard_id);

          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <Avatar
                size={28}
                icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                style={{
                  background: msg.role === 'user' ? '#87d068' : 'var(--ant-color-primary, #1677ff)',
                  flexShrink: 0,
                }}
              />
              <Card
                size="small"
                style={{
                  maxWidth: '85%',
                  background:
                    msg.role === 'user'
                      ? 'var(--ant-color-primary-bg, #e6f4ff)'
                      : msg.error
                        ? 'var(--ant-color-error-bg, #fff2f0)'
                        : 'var(--ant-color-bg-container, #fff)',
                  border: msg.error ? '1px solid var(--ant-color-error-border, #ffccc7)' : undefined,
                  borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                }}
                styles={{ body: { padding: '8px 12px' } }}
                extra={
                  msg.role === 'assistant' && !msg.streaming && msg.content ? (
                    <Tooltip title={tEmbed('copy')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => copyToClipboard(msg.content)}
                        style={{ opacity: 0.5 }}
                      />
                    </Tooltip>
                  ) : undefined
                }
              >
                {msg.role === 'user' ? (
                  <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{msg.content}</Text>
                ) : msg.streaming && !msg.content && !msg.progress?.message ? (
                  <ThoughtProcessDisplay
                    compact
                    isThinking
                    isDark={false}
                    currentStage="thinking"
                    progressMessage="Thinking"
                    rotatingMessage="Thinking"
                  />
                ) : (
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    {msg.streaming && msg.progress && (
                      <div style={{ marginBottom: msg.content ? 10 : 0 }}>
                        <ThoughtProcessDisplay
                          compact
                          isDark={false}
                          currentStage={msg.progress.stage}
                          progressMessage={msg.progress.message}
                          progressPercentage={msg.progress.percentage}
                          analyticsType={
                            resolvedAnalysisMode === 'ai_search'
                              ? 'ai_search'
                              : resolvedAnalysisMode === 'dashboard'
                                ? 'dashboard'
                                : 'descriptive'
                          }
                          isKnowledgeBase={resolvedAnalysisMode === 'ai_search'}
                        />
                      </div>
                    )}

                    {showDashboardPlan && (
                      <div style={{ marginBottom: msg.content ? 10 : 0 }}>
                        <DashboardPlanCard
                          tier={String(msg.dashboardKpiPlan?.tier || 'operational')}
                          targetWidgets={Number(
                            msg.dashboardKpiPlan?.section_count ||
                              (msg.dashboardKpiPlan?.sections as unknown[] | undefined)?.length ||
                              8,
                          )}
                          sections={
                            (msg.dashboardKpiPlan?.sections || []) as Array<{
                              title?: string;
                              chart_type?: string;
                            }>
                          }
                          widgetsReady={msg.dashboardWidgetsReady || []}
                          isStreaming={!!msg.streaming}
                          dashboardCreated={msg.dashboardCreated ?? null}
                          fromChatMessageId={msg.id}
                          onOpenDashboard={() => {
                            if (msg.dashboardCreated) openDashboard(msg.dashboardCreated, msg.id);
                          }}
                        />
                      </div>
                    )}

                    {msg.content ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
                          ul: ({ children }) => (
                            <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>
                          ),
                          li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                          code: ({ children, className }) => {
                            const isBlock = className?.includes('language-');
                            return isBlock ? (
                              <pre
                                style={{
                                  background: 'var(--ant-color-fill-quaternary, #f5f5f5)',
                                  borderRadius: 6,
                                  padding: '8px 12px',
                                  overflowX: 'auto',
                                  fontSize: 12,
                                }}
                              >
                                <code>{children}</code>
                              </pre>
                            ) : (
                              <code
                                style={{
                                  background: 'var(--ant-color-fill-quaternary, #f5f5f5)',
                                  borderRadius: 3,
                                  padding: '1px 5px',
                                  fontSize: 12,
                                }}
                              >
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : null}

                    {msg.streaming && (
                      <span
                        style={{
                          display: 'inline-block',
                          width: 2,
                          height: '1em',
                          background: 'currentColor',
                          animation: 'blink 1s step-end infinite',
                          verticalAlign: 'text-bottom',
                          marginLeft: 1,
                        }}
                      />
                    )}

                    {msg.citations && msg.citations.length > 0 && (
                      <CitationSourcesStrip
                        citations={msg.citations}
                        isHybrid={hasHybridData}
                        openInNewTab
                        t={(key, values) => tChatPage(key, values as Record<string, string | number>)}
                      />
                    )}

                    {chartDisplay.mode === 'shared' && (
                      <div style={{ marginTop: 12 }}>
                        <SharedChartRenderer
                          chartType={chartDisplay.props.chartType}
                          chartData={chartDisplay.props.chartData}
                          chartOptions={chartDisplay.props.chartOptions}
                          chartQuery={chartDisplay.props.chartQuery}
                          minHeight={240}
                        />
                      </div>
                    )}
                    {chartDisplay.mode === 'echarts' && (
                      <EmbedEChartsFallback
                        config={withChartAnimationDefaults(chartDisplay.config)}
                        minHeight={240}
                      />
                    )}

                    {!msg.streaming && msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {msg.followUpQuestions.slice(0, 4).map((q) => (
                          <Button
                            key={q}
                            size="small"
                            type="default"
                            onClick={() => void handleSend(q)}
                            style={{ fontSize: 12, borderRadius: 16, height: 'auto', padding: '2px 10px' }}
                          >
                            {q}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          );
        })}

        {messages.length > 0 && messages[messages.length - 1]?.error && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => {
                const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                if (lastUser) void handleSend(lastUser.content);
              }}
            >
              {tEmbed('retry')}
            </Button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <Alert
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
          style={{ margin: '0 16px 8px', flexShrink: 0 }}
        />
      )}

      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--ant-color-border, #e8e8e8)',
          background: 'var(--ant-color-bg-container, #fff)',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
          flexShrink: 0,
        }}
      >
        <TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tEmbed('input_placeholder')}
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={loading}
          style={{ flex: 1, resize: 'none', borderRadius: 8, fontSize: 13 }}
        />
        {loading ? (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={handleStop}
            style={{ flexShrink: 0, borderRadius: 8 }}
          >
            Stop
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => void handleSend()}
            disabled={!prompt.trim()}
            style={{ flexShrink: 0, borderRadius: 8 }}
          >
            Send
          </Button>
        )}
      </div>

      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes typingDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default function EmbedChatPage() {
  return (
    <Suspense fallback={<Spin style={{ margin: 48 }} />}>
      <EmbedChatContent />
    </Suspense>
  );
}
