import { redirect } from 'next/navigation';
import ReportPageClient from '@/app/(dashboard)/report/[conversationId]/[messageId]/ReportPageClient';
import { isEnterpriseEdition } from '@/utils/appPaths';

/** The report without the app shell, for the chat's report panel (see report-view/layout.tsx). */
export default function ReportViewPage() {
  if (!isEnterpriseEdition()) redirect('/dashboards');
  return <ReportPageClient />;
}
