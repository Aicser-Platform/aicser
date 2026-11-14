'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Copy, Globe, Link2, Search, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/aicser-ui/badge';
import { Button } from '@/components/aicser-ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/aicser-ui/dialog';
import { Input } from '@/components/aicser-ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { Separator } from '@/components/aicser-ui/separator';
import {
  linkUrl,
  sharingApi,
  type FileShares,
  type LinkAccess,
  type Share,
  type ShareRole,
} from '@/lib/office/sharing';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Where a share stands: every share waits for an organization owner or admin before it opens anything. */
export function ShareStatus({ share }: Readonly<{ share: Pick<Share, 'status' | 'note'> }>) {
  if (share.status === 'active')
    return (
      <Badge variant="secondary">
        <Check aria-hidden="true" /> Approved
      </Badge>
    );
  if (share.status === 'pending')
    return (
      <Badge variant="warning">
        <Clock aria-hidden="true" /> Waiting for approval
      </Badge>
    );
  return (
    <Badge variant="destructive" title={share.note ?? undefined}>
      <X aria-hidden="true" /> Declined
    </Badge>
  );
}

/**
 * Share a document or presentation: with people in the organization (view or edit) and with a view link (people
 * in the organization, or anyone). Nothing opens until an organization owner or admin approves it; owners and
 * admins' own shares are approved at once (unless the organization asks for a second approver).
 */
