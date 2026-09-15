'use client';

import { useEffect, useMemo, useState } from 'react';
import { listOrganizationMembers } from '@/api/organizations';
import { listProjectMembers } from '@/api/projects';

export interface MentionableMember {
  user_id: string;
  /** Stable, whitespace-free text inserted as "@<token>" - antd's Mentions
   * component ties the literal inserted text to this value, so it can't be a
   * display name with spaces. Prefers username, then email local-part, then
   * a short id fragment - always unique enough within one dropdown. */
  token: string;
  label: string;
}

function toToken(raw: { user_id: string; username?: string | null; email?: string | null }): string {
  const cleanUsername = (raw.username || '').trim();
  if (cleanUsername) return cleanUsername.replace(/\s+/g, '_');
  const emailLocal = (raw.email || '').split('@')[0]?.trim();
  if (emailLocal) return emailLocal.replace(/\s+/g, '_');
  return raw.user_id.slice(0, 8);
}

function toLabel(raw: {
  username?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}): string {
  const full = raw.full_name || `${raw.first_name || ''} ${raw.last_name || ''}`.trim();
  if (full) return full;
  if (raw.username) return raw.username;
  if (raw.email) return raw.email;
  return 'Member';
}

/**
 * Mentionable members for a post/comment's @-mention picker, scoped to
 * whichever audience the content targets - organization-wide or one
 * project. Reuses the same member-listing endpoints already built for the
 * Settings > Team / Project member pickers (no new backend endpoint).
 * De-duplicates against `excludeUserId` (skip mentioning yourself).
 */
export function useMentionableMembers(
  scope: 'organization' | 'project' | null,
  targetId: string | undefined,
  excludeUserId?: string,
): { members: MentionableMember[]; loading: boolean; options: { value: string; label: string }[] } {
  const [members, setMembers] = useState<MentionableMember[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!scope || !targetId) {
      setMembers([]);
      return;
    }
    let active = true;
    setLoading(true);

    const run = async () => {
      try {
        if (scope === 'organization') {
          const res = await listOrganizationMembers(targetId);
          if (!active) return;
          setMembers(
            res.members
              .filter((m) => m.user_id !== excludeUserId)
              .map((m) => ({ user_id: m.user_id, token: toToken(m), label: toLabel(m) })),
          );
        } else {
          const res = await listProjectMembers(targetId, 1, 100);
          if (!active) return;
          setMembers(
            res.members
              .filter((m) => m.user_id !== excludeUserId)
              .map((m) => ({
                user_id: m.user_id,
                token: toToken({ user_id: m.user_id, email: m.email }),
                label: toLabel({ email: m.email, full_name: m.full_name }),
              })),
          );
        }
      } catch {
        // Mentions are a nice-to-have on top of posting/commenting - a failed
        // member lookup should never block either, just leave the picker empty.
        if (active) setMembers([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [scope, targetId, excludeUserId]);

  const options = useMemo(
    () => members.map((m) => ({ value: m.token, label: `${m.label} (@${m.token})` })),
    [members],
  );

  return { members, loading, options };
}

/** Resolve @token occurrences in free text back to real user ids, using the
 * same member list the Mentions dropdown was populated from. Tokens with no
 * match (typed manually, not selected from the dropdown) are ignored -
 * mentioning only fires for a real, resolvable org/project member. */
export function resolveMentionedUserIds(text: string, members: MentionableMember[]): string[] {
  if (!text || !members.length) return [];
  const byToken = new Map(members.map((m) => [m.token.toLowerCase(), m.user_id]));
  const found = new Set<string>();
  const re = /@([a-zA-Z0-9._-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const uid = byToken.get(match[1].toLowerCase());
    if (uid) found.add(uid);
  }
  return Array.from(found);
}
