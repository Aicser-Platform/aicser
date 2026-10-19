import type { SurfaceContext } from '@/agent/surfaceContext';
import { analysisModeForSurface } from '@/agent/surfaceContext';

export type AnalyzeRequestLifecycle = {
  target_dashboard_id?: string;
  target_widget_id?: string;
  dashboard_lifecycle_action?: string;
  user_preferences?: Record<string, unknown>;
};

export function buildAnalyzeRequestBody(opts: {
  query: string;
  dataSourceId?: string;
  conversationId?: string;
  organizationId?: string;
  projectId?: string;
  surfaceContext?: SurfaceContext;
  lifecycle?: AnalyzeRequestLifecycle;
  stream?: boolean;
  analysisMode?: string;
  analyticsType?: string;
}): Record<string, unknown> {
  const modeOverride = opts.surfaceContext
    ? analysisModeForSurface(opts.surfaceContext, opts.query)
    : undefined;
  const analysis_mode =
    modeOverride ??
    opts.analysisMode ??
    (opts.surfaceContext?.surface === 'dashboard' ? 'dashboard' : 'standard');

  return {
    query: opts.query,
    conversation_id: opts.conversationId,
    data_source_id: opts.dataSourceId,
    organization_id: opts.organizationId,
    project_id: opts.projectId,
    analysis_mode,
    analytics_type: opts.analyticsType ?? 'descriptive',
    stream: opts.stream ?? false,
    ...(opts.surfaceContext ? { surface_context: opts.surfaceContext } : {}),
    ...(opts.lifecycle?.target_dashboard_id
      ? { target_dashboard_id: opts.lifecycle.target_dashboard_id }
      : {}),
    ...(opts.lifecycle?.target_widget_id ? { target_widget_id: opts.lifecycle.target_widget_id } : {}),
    ...(opts.lifecycle?.dashboard_lifecycle_action
      ? { dashboard_lifecycle_action: opts.lifecycle.dashboard_lifecycle_action }
      : {}),
    ...(opts.lifecycle?.user_preferences ? { user_preferences: opts.lifecycle.user_preferences } : {}),
  };
}

/** Full Ask chat request — core ACC + lifecycle merged with chat-only fields. */
export function buildChatAnalyzeRequestBody(opts: {
  query: string;
  dataSourceId?: string;
  conversationId?: string;
  organizationId?: string;
  projectId?: string;
  surfaceContext?: SurfaceContext;
  analysisMode: string;
  analyticsType?: string;
  aiModel?: string;
  stream: boolean;
  selectedDataSourceIds?: string[];
  userPreferences?: Record<string, unknown>;
  dashboardLifecycleFields?: Record<string, unknown>;
  kbLibraryIds?: string[];
  kbDataSourceIds?: string[];
  actionsApproved?: boolean;
  attachments?: unknown[];
}): Record<string, unknown> {
  const base = buildAnalyzeRequestBody({
    query: opts.query,
    dataSourceId: opts.dataSourceId,
    conversationId: opts.conversationId,
    organizationId: opts.organizationId,
    projectId: opts.projectId,
    surfaceContext: opts.surfaceContext,
    stream: opts.stream,
    analysisMode: opts.analysisMode,
    analyticsType: opts.analyticsType,
  });

  return {
    ...base,
    ...(opts.selectedDataSourceIds?.length
      ? { selected_data_source_ids: opts.selectedDataSourceIds }
      : {}),
    business_context: 'data_analysis',
    ...(opts.aiModel ? { ai_model: opts.aiModel } : {}),
    user_context: { stream: opts.stream },
    ...(opts.userPreferences ? { user_preferences: opts.userPreferences } : {}),
    ...(opts.dashboardLifecycleFields ?? {}),
    ...(opts.kbLibraryIds?.length
      ? {
          kb_library_ids: opts.kbLibraryIds,
          kb_data_source_ids: opts.kbDataSourceIds ?? [],
        }
      : {}),
    ...(opts.actionsApproved ? { actions_approved: true } : {}),
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
  };
}
