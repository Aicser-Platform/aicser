import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

/**
 * Shown inside the dashboard shell (nav/header stay mounted) while a new
 * route segment streams in — sidebar/header don't flash blank between pages.
 */
export default function DashboardLoading() {
  return <AppLoadingIndicator variant="inline" />;
}
