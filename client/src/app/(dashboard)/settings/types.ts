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
  api_key: string;
  model?: string;
  endpoint?: string;
}

// Store types
export interface OverviewStats {
  members: number;
  activeMembers: number;
  dataSources: number;
  apiKeys: number;
}
