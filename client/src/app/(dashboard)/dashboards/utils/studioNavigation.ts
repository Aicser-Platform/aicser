export function buildStudioPath(dashboardId?: string | null, pageId?: string | null): string {
  if (!dashboardId) return '/dashboards';
  const params = new URLSearchParams({ id: String(dashboardId) });
  if (pageId) params.set('page', String(pageId));
  return `/dashboards?${params.toString()}`;
}

export async function exitDocumentFullscreen(): Promise<void> {
  if (typeof document === 'undefined' || !document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}

/** Full page load — avoids soft-nav layout/state glitches from /shared → /dashboards */
export function navigateToStudio(dashboardId?: string | null, pageId?: string | null): void {
  void exitDocumentFullscreen().finally(() => {
    window.location.assign(buildStudioPath(dashboardId, pageId));
  });
}
