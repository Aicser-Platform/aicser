'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Globe, Link2, ShieldCheck, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/aicser-ui/button';
import { Card, CardContent } from '@/components/aicser-ui/card';
import { Input } from '@/components/aicser-ui/input';
import { sharingApi, type Approval } from '@/lib/office/sharing';
import type { OfficeKind } from '@/lib/office/store';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function describe(item: Approval): string {
  if (item.target === 'link')
    return item.link_access === 'public' ? 'View link for anyone (public)' : 'View link for the organization';
  const who = item.person_name ?? item.person_email ?? 'someone';
  return `${item.role === 'edit' ? 'Can edit' : 'Can view'}: ${who}`;
}

/**
 * Shares waiting for approval, shown to organization owners and admins on the Docs or Slides list (the bell's
 * approval notice opens it with `?review=1`). Shows nothing to everyone else.
 */
export function ApprovalsPanel({ kind, focus }: Readonly<{ kind: OfficeKind; focus?: boolean }>) {
  const queryClient = useQueryClient();
  const approvals = useQuery({ queryKey: ['office-approvals'], queryFn: sharingApi.approvals, staleTime: 0 });
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const ref = useRef<HTMLElement>(null);
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? sharingApi.approve(id) : sharingApi.decline(id, note.trim()),
    onSuccess: (_, { approve }) => {
      toast.success(approve ? 'Approved. The share is open now.' : 'Declined. Whoever asked has been told.');
      setDeclining(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['office-approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['office-shares'] });
    },
    onError: (error) => toast.error(message(error)),
  });

  const items = (approvals.data?.items ?? []).filter((i) => i.kind === kind);
  useEffect(() => {
    if (focus && items.length) ref.current?.scrollIntoView({ block: 'start' });
  }, [focus, items.length]);

  if (!approvals.data?.approver || (!items.length && !focus)) return null;
  return (
    <section ref={ref} aria-labelledby="office-approvals" className="flex flex-col gap-2">
      <h2 id="office-approvals" className="m-0 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <ShieldCheck className="size-4 text-primary-active" aria-hidden="true" /> Waiting for your approval
        {items.length > 0 && <span className="text-muted-foreground">({items.length})</span>}
      </h2>
      {items.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">Nothing is waiting. Every share has been decided.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0 lg:grid-cols-2" aria-label="Shares waiting for approval">
          {items.map((item) => {
            const Icon = item.target === 'link' ? (item.link_access === 'public' ? Globe : Link2) : UserRound;
            return (
              <li key={item.id}>
                <Card className="gap-2 py-3">
                  <CardContent className="flex flex-col gap-2 px-3">
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium text-foreground">{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {describe(item)} · asked by {item.requested_by_name ?? 'a member'}
                        </span>
                      </div>
                    </div>
                    {declining === item.id ? (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          decide.mutate({ id: item.id, approve: false });
                        }}
                      >
                        <Input
                          aria-label="Why (optional, sent to whoever asked)"
                          placeholder="Why (optional)"
                          maxLength={300}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <Button type="submit" size="sm" variant="destructive" disabled={decide.isPending}>
                          Decline
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeclining(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : item.review.can_approve ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: item.id, approve: true })}
                        >
                          <Check /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decide.isPending}
                          onClick={() => setDeclining(item.id)}
                        >
                          <X /> Decline
                        </Button>
                      </div>
                    ) : (
                      <p className="m-0 text-xs text-muted-foreground">
                        Your organization asks another owner or admin to approve your own shares.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
