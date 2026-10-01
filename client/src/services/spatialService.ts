import { fetchApi } from '@/utils/api';
import type { FeatureCollection } from 'geojson';

export type SpatialAnalysis = 'nearest' | 'coverage' | 'density' | 'hotspots' | 'regions';
export type SpatialTravel = 'straight' | 'drive' | 'walk' | 'bike';

export type PointSetSpec = {
  data_source_id: string;
  table: string;
  lat: string;
  lon: string;
  label?: string | null;
  measure?: string | null;
};

export type SpatialRequest = {
  analysis: SpatialAnalysis;
  points: PointSetSpec;
  sites?: PointSetSpec | null;
  travel?: SpatialTravel;
  radius_km?: number;
  minutes?: number;
  resolution?: number | null;
  min_points?: number;
  country?: string | null;
  level?: string | null;
  project_id?: string | null;
};

export type SpatialResult = {
  result_id: string;
  analysis: SpatialAnalysis;
  travel: SpatialTravel;
  summary: Record<string, unknown>;
  groups: Array<Record<string, unknown>>;
  map: { points: FeatureCollection | null; sites: FeatureCollection | null; areas: FeatureCollection | null };
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  notes: Array<{ key: string; count?: number }>;
  attribution?: string | null;
  boundary_license?: string | null;
};

export type SpatialCapabilities = {
  routing: { available: boolean; reason?: string; modes?: string[] };
  limits: { places: number; sites: number; travel_places: number; travel_areas: number };
  attribution: string;
};

export const spatialService = {
  capabilities: () => fetchApi<SpatialCapabilities>('/api/spatial/capabilities'),
  analyze: (body: SpatialRequest) =>
    fetchApi<SpatialResult>('/api/spatial/analyze', { method: 'POST', body: JSON.stringify(body) }),
  save: (resultId: string, name: string, projectId?: string | null) =>
    fetchApi<{ success: boolean; data_source?: { id: string; name: string } }>(
      `/api/spatial/results/${encodeURIComponent(resultId)}/save`,
      { method: 'POST', body: JSON.stringify({ name, project_id: projectId || undefined }) },
    ),
};

const LAT = /^(lat|latitude|lat_deg|y_coord|geo_lat|.*_lat|.*latitude)$/i;
const LON = /^(lon|lng|long|longitude|lon_deg|x_coord|geo_lon|geo_lng|.*_lon|.*_lng|.*longitude)$/i;

/** Latitude and longitude columns guessed from their names (the person can change them). */
export function guessCoordinateColumns(columns: Array<{ name: string; type?: string }>): { lat?: string; lon?: string } {
  const numeric = (c: { type?: string }) => !c.type || /int|float|double|decimal|numeric|real|number/i.test(c.type);
  const lat = columns.find((c) => LAT.test(c.name) && numeric(c))?.name;
  const lon = columns.find((c) => LON.test(c.name) && numeric(c))?.name;
  return { lat, lon };
}
