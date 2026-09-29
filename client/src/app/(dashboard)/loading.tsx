import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

/**
 * Shown inside the dashboard shell (nav/header stay mounted) while a new
 * route segment streams in — sidebar/header don't flash blank between pages.
 */
export default function DashboardLoading() {
  // After 8 s: "taking longer than usual" with Reload / Go back, for every page (QA F-DATA-04).
  return <AppLoadingIndicator variant="inline" slowAfterMs={8000} />;
}
