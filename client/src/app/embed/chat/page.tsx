'use client';

import React, { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Bot, MessageSquare, Plus } from 'lucide-react';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import { EmbedChatComposer } from '@/components/embed/chat/EmbedChatComposer';
import { EmbedChatAssistantMessage, EmbedChatUserMessage } from '@/components/embed/chat/EmbedChatMessage';
import { EmbedChatResultCard } from '@/components/embed/chat/EmbedChatResultCard';
import { useTranslations } from 'next-intl';
import { notifyEmbedError, notifyEmbedReady, notifyEmbedResize, parseEmbedErrorDetail } from '@/utils/embedMessaging';
import { getOrCreateEmbedVisitorId } from '@/utils/embedVisitorId';
import { useEmbedTheme } from '@/hooks/useEmbedTheme';
import { useEmbedSession, type EmbedSessionState } from '@/hooks/useEmbedSession';
import { EmbedSessionGate } from '@/components/embed/EmbedSessionGate';
import { resolveEmbedToken } from '@/utils/embedSession';
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
  sqlQuery?: string;
  insights?: string[];
  toolSteps?: string[];
}

/** Insights and recommendations arrive as strings or as { title, what | description } objects. */
function textOf(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const o = item as Record<string, unknown>;
  const body = String(o.what || o.description || o.text || o.insight || '');
  const title = typeof o.title === 'string' ? o.title : '';
  return title && body && !body.startsWith(title) ? `${title}: ${body}` : title || body;
}

function insightsOf(source: Record<string, unknown>): string[] {
  const list = [
    ...(Array.isArray(source.insights) ? source.insights : []),
    ...(Array.isArray(source.recommendations) ? source.recommendations : []),
  ];
  return list.map(textOf).filter(Boolean).slice(0, 6);
}

/** Labels for the "Used N tools" list (execution_metadata.reasoning_steps). */
function toolStepsOf(steps: unknown[] | undefined): string[] {
  return (steps || [])
    .map((s) => {
      if (typeof s === 'string') return s;
      const o = (s || {}) as Record<string, unknown>;
      return String(o.title || o.name || o.tool || o.step || o.description || o.action || '');
    })
    .filter(Boolean);
}

function sqlOf(source: Record<string, unknown>): string | undefined {
  const sql = source.sql_query ?? source.sqlQuery;
  return typeof sql === 'string' && sql.trim() ? sql : undefined;
}

/** The chart's own title (ECharts `title.text`), if it has one. */
function chartTitleOf(config: unknown): string {
  const title = (config as { title?: unknown } | null)?.title;
  const first = Array.isArray(title) ? title[0] : title;
  const text = (first as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text : '';
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
    sqlQuery: sqlOf(pr as Record<string, unknown>),
    insights: insightsOf(pr as Record<string, unknown>),
    toolSteps: toolStepsOf(view.reasoningSteps),
  };
}

const isEE = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

function EmbedChatContent() {
  const session = useEmbedSession('chat');
  return (
    <EmbedSessionGate session={session}>
      <EmbedChatView session={session} />
    </EmbedSessionGate>
  );
}

