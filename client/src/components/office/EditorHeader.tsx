'use client';

import { ArrowLeft, Cloud, CloudAlert, Copy, Loader2, MoreHorizontal, RefreshCw, Share2, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/aicser-ui/badge';
import { Button } from '@/components/aicser-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { Input } from '@/components/aicser-ui/input';
import { SAVE_LABELS, type OfficeSaveState } from '@/hooks/useOfficeFile';
import { FILE_TYPES, type FileType } from '@/lib/office/fileTypes';
import { cn } from '@/lib/ui/utils';
import { ShareDialog } from './ShareDialog';

/**
 * The top bar of the Docs and Slides editors: back to the list, the title (renamed in place), the save status, Share
 * (owner: people and a view link, approved by an organization owner or admin), the editor's own actions
 * (`children`) and a More menu (copy, delete, plus `menu` items).
 */
export function EditorHeader({
  fileId,
  role,
  fileType,
  noun,
  listLabel,
  title,
  saveState,
  onBack,
  onRename,
  onReload,
  onCopy,
  onDelete,
  menu,
  children,
}: Readonly<{
  fileId: string;
  /** owner | edit | view (shared with this person). */
  role: 'owner' | 'edit' | 'view';
  fileType: FileType;
  /** "document" / "presentation". */
  noun: string;
  /** "Docs" / "Slides". */
  listLabel: string;
  title: string;
  saveState: OfficeSaveState;
  onBack: () => void;
  onRename: (title: string) => void;
  onReload: () => void;
  onCopy: () => void;
  onDelete: () => void;
  menu?: ReactNode;
  children?: ReactNode;
}>) {
  const { icon: Icon, text } = FILE_TYPES[fileType];
  const [sharing, setSharing] = useState(false);
  const readOnly = saveState === 'readonly' || role === 'view';
  const owner = role === 'owner';
  const failed = saveState === 'error' || saveState === 'conflict';
  const StatusIcon = saveState === 'saving' ? Loader2 : failed ? CloudAlert : Cloud;
  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
      <Button variant="ghost" size="icon-sm" aria-label={`Back to ${listLabel}`} onClick={onBack}>
        <ArrowLeft />
      </Button>
      <Icon className={cn('size-5', text)} aria-hidden="true" />
      <Input
        aria-label={`${noun[0]?.toUpperCase()}${noun.slice(1)} title`}
        value={title}
        readOnly={readOnly}
        className="h-9 max-w-md border-transparent bg-transparent px-1 text-lg font-semibold shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
        onChange={(e) => onRename(e.target.value)}
      />
      <span
        className={cn('flex items-center gap-1 text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}
        role="status"
      >
        <StatusIcon className={cn('size-3.5', saveState === 'saving' && 'animate-spin')} aria-hidden="true" />
        {SAVE_LABELS[saveState]}
      </span>
      {!owner && (
        <Badge variant="outline" title="Shared with you">
          {role === 'edit' ? 'Shared with you · can edit' : 'Shared with you · view only'}
        </Badge>
      )}
      {saveState === 'conflict' && (
        <Button size="sm" variant="outline" onClick={onReload}>
          <RefreshCw /> Reload
        </Button>
      )}
      {readOnly && (
        <Button size="sm" variant="outline" onClick={onCopy}>
          <Copy /> Make a copy to edit
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {children}
        {owner && (
          <Button size="sm" variant="outline" onClick={() => setSharing(true)}>
            <Share2 /> Share
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`More ${noun} actions`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu}
            <DropdownMenuItem onSelect={onCopy}>
              <Copy /> Make a copy
            </DropdownMenuItem>
            {owner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 /> Delete {noun}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {owner && <ShareDialog fileId={fileId} title={title} noun={noun} open={sharing} onOpenChange={setSharing} />}
    </header>
  );
}
