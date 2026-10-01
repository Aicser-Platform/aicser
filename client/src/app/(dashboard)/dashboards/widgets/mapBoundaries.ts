/**
 * Map boundaries for the map widget, from the server (which fetches them once from Natural Earth
 * and geoBoundaries and caches them). Each set is fetched once per page and registered with
 * ECharts under a stable key; filtered views (a continent, a province's districts) register
 * their own key built from the same features.
 */
import * as echarts from 'echarts';
import { fetchApi } from '@/utils/api';
import type { GeoFeatureProps } from '../utils/geoMatch';

export type GeoFeature = { type: 'Feature'; properties: GeoFeatureProps; geometry: unknown };
export type GeoCollection = {
  type: 'FeatureCollection';
  features: GeoFeature[];
  source?: string;
  license?: string;
};

export type AdminLevel = 'ADM1' | 'ADM2' | 'ADM3' | 'ADM4' | 'ADM5';

const cache = new Map<string, Promise<GeoCollection>>();
const registered = new Set<string>();

function load(key: string, endpoint: string): Promise<GeoCollection> {
  let p = cache.get(key);
  if (!p) {
    p = fetchApi<GeoCollection>(endpoint);
    p.catch(() => cache.delete(key)); // let a later render retry
    cache.set(key, p);
  }
  return p;
}

export const loadWorld = () => load('world', 'geo/world');

export const loadCountryLevels = (iso3: string) =>
  fetchApi<{ country: string; levels: AdminLevel[] }>(`geo/countries/${encodeURIComponent(iso3)}/levels`);

export const loadAdmin = (iso3: string, level: AdminLevel) =>
  load(`${iso3}_${level}`, `geo/countries/${encodeURIComponent(iso3)}/${level}`);

/** Register (once) a map made of these features under `key`; returns the key. */
export function registerMap(key: string, collection: GeoCollection, features = collection.features): string {
  if (!registered.has(key)) {
    echarts.registerMap(key, { type: 'FeatureCollection', features } as never);
    registered.add(key);
  }
  return key;
}

export const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'] as const;
