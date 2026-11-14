/**
 * Pages whose code loads only when they open. Fetching it when the pointer reaches the link means the
 * click finds it ready. Each import runs once: the browser and webpack keep the result.
 */
const LOADERS: Record<string, () => Promise<unknown>> = {
  '/chat': () => import('../../ee/chat-page'),
  '/agent': () => import('@/ee-lazy/AgentPage'),
  '/agents': () => import('@/ee-lazy/AiAgentsPage'),
  '/alerts': () => import('@/ee-lazy/AlertsPage'),
  '/catalog': () => import('@/ee-lazy/CatalogPage'),
  '/pipelines': () => import('@/ee-lazy/PipelinesPage'),
  '/models': () => import('@/ee-lazy/ModelsPage'),
  '/ai-decisions': () => import('@/ee-lazy/AIDecisionsPage'),
  '/master-data': () => import('@/ee-lazy/MasterDataPage'),
};

export function preloadRoute(href: string): void {
  LOADERS[href.split('?')[0]]?.().catch(() => undefined); // the click will load it, and report any failure
}
