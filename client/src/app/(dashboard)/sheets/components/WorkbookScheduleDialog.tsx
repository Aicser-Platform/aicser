'use client';

import { ScheduleDialog, workbookRuns } from '../../notebooks/components/ScheduleDialog';

export function WorkbookScheduleDialog(props: {
  open: boolean;
  workbookId: string;
  canEdit: boolean;
  onClose: () => void;
  onAfterRun?: () => void;
  defaultRunParameters?: Record<string, unknown>;
}) {
  return (
    <ScheduleDialog
      open={props.open}
      documentId={props.workbookId}
      canEdit={props.canEdit}
      onClose={props.onClose}
      runsApi={workbookRuns}
      translationNamespace="sheets"
      explainKey="schedule_explain_workbook"
      defaultRunParameters={props.defaultRunParameters}
      onShowRun={() => props.onAfterRun?.()}
    />
  );
}
