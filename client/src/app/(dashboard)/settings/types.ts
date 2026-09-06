/**
 * Type definitions for Settings module
 */

export interface ProfileFormValues {
  first_name: string;
  last_name?: string;
  email: string;
  username?: string;
  phone_number?: string;
  company?: string;
  location?: string;
  timezone?: string;
  bio?: string;
  job_role?: string;
  industry?: string;
  company_size?: string;
  data_experience?: string;
  primary_use_case?: string;
  data_frequency?: string;
}

export interface SecuritySettings {
  two_factor_enabled: boolean;
  session_timeout: number;
  login_notifications: boolean;
  suspicious_activity_alerts: boolean;
  allowed_ip_addresses?: string[];
  password_last_changed?: string;
}

/** API may return more; settings UI only edits these two. */
export interface NotificationSettings {
  email_notifications: boolean;
  push_notifications: boolean;
}

export interface AppearanceSettings {
  theme?: 'light' | 'dark' | 'auto';
  compact_mode: boolean;
  sidebar_collapsed?: boolean;
  language?: string;
  date_format?: string;
  number_format: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  created_at: string;
  last_used?: string;
  expires_at?: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface ProviderApiKey {
  provider: string;
  api_key: string;
  model?: string;
  endpoint?: string;
  workspace_id?: string;
}

export interface ProviderApiKeys {
  openai?: ProviderApiKey;
  anthropic?: ProviderApiKey;
  azure_openai?: ProviderApiKey;
  google?: ProviderApiKey;
  [key: string]: ProviderApiKey | undefined;
}

export interface TeamMember {
  user_id: string;
  invitation_id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
  role_id: string;
  role_name: string;
  role_display_name: string;
  assigned_at: string;
  is_active: boolean;
  status?: 'active' | 'pending';
}

export interface DataSource {
  id: string;
  name: string;
  type: string;
  db_type?: string;
  status: 'connected' | 'failed' | 'pending';
  connected_at?: string;
  last_sync?: string;
  error_message?: string;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  description?: string;
  enabled: boolean;
}

export interface RBACRole {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  scope: string;
}

// Form value types
export interface ProfileFormValues {
  full_name: string;
  email: string;
  phone?: string;
  bio?: string;
  company?: string;
  location?: string;
  timezone?: string;
  language?: string;
}

export interface SecurityFormValues {
  two_factor_enabled: boolean;
  session_timeout: number;
  login_notifications: boolean;
  suspicious_activity_alerts: boolean;
}

export interface NotificationFormValues {
  email_notifications: boolean;
  push_notifications: boolean;
}

export interface AppearanceFormValues {
  compact_mode: boolean;
  number_format: string;
}

export interface ApiKeyFormValues {
  name: string;
  expires_at?: string;
}

export interface ProviderKeyFormValues {
  api_key?: string;
  model?: string;
  endpoint?: string;
  workspace_id?: string;
}

// Store types
export interface OverviewStats {
  members: number;
  activeMembers: number;
  dataSources: number;
  apiKeys: number;
}

// Embed assistants (Settings > Embed > Chat assistants builder)
export type EmbedCapability = 'rag_only' | 'full_engine';
export type EmbedAuthMode = 'session' | 'embed_jwt' | 'anonymous';
export type EmbedAssistantVisibility = 'private' | 'shared' | 'public';

export interface EmbedAssistantRecord {
  id: string;
  name: string;
  organization_id?: string;
  project_id?: string | null;
  capabilities: string;
  library_ids?: string[];
  primary_data_source_id?: string | null;
  /** New multi-select data source list — `primary_data_source_id` stays for backward compat. */
  data_source_ids?: string[];
  allowed_modes?: string[];
  auth_mode?: EmbedAuthMode;
  allowed_domains?: string[];
  settings?: Record<string, unknown>;
  system_prompt?: string | null;
  welcome_message?: string | null;
  fallback_message?: string | null;
  conversation_starters?: string[];
  icon_emoji?: string | null;
  color?: string | null;
  preferred_model?: string | null;
  temperature?: number | null;
  visibility?: EmbedAssistantVisibility;
  is_active?: boolean;
  /** Team+ gated server-side (assistant_router.py) — same flag/gate as the
   * dashboard/chart/report embed token's theme.hide_aicser_branding. */
  hide_aicser_branding?: boolean;
}

/** Payload shape for create/update — same fields as the record, minus server-assigned ones. */
export type EmbedAssistantPayload = Partial<Omit<EmbedAssistantRecord, 'id'>> & {
  name?: string;
  organization_id?: string;
};

/** A single grant of a "shared" assistant to a colleague or a whole project. */
export interface EmbedAssistantShare {
  id: string;
  assistant_id?: string;
  shared_with?: string | null;
  project_id?: string | null;
  expires_at?: string | null;
  created_at?: string;
}
