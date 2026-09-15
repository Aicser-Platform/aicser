import { redirect } from 'next/navigation';

/**
 * Semantic Layer hub — hidden from navigation; the previous SemanticLayerHubPage
 * implementation (data-source listing + "open studio" launcher) is preserved in
 * git history and can be restored by reverting this file. The actual per-source
 * editor at /data/sources/[id]/semantic (SemanticStudio) is unaffected and still
 * reachable via its existing deep links from the Data page, chat, and dashboards.
 */
export default function SemanticLayerHubPage() {
  redirect('/data');
}
