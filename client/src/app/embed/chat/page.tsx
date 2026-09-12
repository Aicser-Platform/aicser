'use client';

import React, { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Alert, Button, Card, Input, Typography, Avatar, Tooltip } from 'antd';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
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
import { notifyEmbedError, notifyEmbedReady, notifyEmbedResize, parseEmbedErrorDetail } from '@/utils/embedMessaging';
import { getOrCreateEmbedVisitorId } from '@/utils/embedVisitorId';
import { useEmbedTheme } from '@/hooks/useEmbedTheme';
import { EmbedBrandingFooter } from '@/components/embed/EmbedBrandingFooter';
import { resolveChatChartDisplay, withChartAnimationDefaults } from '@/components/charts/resolveChatChart';
import {
  applyEvent,
  buildCompleteFromAccumulator,
  buildDashboardStudioLink,
  CitationSourcesStrip,
  displayText,
  drainSSEBuffer,
  extractAnalyzeRunView,
  isNarrationToken,
  isSubstantiveCompleteEvent,
  type CitationItem,
  type StreamingAccumulator,
  ThoughtProcessDisplay,
} from '@/ee';
import { isDashboardAutoOpenEnabled } from '@/app/(dashboard)/dashboards/utils/dashboardAutoOpenStorage';

const dynamicChunkLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
    <AppLoadingIndicator variant="minimal" />
  </div>
);

const DashboardPlanCard = dynamic(
  () => import('@/ee').then((m) => m.DashboardPlanCard),
  { ssr: false, loading: dynamicChunkLoading },
);

const SharedChartRenderer = dynamic(
  () => import('@/components/charts/SharedChartRenderer').then((m) => m.SharedChartRenderer),
  { ssr: false, loading: dynamicChunkLoading },
);

const EmbedEChartsFallback = dynamic(
  () => import('@/components/charts/EmbedEChartsFallback').then((m) => m.EmbedEChartsFallback),
  { ssr: false, loading: dynamicChunkLoading },
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
    status?: 'pending' | 'ready' | 'failed';
  }>;
  dashboardCreated?: Record<string, unknown> | null;
  followUpQuestions?: string[];
}

