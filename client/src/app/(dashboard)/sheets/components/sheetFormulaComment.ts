import { dashboardCommentsService } from '@/app/(dashboard)/dashboards/hooks/useDashboardComments';
import {
  DASHBOARD_COMMENT_EVENT,
  type DashboardComment,
} from '@/app/(dashboard)/dashboards/utils/collaborationTypes';

const AI_FORMULA_TAG = '[AI formula]';
const WORKBOOK_COMMENT_ROOT = '/api/workbooks';

/**
 * Save a formula explanation on a cell anchor (e.g. `Sheet1!B4`).
 * These are workbook **comment threads** (toolbar → Comments), not in-grid hover notes —
 * IronCalc does not expose Excel/Sheets cell comments yet. Google Sheets *data sources* are
 * read-only here; notes are not written back to Google.
 */
export async function postFormulaExplanationComment(
  workbookId: string,
  cellAnchor: string,
  body: string,
): Promise<DashboardComment> {
  const text = body.trim();
  if (!text) throw new Error('empty');
  const header = `${AI_FORMULA_TAG} ${cellAnchor}`;
  const prefixed = text.startsWith(AI_FORMULA_TAG)
    ? text
    : `${header}\n${text}`;
  const saved = await dashboardCommentsService.create(
    workbookId,
    prefixed.slice(0, 4000),
    { widgetId: cellAnchor },
    WORKBOOK_COMMENT_ROOT,
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(DASHBOARD_COMMENT_EVENT, {
        detail: { dashboardId: workbookId, event: 'comment:created', comment: saved },
      }),
    );
  }
  return saved;
}
