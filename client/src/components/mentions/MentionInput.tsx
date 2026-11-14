'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Mentions } from 'antd';
import { listOrganizationMembers, type OrganizationMember } from '@/api/organizations';
import { useOrganizationStore } from '@/stores/useOrganizationStore';

// Stored as @[Name](user:id) so the server knows exactly who was mentioned; shown as @Name.
const TOKEN = /@\[([^\]\n]{1,80})\]\(user:([0-9a-fA-F-]{36})\)/g;

export function displayName(m: OrganizationMember): string {
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || m.username || m.email || 'Member';
}

/** Text for editing: tokens become @Name; returns the people they stood for. */
export function fromBody(body: string): { text: string; people: Record<string, string> } {
  const people: Record<string, string> = {};
  const text = body.replace(TOKEN, (_all, name: string, id: string) => {
    people[name] = id;
    return `@${name}`;
  });
  return { text, people };
}

/** Text to save: each @Name picked from the list becomes a token. */
export function toBody(text: string, people: Record<string, string>): string {
  let out = text;
  for (const [name, id] of Object.entries(people)) {
    out = out.split(`@${name}`).join(`@[${name}](user:${id})`);
  }
  return out;
}

/** A comment body with mentions shown as @Name. */
export function MentionText({ body }: { body: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    parts.push(body.slice(last, m.index));
    parts.push(<strong key={`${m.index}-${m[2]}`}>@{m[1]}</strong>);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(body.slice(last));
  return <>{parts}</>;
}

let membersCache: { org: string; members: OrganizationMember[] } | null = null;

type Props = Omit<React.ComponentProps<typeof Mentions>, 'onChange' | 'value' | 'options'> & {
  value: string;
  onChange: (text: string) => void;
  /** Filled as people are picked, so the caller can save with toBody(). */
  people: React.MutableRefObject<Record<string, string>>;
};

/** A text box where typing @ offers the organization's members. */
export function MentionInput({ value, onChange, people, onSelect, ...rest }: Props) {
  const orgId = useOrganizationStore((s) => s.currentOrganization?.id ?? null);
  const [members, setMembers] = useState<OrganizationMember[]>(membersCache?.org === orgId ? membersCache.members : []);
  const loaded = useRef(false);

  useEffect(() => {
    if (!orgId || loaded.current || membersCache?.org === orgId) return;
    loaded.current = true;
    listOrganizationMembers(String(orgId))
      .then(({ members: list }) => {
        membersCache = { org: String(orgId), members: list };
        setMembers(list);
      })
      .catch(() => setMembers([]));
  }, [orgId]);

  return (
    <Mentions
      {...rest}
      value={value}
      onChange={onChange}
      onSelect={(option, prefix) => {
        const m = members.find((x) => x.user_id === option.key);
        if (m) people.current[displayName(m)] = m.user_id;
        onSelect?.(option, prefix);
      }}
      options={members.map((m) => ({ key: m.user_id, value: displayName(m), label: displayName(m) }))}
    />
  );
}