function resolveAnalysisMode(config: { allowed_modes?: string[]; capabilities?: string } | null): string {
  if (!config) return 'standard';
  if (config.allowed_modes?.length) return config.allowed_modes[0];
  return config.capabilities === 'full_engine' ? 'standard' : 'ai_search';
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
  const { theme, themeStyle, dataTheme } = useEmbedTheme(token);

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
    project_id?: string;
    welcome_message?: string;
    conversation_starters?: string[];
    icon_emoji?: string;
    color?: string;
    hide_aicser_branding?: boolean;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dashboardAutoOpenedRef = useRef<Set<string>>(new Set());
  // Per-browser visitor identity (see utils/embedVisitorId.ts) — generated
  // once on mount, sent on every embed-scoped analyze request so the backend
  // can tell distinct anonymous visitors of this same widget apart.
  const visitorIdRef = useRef<string>('');
  // Conversation id minted by the embed-scoped analyze endpoint on the first
  // send of this page session; reused on every subsequent send so replies
  // land in the same (visitor-isolated) conversation. Null until the first
  // successful send.
  const conversationIdRef = useRef<string | null>(null);
  // Once the embed-scoped endpoint has told us (via a 403) that this
  // assistant is left at the default "session" auth_mode — meaning it does
  // NOT accept embed tokens and expects a real logged-in session instead
  // (the Settings > Embed preview, opened same-origin by an already-logged
  // -in admin) — stop retrying it and use the legacy session-cookie path
  // for the rest of this page session.
  const useLegacyEndpointRef = useRef<boolean>(false);

  useEffect(() => {
    visitorIdRef.current = getOrCreateEmbedVisitorId();
    notifyEmbedReady({ kind: 'chat', ee: isEE });
    notifyEmbedResize(520);
  }, []);

  useEffect(() => {
    if (!assistantId || !isEE) return;
    // Same-origin, through the Next.js /api/* proxy — see embedDashboard.ts's
    // fetchEmbedDashboardPayload for why this isn't getBackendUrl()'s raw
    // NEXT_PUBLIC_API_URL (a Docker-internal hostname unreachable from an
    // actual visitor's browser).
    //
    // Try the public, embed-token-gated config endpoint first — this is the
    // one an actual anonymous visitor's browser can reach (no session
    // cookie). It only succeeds when the assistant is configured for
    // embed_jwt/anonymous auth (server/ee/modules/embed/chat_auth.py); for
    // the default "session" auth_mode it 403s, so we fall back to the
    // admin-session-gated lookup below, which is what the same-origin
    // logged-in Settings > Embed preview relies on.
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`/api/ai/embed/${assistantId}/config`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setAssistantConfig((prev) => ({ ...prev, ...data }));
          return;
        }
        return fetch(`/api/embed/assistants/${assistantId}`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((fallbackData) => {
            if (fallbackData) setAssistantConfig((prev) => ({ ...prev, ...fallbackData }));
          });
      })
      .catch(() => {});
  }, [assistantId, token]);

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

      const libraryIds = assistantConfig?.library_ids?.length
        ? assistantConfig.library_ids
        : libraryIdsParam
          ? libraryIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
          : [];

      const analysisMode = resolveAnalysisMode(assistantConfig);
      const controller = new AbortController();
      abortRef.current = controller;

      // Anonymous/embed_jwt assistants (server/ee/modules/embed/chat_auth.py)
      // go through the embed-scoped endpoint, which enforces per-visitor
      // conversation isolation and its own rate limit; assistants left at
      // the default "session" auth_mode 403 there by design and fall back
      // to the legacy session-cookie endpoint below (see useLegacyEndpointRef).
      const endpointFor = (useEmbed: boolean) =>
        useEmbed ? `/api/ai/embed/${assistantId}/analyze` : '/api/ai/analyze';

      const buildHeaders = (useEmbed: boolean): Record<string, string> => {
        const h: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        };
        if (token) {
          h.Authorization = `Bearer ${token}`;
          h['X-Embed-Token'] = token;
        }
        if (useEmbed) {
          h['X-Embed-Visitor-Id'] = visitorIdRef.current;
        }
        return h;
      };

      const buildBody = () =>
        JSON.stringify({
          query: text,
          analysis_mode: analysisMode,
          data_source_id: assistantConfig?.primary_data_source_id || undefined,
          kb_library_ids: libraryIds.length ? libraryIds : undefined,
          // Reused across sends in this page session once a conversation has
          // been minted (either by the embed endpoint server-side, or by
          // ensureLegacyConversationId below for the legacy path); omitted
          // only on a genuinely first send, in which case each path mints
          // its own before this body is actually sent (see call sites).
          conversation_id: conversationIdRef.current || undefined,
          stream: true,
        });

      // The legacy /api/ai/analyze endpoint (unlike the embed-scoped one)
      // does NOT create a conversation on the caller's behalf — it hard-
      // requires conversation_id up front (same "conversation_id is
      // required" error this whole fix started from). The main in-app chat
      // covers this by lazily creating one before its first send
      // (ChatPanelMain.tsx); this mirrors that same pattern for the legacy
      // fallback path here (same-origin preview by an already-logged-in
      // admin, credentials: 'include' carries their session cookie).
      const ensureLegacyConversationId = async (): Promise<void> => {
        if (conversationIdRef.current) return;
        try {
          const res = await fetch('/api/conversations', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: `${assistantConfig?.name || 'Embed'} chat`,
              project_id: assistantConfig?.project_id || undefined,
              json_metadata: '{}',
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data && typeof data.id === 'string' && data.id) {
              conversationIdRef.current = data.id;
            }
          }
        } catch {
          // Best-effort: on failure, conversationIdRef stays empty and the
          // legacy /api/ai/analyze call below surfaces its own "conversation_id
          // is required" error, same as before this fix — never a crash here.
        }
      };

      try {
        let useEmbed = Boolean(token && assistantId && !useLegacyEndpointRef.current);
        if (!useEmbed) {
          await ensureLegacyConversationId();
        }
        let res = await fetch(endpointFor(useEmbed), {
          method: 'POST',
          headers: buildHeaders(useEmbed),
          credentials: 'include',
          signal: controller.signal,
          body: buildBody(),
        });

        if (!res.ok && useEmbed && res.status === 403 && !useLegacyEndpointRef.current) {
          useLegacyEndpointRef.current = true;
          useEmbed = false;
          await ensureLegacyConversationId();
          res = await fetch(endpointFor(useEmbed), {
            method: 'POST',
            headers: buildHeaders(useEmbed),
            credentials: 'include',
            signal: controller.signal,
            body: buildBody(),
          });
        }

        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(parseEmbedErrorDetail(detail, `Request failed (${res.status})`));
        }

        if (useEmbed) {
          const mintedConversationId = res.headers.get('X-Embed-Conversation-Id');
          if (mintedConversationId) conversationIdRef.current = mintedConversationId;
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
          if (useEmbed && typeof data.conversation_id === 'string' && data.conversation_id) {
            conversationIdRef.current = data.conversation_id;
          }
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
    [prompt, loading, assistantConfig, token, assistantId, libraryIdsParam, openDashboard],
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
      <div style={themeStyle} data-theme={dataTheme}>
        <Alert
          type="info"
          showIcon
          message={tEmbed('ee_required_title')}
          description={tEmbed('ee_required_desc')}
          style={{ margin: 24 }}
        />
      </div>
    );
  }

  const assistantName = assistantConfig?.name || 'Aicser AI';
  const resolvedAnalysisMode = resolveAnalysisMode(assistantConfig);
  const assistantAvatarColor = assistantConfig?.color || 'var(--ant-color-primary, #1677ff)';
  const renderAssistantAvatar = (size: number) =>
    assistantConfig?.icon_emoji ? (
      <Avatar
        size={size}
        style={{ background: assistantAvatarColor, flexShrink: 0, fontSize: Math.round(size * 0.55) }}
      >
        {assistantConfig.icon_emoji}
      </Avatar>
    ) : (
      <Avatar
        size={size}
        icon={<RobotOutlined />}
        style={{ background: assistantAvatarColor, flexShrink: 0 }}
      />
    );
  const starters = (assistantConfig?.conversation_starters || []).slice(0, 6);

  return (
    <div
      style={{
        ...themeStyle,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 420,
        maxHeight: 720,
        background: 'var(--ant-color-bg-layout, #f5f5f5)',
      }}
      data-theme={dataTheme}
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
        {renderAssistantAvatar(30)}
        <Text strong style={{ fontSize: 14 }}>
          {assistantName}
        </Text>
        {loading && <AppLoadingIndicator variant="minimal" className="ml-auto" />}
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
            <div style={{ marginBottom: 12 }}>{renderAssistantAvatar(48)}</div>
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              {assistantConfig?.welcome_message || tEmbed('welcome', { name: assistantName })}
            </Paragraph>
            {starters.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  justifyContent: 'center',
                  marginTop: 12,
                  padding: '0 8px',
                }}
              >
                {starters.map((starter, idx) => (
                  <Button
                    key={`${idx}_${starter}`}
                    size="small"
                    onClick={() => void handleSend(starter)}
                    style={{ fontSize: 12, borderRadius: 16, height: 'auto', padding: '4px 12px' }}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => {
          const chartDisplay =
            msg.role === 'assistant' && msg.chartConfig
              ? resolveChatChartDisplay(msg.chartConfig, msg.queryResult, msg)
              : { mode: 'none' as const };
          const hasHybridData = !!(msg.chartConfig || (msg.queryResult && msg.queryResult.length > 0));
          const showDashboardPlan = Boolean(
            msg.role === 'assistant' &&
              (msg.dashboardKpiPlan ||
                msg.dashboardWidgetsReady?.length ||
                msg.dashboardCreated?.dashboard_id),
          );

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
              {msg.role === 'user' ? (
                <Avatar
                  size={28}
                  icon={<UserOutlined />}
                  style={{ background: '#87d068', flexShrink: 0 }}
                />
              ) : (
                renderAssistantAvatar(28)
              )}
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
                          // Same fix as the main in-app chat's ChatMessageList: a
                          // "partial"/degraded backend outcome can finish without
                          // ever sending a stage/message this component's isComplete
                          // heuristic recognizes, leaving this card stuck showing a
                          // stale stage forever right above the real content once it
                          // arrives. Real content already present means the run is
                          // over from the visitor's point of view regardless of what
                          // the raw stage string says.
                          hasFinalContent={!!(
                            msg.chartConfig ||
                            (Array.isArray(msg.queryResult) && msg.queryResult.length > 0) ||
                            (msg.content && msg.content.trim().length > 0)
                          )}
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
          padding: '10px 16px 8px',
          borderTop: '1px solid var(--ant-color-border, #e8e8e8)',
          background: 'var(--ant-color-bg-container, #fff)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
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
        {/* Inline under composer — never fixed over the Send button */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', minHeight: 18 }}>
          <EmbedBrandingFooter
            variant="inline"
            hidden={assistantConfig?.hide_aicser_branding ?? theme?.hide_aicser_branding}
          />
        </div>
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
    <Suspense fallback={<AppLoadingIndicator variant="full" />}>
      <EmbedChatContent />
    </Suspense>
  );
}