export function ShareDialog({
  fileId,
  title,
  noun,
  open,
  onOpenChange,
}: Readonly<{ fileId: string; title: string; noun: string; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const queryClient = useQueryClient();
  const key = ['office-shares', fileId];
  const shares = useQuery({ queryKey: key, queryFn: () => sharingApi.shares(fileId), enabled: open });
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<ShareRole>('view');
  const [newLinkAccess, setNewLinkAccess] = useState<LinkAccess>('organization');
  const needle = useDeferredValue(search.trim());
  const people = useQuery({
    queryKey: ['office-people', needle],
    queryFn: () => sharingApi.people(needle),
    enabled: open,
    staleTime: 30_000,
  });
  const update = (next: FileShares) => queryClient.setQueryData(key, next);
  const act = useMutation({
    mutationFn: (run: () => Promise<FileShares>) => run(),
    onSuccess: (next) => {
      update(next);
      void queryClient.invalidateQueries({ queryKey: ['office-approvals'] });
    },
    onError: (error) => toast.error(message(error)),
  });

  const shared = shares.data?.people.filter((p) => p.status !== 'off') ?? [];
  const sharedIds = new Set(shared.map((p) => p.person_id));
  const candidates = (people.data?.people ?? []).filter((p) => !sharedIds.has(p.id));
  const link = shares.data?.link && shares.data.link.status !== 'off' ? shares.data.link : null;
  const noOrganization = people.data && !people.data.organization;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{title}”</DialogTitle>
          <DialogDescription className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Every share waits for an owner or admin of your organization to approve it before it opens the {noun}.
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="share-people" className="flex flex-col gap-2">
          <h3 id="share-people" className="m-0 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Users className="size-4" aria-hidden="true" /> People
          </h3>
          {noOrganization ? (
            <p className="m-0 text-sm text-muted-foreground">
              Sharing with people needs an organization (Enterprise). You can still turn on a view link.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    aria-label="Find people in your organization"
                    placeholder="Name or email"
                    className="pl-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <NativeSelect
                  aria-label="Access for new people"
                  value={role}
                  onChange={(e) => setRole(e.target.value as ShareRole)}
                >
                  <NativeSelectOption value="view">Can view</NativeSelectOption>
                  <NativeSelectOption value="edit">Can edit</NativeSelectOption>
                </NativeSelect>
              </div>
              {needle && (
                <ul
                  className="m-0 flex max-h-40 list-none flex-col overflow-y-auto rounded-lg border p-1"
                  aria-label="People found"
                >
                  {candidates.length ? (
                    candidates.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                          disabled={act.isPending}
                          onClick={() => {
                            act.mutate(() => sharingApi.sharePerson(fileId, p.id, role));
                            setSearch('');
                          }}
                        >
                          <UserPlus className="size-4 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">
                            {p.name ?? p.email}
                            {p.name && p.email && p.name !== p.email && (
                              <span className="ml-1 text-muted-foreground">{p.email}</span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {role === 'edit' ? 'Can edit' : 'Can view'}
                          </span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-2 py-1.5 text-sm text-muted-foreground">
                      {people.isLoading ? 'Searching…' : 'No one else in your organization matches.'}
                    </li>
                  )}
                </ul>
              )}
              {shared.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Shared with">
                  {shared.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-1">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm text-foreground">
                          {s.person_name ?? s.person_email ?? 'Someone'}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <ShareStatus share={s} />
                          {s.status === 'declined' && s.note && (
                            <span className="truncate text-xs text-muted-foreground">{s.note}</span>
                          )}
                        </span>
                      </div>
                      <NativeSelect
                        size="sm"
                        aria-label={`Access for ${s.person_name ?? s.person_email ?? 'this person'}`}
                        value={s.role}
                        disabled={act.isPending}
                        onChange={(e) => {
                          const next = e.target.value as ShareRole;
                          if (s.person_id) act.mutate(() => sharingApi.sharePerson(fileId, s.person_id!, next));
                        }}
                      >
                        <NativeSelectOption value="view">Can view</NativeSelectOption>
                        <NativeSelectOption value="edit">Can edit</NativeSelectOption>
                      </NativeSelect>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={`Stop sharing with ${s.person_name ?? s.person_email ?? 'this person'}`}
                        disabled={act.isPending}
                        onClick={() => act.mutate(() => sharingApi.stop(fileId, s.id))}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <Separator />

        <section aria-labelledby="share-link" className="flex flex-col gap-2">
          <h3 id="share-link" className="m-0 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Link2 className="size-4" aria-hidden="true" /> View link
          </h3>
          <p className="m-0 text-xs text-muted-foreground">
            People with the link can read the {noun}
            {noun === 'presentation' ? ' and present it' : ''}, never change it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Who can open the link"
              value={link?.link_access ?? newLinkAccess}
              disabled={act.isPending}
              onChange={(e) => {
                const access = e.target.value as LinkAccess;
                if (link) act.mutate(() => sharingApi.setLink(fileId, access));
                else setNewLinkAccess(access);
              }}
            >
              <NativeSelectOption value="organization">People in the organization (signed in)</NativeSelectOption>
              <NativeSelectOption value="public">Anyone with the link</NativeSelectOption>
            </NativeSelect>
            {link ? (
              <>
                <ShareStatus share={link} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={link.status !== 'active' || !link.slug}
                  onClick={() => {
                    if (!link.slug) return;
                    void navigator.clipboard.writeText(linkUrl(link.slug)).then(
                      () => toast.success('Link copied.'),
                      () => toast.error("Couldn't copy the link.")
                    );
                  }}
                >
                  <Copy /> Copy link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={act.isPending}
                  onClick={() => act.mutate(() => sharingApi.stop(fileId, link.id))}
                >
                  Turn off
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={act.isPending}
                onClick={() => act.mutate(() => sharingApi.setLink(fileId, newLinkAccess))}
              >
                <Globe /> Create link
              </Button>
            )}
          </div>
          {link?.status === 'active' && link.slug && (
            <p className="m-0 truncate text-xs text-muted-foreground" aria-label="Link address">
              {linkUrl(link.slug)} · opened {link.view_count} {link.view_count === 1 ? 'time' : 'times'}
            </p>
          )}
        </section>
        {shares.isError && (
          <p role="alert" className="m-0 text-sm text-destructive">
            Sharing couldn&apos;t be loaded: {message(shares.error)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
