import type { SurfaceContext, SurfaceKind } from '@/agent/surfaceContext';

const STORAGE_PREFIX = 'aiser_surface_conv:';

export function surfaceConversationStorageKey(surface: SurfaceKind, refId: string): string {
  return `${STORAGE_PREFIX}${surface}:${refId}`;
}

export function readSurfaceConversationId(surface: SurfaceKind, refId: string): string | null {
  try {
    return localStorage.getItem(surfaceConversationStorageKey(surface, refId));
  } catch {
    return null;
  }
}

export function writeSurfaceConversationId(surface: SurfaceKind, refId: string, conversationId: string): void {
  try {
    localStorage.setItem(surfaceConversationStorageKey(surface, refId), conversationId);
  } catch {
    /* ignore */
  }
}

/** Title for a dedicated artifact thread in Ask history. */
export function surfaceConversationTitle(ctx: SurfaceContext): string {
  const label = ctx.surface_ref?.title || ctx.surface_ref?.id || ctx.surface;
  return `${ctx.surface}: ${label}`.slice(0, 120);
}
