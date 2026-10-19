import { fetchApi } from '@/utils/api';

export type SemanticDomain = {
  id: string;
  name: string;
  description?: string | null;
  is_core: boolean;
  steward_ids: string[];
  owner_id?: string | null;
  source_ids: string[];
};

const ROOT = '/api/semantic-domains';

export const listDomains = () => fetchApi<{ domains: SemanticDomain[] }>(ROOT).then((r) => r.domains ?? []);

export const createDomain = (body: { name: string; description?: string; is_core?: boolean }) =>
  fetchApi<SemanticDomain>(ROOT, { method: 'POST', body: JSON.stringify(body) });

export const updateDomain = (id: string, body: Partial<{ name: string; description: string; is_core: boolean }>) =>
  fetchApi<SemanticDomain>(`${ROOT}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteDomain = (id: string) => fetchApi<void>(`${ROOT}/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const addDomainSource = (domainId: string, dataSourceId: string) =>
  fetchApi<void>(`${ROOT}/${encodeURIComponent(domainId)}/sources/${encodeURIComponent(dataSourceId)}`, { method: 'PUT' });

export const removeDomainSource = (domainId: string, dataSourceId: string) =>
  fetchApi<void>(`${ROOT}/${encodeURIComponent(domainId)}/sources/${encodeURIComponent(dataSourceId)}`, {
    method: 'DELETE',
  });

/** Which domains a source belongs to, from the domain list. */
export function domainsForSource(domains: SemanticDomain[], sourceId: string): SemanticDomain[] {
  return domains.filter((d) => d.source_ids.includes(sourceId));
}

/** Changes needed to move a source from its current domains to `next`. */
export function domainDiff(current: string[], next: string[]): { add: string[]; remove: string[] } {
  return {
    add: next.filter((id) => !current.includes(id)),
    remove: current.filter((id) => !next.includes(id)),
  };
}

export type CoreDimension = {
  id: string;
  name: string;
  expression?: string | null;
  description?: string | null;
  data_source_id: string;
  /** same_connection and lakehouse can be used here; needs_lakehouse means land this connection first. */
  availability: 'same_connection' | 'lakehouse' | 'needs_lakehouse';
};

export const listCoreDimensions = (dataSourceId: string) =>
  fetchApi<{ dimensions: CoreDimension[] }>(`${ROOT}/core-dimensions?data_source_id=${encodeURIComponent(dataSourceId)}`).then(
    (r) => r.dimensions ?? [],
  );

/** The organization calendar every time dimension follows (kept on the Core domain). */
export type OrgCalendar = { fiscal_year_start_month: number; week_start: 'monday' | 'sunday' };

export const getCalendar = () => fetchApi<OrgCalendar>(`${ROOT}/calendar`);

export const setCalendar = (calendar: OrgCalendar) =>
  fetchApi<OrgCalendar>(`${ROOT}/calendar`, { method: 'PUT', body: JSON.stringify(calendar) });
