import { z } from 'zod';
import { fetchApi } from '@/utils/api';

// Sharing Docs and Slides (server office_files/sharing_router.py): with people (view or edit) and by a view
// link, each approved by an organization owner or admin; plus the phone remote for presenting.

const BASE = '/api/office-files';
const enc = encodeURIComponent;
const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export type ShareStatus = 'pending' | 'active' | 'declined' | 'off';
export type ShareRole = 'view' | 'edit';
export type LinkAccess = 'organization' | 'public';

const ShareSchema = z.object({
  id: z.string(),
  target: z.enum(['person', 'link']),
  role: z.enum(['view', 'edit']),
  status: z.enum(['pending', 'active', 'declined', 'off']),
  person_id: z.string().nullable(),
  person_name: z.string().nullable().optional(),
  person_email: z.string().nullable().optional(),
  slug: z.string().nullable(),
  link_access: z.enum(['organization', 'public']).nullable(),
  requested_by_name: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  view_count: z.number().default(0),
});
export type Share = z.infer<typeof ShareSchema>;

const SharesSchema = z.object({ people: z.array(ShareSchema), link: ShareSchema.nullable() });
export type FileShares = z.infer<typeof SharesSchema>;

const PersonSchema = z.object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable() });
export type Person = z.infer<typeof PersonSchema>;

const ApprovalSchema = ShareSchema.extend({
  file_id: z.string(),
  kind: z.enum(['document', 'presentation']),
  title: z.string(),
  review: z.object({ can_approve: z.boolean(), blocked_reason: z.string().nullable() }),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const sharingApi = {
  people: async (q: string) =>
    z
      .object({ people: z.array(PersonSchema), organization: z.boolean() })
      .parse(await fetchApi<unknown>(`${BASE}/people?q=${enc(q)}`)),
  shares: async (fileId: string) => SharesSchema.parse(await fetchApi<unknown>(`${BASE}/${enc(fileId)}/shares`)),
  sharePerson: async (fileId: string, personId: string, role: ShareRole) =>
    SharesSchema.parse(await fetchApi<unknown>(`${BASE}/${enc(fileId)}/shares`, post({ person_id: personId, role }))),
  setLink: async (fileId: string, access: LinkAccess) =>
    SharesSchema.parse(
      await fetchApi<unknown>(`${BASE}/${enc(fileId)}/link`, { method: 'PUT', body: JSON.stringify({ access }) })
    ),
  stop: async (fileId: string, shareId: string) =>
    SharesSchema.parse(await fetchApi<unknown>(`${BASE}/${enc(fileId)}/shares/${enc(shareId)}`, { method: 'DELETE' })),
  approvals: async () =>
    z
      .object({ items: z.array(ApprovalSchema), approver: z.boolean() })
      .parse(await fetchApi<unknown>(`${BASE}/approvals`)),
  approve: async (shareId: string) => {
    await fetchApi<unknown>(`${BASE}/approvals/${enc(shareId)}/approve`, post());
  },
  decline: async (shareId: string, note: string) => {
    await fetchApi<unknown>(`${BASE}/approvals/${enc(shareId)}/decline`, post({ note }));
  },
};

/** The address people open a view link at (this site). */
export const linkUrl = (slug: string) =>
  `${typeof window === 'undefined' ? '' : window.location.origin}/o/${encodeURIComponent(slug)}`;

// ── Opening a link (no sign-in for public links, so not fetchApi: no redirect to the login page) ──────────────

const OpenedSchema = z.object({
  kind: z.enum(['document', 'presentation']),
  title: z.string(),
  body: z.unknown(),
  access: z.enum(['organization', 'public']).nullable(),
});
export type OpenedLink = z.infer<typeof OpenedSchema>;

export type OpenResult =
  | { status: 'open'; link: OpenedLink }
  | { status: 'sign_in' }
  | { status: 'refused'; message: string };

export async function openLink(slug: string): Promise<OpenResult> {
  const res = await fetch(`${BASE}/links/${enc(slug)}/open`, { method: 'POST', credentials: 'include' });
  const body: unknown = await res.json().catch(() => ({}));
  if (res.ok) return { status: 'open', link: OpenedSchema.parse(body) };
  const detail = (body as { detail?: unknown }).detail;
  if (res.status === 401 && detail === 'sign_in_required') return { status: 'sign_in' };
  return { status: 'refused', message: typeof detail === 'string' ? detail : "This link couldn't be opened." };
}

// ── Phone remote ──────────────────────────────────────────────────────────────────────────────────────────────

export type RemoteAction = 'next' | 'previous';

export interface RemoteSlide {
  index: number;
  total: number;
  title: string;
  notes: string;
}

const StartedSchema = z.object({ session_id: z.string(), token: z.string(), path: z.string() });
const CommandsSchema = z.object({
  commands: z.array(z.object({ seq: z.number(), action: z.enum(['next', 'previous']) })),
  connected: z.boolean(),
});

/** The presenting browser's side: start, report the slide on screen, collect phone presses, end. */
export const remoteApi = {
  start: async (fileId: string) =>
    StartedSchema.parse(await fetchApi<unknown>(`${BASE}/${enc(fileId)}/remote`, post())),
  report: async (fileId: string, sessionId: string, slide: RemoteSlide) =>
    z.object({ connected: z.boolean() }).parse(
      await fetchApi<unknown>(`${BASE}/${enc(fileId)}/remote/${enc(sessionId)}`, {
        method: 'PUT',
        body: JSON.stringify(slide),
      })
    ),
  commands: async (fileId: string, sessionId: string, after: number) =>
    CommandsSchema.parse(await fetchApi<unknown>(`${BASE}/${enc(fileId)}/remote/${enc(sessionId)}?after=${after}`)),
  end: async (fileId: string, sessionId: string) => {
    await fetchApi<unknown>(`${BASE}/${enc(fileId)}/remote/${enc(sessionId)}`, { method: 'DELETE' });
  },
};

const PhoneViewSchema = z.object({
  index: z.number(),
  total: z.number(),
  title: z.string(),
  notes: z.string(),
});
export type PhoneView = z.infer<typeof PhoneViewSchema>;

/** The phone's side (token only, no sign-in). Null when the remote has ended. */
export const phoneApi = {
  view: async (token: string): Promise<PhoneView | null> => {
    const res = await fetch(`${BASE}/remote/${enc(token)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`The remote didn't answer (${res.status}).`);
    return PhoneViewSchema.parse(await res.json());
  },
  press: async (token: string, action: RemoteAction): Promise<PhoneView | null> => {
    const res = await fetch(`${BASE}/remote/${enc(token)}/${action}`, { method: 'POST' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`The remote didn't answer (${res.status}).`);
    return PhoneViewSchema.parse(await res.json());
  },
};
