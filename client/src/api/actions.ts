import { fetchApi } from '@/utils/api';

export type DestinationKind = 'email' | 'webhook' | 'slack' | 'teams';
export type Destination = { id: string; name: string; kind: DestinationKind; recipients: string[]; address?: string | null };

/** Any result people can send: a title, optional text, and a table. */
export type ResultPayload = {
  title: string;
  text?: string;
  columns: string[];
  rows: Record<string, unknown>[];
  link?: string;
  source?: Record<string, unknown>;
};

export const listDestinations = () =>
  fetchApi<{ destinations: Destination[] }>('/actions/destinations').then((r) => r.destinations ?? []);

export const createDestination = (body: { name: string; kind: DestinationKind; recipients?: string[]; url?: string }) =>
  fetchApi<Destination>('/actions/destinations', { method: 'POST', body: JSON.stringify(body) });

export const deleteDestination = (id: string) =>
  fetchApi<void>(`/actions/destinations/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const sendResult = (destinationId: string, payload: ResultPayload) =>
  fetchApi<{ sent: boolean; destination: string; rows: number }>('/actions/send', {
    method: 'POST',
    body: JSON.stringify({ destination_id: destinationId, ...payload }),
  });
