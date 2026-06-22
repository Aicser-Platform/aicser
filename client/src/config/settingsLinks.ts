/** Deep links into Settings tabs (App Router). */

export const SETTINGS_API_KEYS_PROVIDERS_PATH = '/settings?tab=api-keys&subtab=providers';

export function navigateToAiProviderSettings(): void {
  if (typeof window !== 'undefined') {
    window.location.href = SETTINGS_API_KEYS_PROVIDERS_PATH;
  }
}