function EmbedChatView({ session }: { session: EmbedSessionState }) {
  const tEmbed = useTranslations('embed_chat');
  const tChatPage = useTranslations('chat_page');
  const tMode = useTranslations('embed_chat.modes');
  const searchParams = useSearchParams();
  const token = session.token;
  const assistantId = searchParams?.get('assistant_id') || '';
  const libraryIdsParam = searchParams?.get('library_ids') || '';
  const { theme, themeStyle, dataTheme } = useEmbedTheme(session.theme);

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
    if (token) {
      headers.Authorization = `Bearer ${resolveEmbedToken(token)}`;
      // Required by the embed-chat auth (chat_auth.py), same as on /analyze; without it the
      // config 400s and the page falls back to the session lookup, which visitors can't use.
      headers['X-Embed-Visitor-Id'] = visitorIdRef.current || getOrCreateEmbedVisitorId();
    }
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
          const current = resolveEmbedToken(token);
          h.Authorization = `Bearer ${current}`;
          h['X-Embed-Token'] = current;
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
                    sqlQuery: sqlOf(data),
                    insights: insightsOf(data),
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

  /** A fresh conversation: the next question starts a new one on the server. */
  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    conversationIdRef.current = null;
    setMessages([]);
    setError(null);
    setLoading(false);
  }, []);

  if (!isEE) {
    return (
      <div style={themeStyle} data-theme={dataTheme} className="flex h-dvh items-center justify-center bg-bg p-6">
        <div className="max-w-md rounded-xl border border-border bg-bg-container p-5 text-center">
          <p className="mb-1 mt-0 text-sm font-semibold text-text">{tEmbed('ee_required_title')}</p>
          <p className="m-0 text-sm text-text-secondary">{tEmbed('ee_required_desc')}</p>
        </div>
      </div>
    );
  }

  const assistantName = assistantConfig?.name || 'Aicser AI';
  const resolvedAnalysisMode = resolveAnalysisMode(assistantConfig);
  const modeLabel = tMode.has(resolvedAnalysisMode) ? tMode(resolvedAnalysisMode) : resolvedAnalysisMode;
  const accent = assistantConfig?.color || 'var(--ant-color-primary, #00c2cb)';
  const renderAssistantAvatar = (size: 'sm' | 'lg') => (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-white ${
        size === 'lg' ? 'h-12 w-12 text-2xl' : 'h-8 w-8 text-base'
      }`}
      style={{ background: accent }}
      aria-hidden
    >
      {assistantConfig?.icon_emoji || <Bot className={size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'} />}
    </span>
  );
  const starters = (assistantConfig?.conversation_starters || []).slice(0, 6);
  const lastUserQuestion = [...messages].reverse().find((m) => m.role === 'user')?.content;
  const hideBranding = assistantConfig?.hide_aicser_branding ?? theme?.hide_aicser_branding;

  return (
    <div style={themeStyle} data-theme={dataTheme} className="flex h-dvh min-h-[420px] flex-col bg-bg text-text">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-bg-container px-4 py-3">
        <MessageSquare className="h-5 w-5 text-text-secondary" aria-hidden />
        <div className="min-w-0 flex-1 truncate text-base font-semibold text-text">{assistantName}</div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleNewChat}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-transparent px-2.5 py-1 text-sm text-text hover:bg-[var(--ant-color-fill-tertiary,rgba(0,0,0,0.04))]"
          >
            <Plus className="h-4 w-4" />
            {tEmbed('new_chat')}
          </button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 && !loading && (
            <div className="mt-8 flex flex-col items-center text-center">
              {renderAssistantAvatar('lg')}
              <p className="mb-0 mt-3 max-w-md text-sm text-text-secondary">
                {assistantConfig?.welcome_message || tEmbed('welcome', { name: assistantName })}
              </p>
              {starters.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {starters.map((starter, idx) => (
                    <button
                      key={`${idx}_${starter}`}
                      type="button"
                      onClick={() => void handleSend(starter)}
                      className="rounded-full border border-border bg-bg-container px-3.5 py-1.5 text-sm text-text hover:border-[var(--ant-color-primary,#00c2cb)]"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, idx) => {
            if (msg.role === 'user') return <EmbedChatUserMessage key={msg.id} content={msg.content} />;

            const chartDisplay = msg.chartConfig
              ? resolveChatChartDisplay(msg.chartConfig, msg.queryResult, msg)
              : { mode: 'none' as const };
            const chart =
              chartDisplay.mode === 'shared' ? (
                // Sized like the in-app chat's chart host: the widget fills its parent's height.
                <div className="relative h-[320px] w-full">
                  <SharedChartRenderer
                    chartType={chartDisplay.props.chartType}
                    chartData={chartDisplay.props.chartData}
                    chartOptions={chartDisplay.props.chartOptions}
                    chartQuery={chartDisplay.props.chartQuery}
                  />
                </div>
              ) : chartDisplay.mode === 'echarts' ? (
                <EmbedEChartsFallback config={withChartAnimationDefaults(chartDisplay.config)} minHeight={260} />
              ) : undefined;
            const hasResult = Boolean(chart || msg.sqlQuery || msg.queryResult?.length);
            const hasHybridData = !!(msg.chartConfig || (msg.queryResult && msg.queryResult.length > 0));
            const showDashboardPlan = Boolean(
              msg.dashboardKpiPlan || msg.dashboardWidgetsReady?.length || msg.dashboardCreated?.dashboard_id,
            );
            const isLast = idx === messages.length - 1;

            return (
              <EmbedChatAssistantMessage
                key={msg.id}
                avatar={renderAssistantAvatar('sm')}
                content={msg.content}
                streaming={msg.streaming}
                error={msg.error}
                progressMessage={msg.progress?.message}
                toolSteps={msg.toolSteps || []}
                insights={msg.streaming ? [] : msg.insights || []}
                followUps={(msg.followUpQuestions || []).slice(0, 4)}
                onFollowUp={(q) => void handleSend(q)}
                onRetry={
                  msg.error && isLast && lastUserQuestion ? () => void handleSend(lastUserQuestion) : undefined
                }
                before={
                  showDashboardPlan ? (
                    <div className="mb-3">
                      <DashboardPlanCard
                        tier={String(msg.dashboardKpiPlan?.tier || 'operational')}
                        targetWidgets={Number(
                          msg.dashboardKpiPlan?.section_count ||
                            (msg.dashboardKpiPlan?.sections as unknown[] | undefined)?.length ||
                            8,
                        )}
                        sections={
                          (msg.dashboardKpiPlan?.sections || []) as Array<{ title?: string; chart_type?: string }>
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
                  ) : undefined
                }
                result={
                  hasResult ? (
                    <EmbedChatResultCard
                      title={chartTitleOf(chartDisplay.mode === 'echarts' ? chartDisplay.config : msg.chartConfig) || tEmbed('result_title')}
                      chart={chart}
                      sql={msg.sqlQuery}
                      rows={msg.queryResult}
                    />
                  ) : undefined
                }
                after={
                  msg.citations && msg.citations.length > 0 ? (
                    <div className="mt-3">
                      <CitationSourcesStrip
                        citations={msg.citations}
                        isHybrid={hasHybridData}
                        openInNewTab
                        t={(key, values) => tChatPage(key, values as Record<string, string | number>)}
                      />
                    </div>
                  ) : undefined
                }
              />
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="shrink-0 px-4 pb-3 pt-2">
        <div className="mx-auto max-w-3xl">
          {error && (
            <div
              role="alert"
              className="mb-2 flex items-start gap-2 rounded-lg border border-[var(--ant-color-error-border,#ffccc7)] bg-[var(--ant-color-error-bg,#fff2f0)] px-3 py-2 text-sm text-[var(--ant-color-error,#ff4d4f)]"
            >
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label={tEmbed('dismiss')}
                className="border-0 bg-transparent p-0 text-current opacity-70 hover:opacity-100"
              >
                ×
              </button>
            </div>
          )}
          <EmbedChatComposer
            value={prompt}
            onChange={setPrompt}
            onSend={() => void handleSend()}
            onStop={handleStop}
            loading={loading}
            modeLabel={modeLabel}
          />
          <div className="mt-2 flex items-center justify-center gap-3 text-xs text-text-tertiary">
            <span>{tEmbed('disclaimer')}</span>
            <EmbedBrandingFooter variant="inline" hidden={hideBranding} />
          </div>
        </div>
      </footer>
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
