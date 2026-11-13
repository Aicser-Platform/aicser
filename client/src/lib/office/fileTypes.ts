import { FileText, Presentation, Sheet, type LucideIcon } from 'lucide-react';

// One colour per file type, used on list cards and page headers: Docs blue, Sheets green, Slides orange
// (tokens `--ui-file-*` in styles/aicser-ui.css, light + dark).

export type FileType = 'doc' | 'sheet' | 'slides';

export const FILE_TYPES: Record<FileType, { icon: LucideIcon; label: string; text: string; tile: string }> = {
  doc: { icon: FileText, label: 'Document', text: 'text-file-doc', tile: 'bg-file-doc/10 text-file-doc' },
  sheet: { icon: Sheet, label: 'Spreadsheet', text: 'text-file-sheet', tile: 'bg-file-sheet/10 text-file-sheet' },
  slides: {
    icon: Presentation,
    label: 'Presentation',
    text: 'text-file-slides',
    tile: 'bg-file-slides/10 text-file-slides',
  },
};
