import { FILE_TYPES, type FileType } from '@/lib/office/fileTypes';
import { cn } from '@/lib/ui/utils';

/** A file's type mark on a list card: the type's icon on a tinted tile. */
export function FileTypeIcon({ type, className }: Readonly<{ type: FileType; className?: string }>) {
  const { icon: Icon, label, tile } = FILE_TYPES[type];
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', tile, className)}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
