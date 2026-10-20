'use client';

import { NotebookGovernanceDrawer, emptySettings } from '../../notebooks/components/NotebookGovernanceDrawer';
import type { WorkbookSettings } from '@/services/workbookService';

export { emptySettings };

export function WorkbookGovernanceDrawer(props: {
  open: boolean;
  workbookId: string;
  canEdit: boolean;
  settings: WorkbookSettings;
  onClose: () => void;
  onSettingsChange: (s: WorkbookSettings) => void;
}) {
  return (
    <NotebookGovernanceDrawer
      kind="workbook"
      workbookId={props.workbookId}
      open={props.open}
      canEdit={props.canEdit}
      settings={props.settings}
      onClose={props.onClose}
      onSettingsChange={props.onSettingsChange as (s: WorkbookSettings) => void}
    />
  );
}
