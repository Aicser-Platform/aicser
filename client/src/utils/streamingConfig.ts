/**
 * Streaming Configuration Utility
 * Manages AI streaming response feature flag
 */

const STREAMING_CONFIG_KEY = 'aiser_ai_streaming_enabled';

/**
 * Get streaming enabled status
 * @returns true if streaming is enabled, false otherwise
 */
export function isStreamingEnabled(): boolean {
  if (typeof window === 'undefined') {
    return true; // Default to enabled on server
  }
  
  try {
    const stored = localStorage.getItem(STREAMING_CONFIG_KEY);
    if (stored !== null) {
      return stored === 'true';
    }
    // Default to enabled
    return true;
  } catch (e) {
    console.warn('Failed to read streaming config:', e);
    return true; // Default to enabled on error
  }
}

/**
 * Set streaming enabled status
 * @param enabled - true to enable streaming, false to disable
 */
export function setStreamingEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  
  try {
    localStorage.setItem(STREAMING_CONFIG_KEY, enabled.toString());
    console.log(`✅ Streaming ${enabled ? 'enabled' : 'disabled'}`);
  } catch (e) {
    console.warn('Failed to save streaming config:', e);
  }
}

/**
 * Toggle streaming enabled status
 * @returns new enabled status
 */
export function toggleStreaming(): boolean {
  const current = isStreamingEnabled();
  const newValue = !current;
  setStreamingEnabled(newValue);
  return newValue;
}

