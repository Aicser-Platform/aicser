/**
 * AI provider logos for Settings > API Keys and ModelSelector.
 * Uses official favicons/brand assets where available.
 */
const LOGOS: Record<string, string> = {
  // OpenAI – official favicon
  openai: 'https://openai.com/favicon.ico',
  // Anthropic – Simple Icons
  anthropic: 'https://cdn.simpleicons.org/anthropic/CC785C',
  // Azure OpenAI – Microsoft Azure AI favicon
  azure_openai: 'https://azure.microsoft.com/favicon.ico',
  azure: 'https://azure.microsoft.com/favicon.ico',
  // Gemini – Lobe Icons (reliable CDN)
  google: 'https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/gemini-color.png',
  gemini: 'https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/gemini-color.png',
  ollama: 'https://cdn.simpleicons.org/ollama/000000',
  groq: 'https://cdn.simpleicons.org/groq/F4A261',
  cohere: 'https://cdn.simpleicons.org/cohere/FF6B35',
  deepseek: 'https://cdn.simpleicons.org/deepseek/4D6BFE',
  openrouter: 'https://cdn.simpleicons.org/openrouter/6467F2',
};

export const AI_PROVIDER_LOGOS = LOGOS;

export function getAiProviderLogo(providerKey: string): string | undefined {
  if (!providerKey) return undefined;
  const key = providerKey.toLowerCase().replace(/\s+/g, '_');
  return LOGOS[key] ?? LOGOS[providerKey];
}
