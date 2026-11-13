import { z } from 'zod';
import { fetchApi } from '@/utils/api';

// Docs documents and Slides presentations, stored on the server (`/api/office-files`, server module
// office_files): a title, the editor's JSON body (validated with Zod on the way in) and small list details.

export type OfficeKind = 'document' | 'presentation';

const SummarySchema = z.object({
  id: z.string(),
  kind: z.enum(['document', 'presentation']),
  title: z.string(),
  meta: z.record(z.string(), z.unknown()).default({}),
  visibility: z.enum(['private', 'project']),
  version: z.number().int(),
  project_id: z.string().nullable(),
  is_owner: z.boolean(),
  role: z.enum(['owner', 'edit', 'view']).default('owner'),
  updated_at: z.string().nullable(),
});

export interface OfficeFileSummary {
  id: string;
  kind: OfficeKind;
  title: string;
  meta: Record<string, unknown>;
  visibility: 'private' | 'project';
  version: number;
  projectId: string | null;
  isOwner: boolean;
  /** owner | edit (may change it) | view (read only): from shares an organization owner or admin approved. */
  role: 'owner' | 'edit' | 'view';
  /** Milliseconds since the epoch (0 when unknown). */
  updatedAt: number;
}

const toSummary = (raw: z.infer<typeof SummarySchema>): OfficeFileSummary => ({
  id: raw.id,
  kind: raw.kind,
  title: raw.title,
  meta: raw.meta,
  visibility: raw.visibility,
  version: raw.version,
  projectId: raw.project_id,
  isOwner: raw.is_owner,
  role: raw.role,
  updatedAt: raw.updated_at ? Date.parse(raw.updated_at) || 0 : 0,
});

export interface OfficePatch<Body> {
  title?: string;
  body?: Body;
  meta?: Record<string, unknown>;
}

export interface OfficeStore<Body> {
  kind: OfficeKind;
  list(projectId: string | null): Promise<OfficeFileSummary[]>;
  get(id: string): Promise<{ summary: OfficeFileSummary; body: Body }>;
  create(
    file: { title: string; body: Body; meta?: Record<string, unknown> },
    projectId: string | null
  ): Promise<OfficeFileSummary>;
  /** `version` is the one the change was made on; the server refuses a stale one (409). */
  update(id: string, patch: OfficePatch<Body>, version: number): Promise<OfficeFileSummary>;
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  duplicate(id: string): Promise<OfficeFileSummary>;
}

const BASE = '/api/office-files';
const enc = encodeURIComponent;
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** `parse` validates a stored body (a Zod schema's `parse`) and throws when it isn't one. */
export function officeStore<Body extends Record<string, unknown>>(
  kind: OfficeKind,
  parse: (body: unknown) => Body,
  noun: string
): OfficeStore<Body> {
  return {
    kind,
    list: async (projectId) => {
      const query = `kind=${kind}${projectId ? `&project_id=${enc(projectId)}` : ''}`;
      const raw = await fetchApi<unknown>(`${BASE}?${query}`);
      return z
        .object({ items: z.array(SummarySchema) })
        .parse(raw)
        .items.map(toSummary);
    },
    get: async (id) => {
      const raw = SummarySchema.extend({ body: z.unknown() }).parse(await fetchApi<unknown>(`${BASE}/${enc(id)}`));
      if (raw.kind !== kind) throw new Error(`That file is not a ${noun}.`);
      return { summary: toSummary(raw), body: parse(raw.body) };
    },
    create: async (file, projectId) =>
      toSummary(
        SummarySchema.parse(
          await fetchApi<unknown>(
            BASE,
            json('POST', { kind, title: file.title, body: file.body, meta: file.meta ?? {}, project_id: projectId })
          )
        )
      ),
    update: async (id, patch, version) =>
      toSummary(SummarySchema.parse(await fetchApi<unknown>(`${BASE}/${enc(id)}`, json('PUT', { ...patch, version })))),
    remove: async (id) => {
      await fetchApi<unknown>(`${BASE}/${enc(id)}`, json('DELETE'));
    },
    restore: async (id) => {
      await fetchApi<unknown>(`${BASE}/${enc(id)}/restore`, json('POST'));
    },
    duplicate: async (id) =>
      toSummary(SummarySchema.parse(await fetchApi<unknown>(`${BASE}/${enc(id)}/duplicate`, json('POST')))),
  };
}
