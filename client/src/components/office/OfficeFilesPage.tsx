'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Search, Trash2, Upload, UserRound } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/aicser-ui/button';
import { Card, CardContent } from '@/components/aicser-ui/card';
import { Input } from '@/components/aicser-ui/input';
import { Skeleton } from '@/components/aicser-ui/skeleton';
import { FILE_TYPES, type FileType } from '@/lib/office/fileTypes';
import type { OfficeFileSummary, OfficeStore } from '@/lib/office/store';
import { useProjectStore } from '@/stores/useProjectStore';
import { ApprovalsPanel } from './ApprovalsPanel';
import { FileTypeIcon } from './FileTypeIcon';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type NewFile<Body> = { title: string; body: Body; meta?: Record<string, unknown> };

export interface OfficeFilesPageProps<Body> {
  store: OfficeStore<Body>;
  /** Singular, lower case ("document"); the list's label is `title`. */
  noun: string;
  title: string;
  description: string;
  /** Icon and colour of the cards and header. */
  fileType: FileType;
  /** Makes a new, empty file. */
  blank: () => NewFile<Body>;
  /** Opens a Word / PowerPoint file: from the picker, or a file dropped on the page (null = cancelled). */
  importFile: {
    label: string;
    /** File extension accepted by drag and drop (e.g. "docx"). */
    extension: string;
    run: (file?: File) => Promise<NewFile<Body> | null>;
  };
  open: (id: string) => void;
  /** e.g. "12 slides" for a card. */
  details?: (item: OfficeFileSummary) => string | null;
  /** `?deleted=<id>`: deleted from inside the editor, so the list offers Undo. */
  deleted?: string | null;
  clearDeleted: () => void;
  /** `?review=1` (from an approval notice): show and scroll to the shares waiting for approval. */
  review?: boolean;
}

/** Docs / Slides list: search, new, open a Word or PowerPoint file, copy, delete (with Undo). Per project. */
export function OfficeFilesPage<Body>(props: Readonly<OfficeFilesPageProps<Body>>) {
  const { store, noun, title, open } = props;
  const { icon: Icon, text: iconColor } = FILE_TYPES[props.fileType];
  const rawProject = useProjectStore((s) => s.currentProjectId);
  const projectId = rawProject === null || rawProject === undefined ? null : String(rawProject);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const needle = useDeferredValue(search.trim().toLowerCase());
  const queryClient = useQueryClient();
  const queryKey = ['office-files', store.kind, projectId];
  const list = useQuery({
    queryKey,
    queryFn: () => store.list(projectId),
    // Editors autosave titles: the list rereads whenever it is shown.
    staleTime: 0,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['office-files', store.kind] });

  const create = useMutation({
    mutationFn: async () => store.create(props.blank(), projectId),
    onSuccess: (item) => open(item.id),
    onError: (error) => toast.error(`Couldn't create the ${noun}: ${message(error)}`),
  });

  const importing = useMutation({
    mutationFn: async (file?: File) => {
      const converted = await props.importFile.run(file);
      if (!converted) return null;
      return store.create(converted, projectId);
    },
    onSuccess: (item) => item && open(item.id),
    onError: (error) => toast.error(`Couldn't open the file: ${message(error)}`),
  });

  const offerUndo = (id: string) =>
    toast(`${noun[0]?.toUpperCase()}${noun.slice(1)} deleted.`, {
      id: `${store.kind}-deleted-${id}`,
      action: {
        label: 'Undo',
        onClick: () =>
          void store.restore(id).then(
            () => void refresh(),
            (e: unknown) => toast.error(message(e))
          ),
      },
    });
  const shownUndoRef = useRef<string | null>(null);
  const { deleted, clearDeleted } = props;
  useEffect(() => {
    if (!deleted || shownUndoRef.current === deleted) return;
    shownUndoRef.current = deleted;
    offerUndo(deleted);
    clearDeleted();
    // offerUndo only reads stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleted, clearDeleted]);

  const items = (list.data ?? []).filter((item) => item.title.toLowerCase().includes(needle));
  const extension = `.${props.importFile.extension}`;

  return (
    <div
      className="h-full overflow-y-auto bg-background text-foreground"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = Array.from(e.dataTransfer.files).find((f) => f.name.toLowerCase().endsWith(extension));
        if (file) importing.mutate(file);
        else if (e.dataTransfer.files.length) toast.error(`Drop a ${extension} file to open it.`);
      }}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Icon className={`mt-1 size-6 ${iconColor}`} aria-hidden="true" />
            <div>
              <h1 className="m-0 text-xl font-semibold text-foreground">{title}</h1>
              <p className="m-0 max-w-xl text-sm text-muted-foreground">{props.description}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => importing.mutate(undefined)} disabled={importing.isPending}>
              <Upload /> {props.importFile.label}
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              <Plus /> New {noun}
            </Button>
          </div>
        </header>

        <div className="relative min-w-64 sm:max-w-sm">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder={`Search ${title.toLowerCase()}`}
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <ApprovalsPanel kind={store.kind} focus={props.review} />

        {dragging && (
          <p
            role="status"
            className="m-0 rounded-lg border-2 border-dashed border-ring p-6 text-center text-sm text-muted-foreground"
          >
            Drop a {extension} file to open it as a new {noun}.
          </p>
        )}

        {list.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : list.error ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            {title} could not be loaded: {message(list.error)}
            <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length ? (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4" aria-label={title}>
            {items.map((item) => {
              const details = props.details?.(item);
              return (
                <li key={item.id}>
                  <Card className="gap-2 py-4">
                    <CardContent className="flex items-start gap-3 px-4">
                      <FileTypeIcon type={props.fileType} />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm font-medium text-primary-active hover:underline"
                            onClick={() => open(item.id)}
                          >
                            {item.title}
                          </button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Make a copy of ${item.title}`}
                            onClick={() =>
                              void store.duplicate(item.id).then(
                                (copy) => open(copy.id),
                                (e: unknown) => toast.error(message(e))
                              )
                            }
                          >
                            <Copy />
                          </Button>
                          {item.isOwner && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-destructive"
                              aria-label={`Delete ${item.title}`}
                              onClick={() =>
                                void store.remove(item.id).then(
                                  () => {
                                    void refresh();
                                    offerUndo(item.id);
                                  },
                                  (e: unknown) => toast.error(message(e))
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                        <p className="m-0 flex items-center gap-1 text-xs text-muted-foreground">
                          {!item.isOwner && (
                            <span className="flex items-center gap-1">
                              <UserRound className="size-3.5" aria-hidden="true" />
                              {item.role === 'edit' ? 'Shared with you · can edit' : 'Shared with you · view only'} ·
                            </span>
                          )}
                          {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ''}
                          {details ? ` · ${details}` : ''}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 max-w-xl text-sm text-muted-foreground">
            {search.trim()
              ? `No ${title.toLowerCase()} match.`
              : `No ${title.toLowerCase()} yet. Create one, ${props.importFile.label.toLowerCase()}, or drop a ${extension} file here.`}
          </p>
        )}
      </div>
    </div>
  );
}
