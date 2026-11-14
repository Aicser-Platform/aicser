/** The AI agent this chat talks to, from the address, so a link to /chat?agent=… is all it takes. */
export function activeChatAgent(): { agent_id?: string; agent_draft?: boolean } {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const id = params.get('agent');
  if (!id) return {};
  return { agent_id: id, ...(params.get('draft') === '1' ? { agent_draft: true } : {}) };
}
