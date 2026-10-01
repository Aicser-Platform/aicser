/**
 * Which map to draw for a chart: the area the author chose (or the one the data fits, on Auto),
 * then one level deeper per drill step — World → a country's provinces → that province's
 * districts → communes — as far as boundaries exist.
 */
import { buildGeoIndex, matchPlaces, matchShare } from '../utils/geoMatch';
import type { AdminLevel, GeoCollection, GeoFeature } from './mapBoundaries';

export type MapAreaSetting = string; // 'auto' | 'world' | 'continent:Asia' | 'country:KHM'

export type MapView = {
  key: string;
  features: GeoFeature[];
  collection: GeoCollection;
  /** 'world' or the country's ISO3, for attribution and the next drill step. */
  country?: string;
  level?: AdminLevel;
};

export type MapLoaders = {
  loadWorld: () => Promise<GeoCollection>;
  loadAdmin: (iso3: string, level: AdminLevel) => Promise<GeoCollection>;
};

const NEXT: Record<AdminLevel, AdminLevel | undefined> = {
  ADM1: 'ADM2',
  ADM2: 'ADM3',
  ADM3: 'ADM4',
  ADM4: 'ADM5',
  ADM5: undefined,
};

const props = (fs: GeoFeature[]) => fs.map((f) => f.properties);

function worldView(world: GeoCollection, continent?: string, values: string[] = []): MapView {
  const keepAntarctica = matchPlaces(values, buildGeoIndex(props(world.features.filter((f) => f.properties.continent === 'Antarctica')))).matched.size > 0;
  const features = world.features.filter((f) =>
    continent ? f.properties.continent === continent : keepAntarctica || f.properties.continent !== 'Antarctica',
  );
  return { key: continent ? `world|${continent}` : 'world', features, collection: world, country: 'world' };
}

async function tryAdmin(loaders: MapLoaders, iso3: string, level: AdminLevel): Promise<GeoCollection | null> {
  try {
    return await loaders.loadAdmin(iso3, level);
  } catch {
    return null;
  }
}

function countryView(iso3: string, level: AdminLevel, collection: GeoCollection, within?: string): MapView {
  const features = within ? collection.features.filter((f) => f.properties.parent === within) : collection.features;
  return {
    key: within ? `${iso3}_${level}|${within}` : `${iso3}_${level}`,
    features: features.length ? features : collection.features,
    collection,
    country: iso3,
    level,
  };
}

type Ring = number[][];

function ringsOf(geometry: unknown): Ring[] {
  const g = geometry as { type?: string; coordinates?: any } | null;
  if (!g?.coordinates) return [];
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((poly: Ring[]) => poly[0]);
  return [];
}

function inRing([x, y]: number[], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** The country holding most of these [lon, lat] points (checks up to 60 of them), or null. */
export function countryForPoints(world: GeoCollection, points: number[][]): { iso3?: string; continent?: string; share: number } | null {
  const sample = points.slice(0, 60);
  if (!sample.length) return null;
  const counts = new Map<string, number>();
  const continents = new Map<string, number>();
  for (const pt of sample) {
    const hit = world.features.find((f) => ringsOf(f.geometry).some((r) => inRing(pt, r)));
    if (!hit?.properties.iso3) continue;
    counts.set(hit.properties.iso3, (counts.get(hit.properties.iso3) || 0) + 1);
    if (hit.properties.continent) continents.set(hit.properties.continent, (continents.get(hit.properties.continent) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topContinent = [...continents.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  return { iso3: top[0], continent: topContinent?.[0], share: top[1] / sample.length };
}

export async function resolveMapView(
  opts: {
    area?: MapAreaSetting;
    level?: AdminLevel;
    drill?: string[];
    values: string[];
    homeRegion?: string;
    /** [lon, lat] of each point, when the chart places dots. */
    points?: number[][];
  },
  loaders: MapLoaders,
): Promise<MapView> {
  const area = opts.area || 'auto';
  const drill = (opts.drill || []).filter((d) => d != null && d !== '');
  const world = await loaders.loadWorld();
  const worldIndex = buildGeoIndex(props(world.features));
  const isoOf = (place: string) => {
    const name = matchPlaces([place], worldIndex).matched.get(place);
    return world.features.find((f) => f.properties.name === name)?.properties.iso3 || undefined;
  };

  // ── Base area ────────────────────────────────────────────────────────────
  let view: MapView | null = null;
  if (area.startsWith('continent:')) view = worldView(world, area.slice('continent:'.length), opts.values);
  else if (area.startsWith('country:')) {
    const iso3 = area.slice('country:'.length).toUpperCase();
    const level = opts.level || 'ADM1';
    const c = await tryAdmin(loaders, iso3, level);
    if (c) view = countryView(iso3, level, c);
  } else if (area === 'auto' && opts.points?.length) {
    // Dots: zoom to the country that holds most of them, else to their continent.
    const where = countryForPoints(world, opts.points);
    if (where && where.share >= 0.6 && where.iso3) {
      const c = await tryAdmin(loaders, where.iso3, opts.level || 'ADM1');
      if (c) view = countryView(where.iso3, opts.level || 'ADM1', c);
    }
    if (!view && where?.continent) view = worldView(world, where.continent, opts.values);
  } else if (area === 'auto' && opts.values.length && matchShare(opts.values, worldIndex) < 0.5 && opts.homeRegion) {
    // Not countries: try the viewer's own country, provinces first, then districts.
    const iso3 = world.features.find((f) => f.properties.iso2 === opts.homeRegion?.toUpperCase())?.properties.iso3;
    for (const level of ['ADM1', 'ADM2'] as AdminLevel[]) {
      if (!iso3 || view) break;
      const c = await tryAdmin(loaders, iso3, level);
      if (c && matchShare(opts.values, buildGeoIndex(props(c.features))) >= 0.5) view = countryView(iso3, level, c);
    }
  }
  if (!view) view = worldView(world, undefined, opts.values);

  // ── Drill: one level deeper per step, inside the clicked area ────────────
  for (const step of drill) {
    if (view.country === 'world') {
      const iso3 = isoOf(step);
      const c = iso3 ? await tryAdmin(loaders, iso3, 'ADM1') : null;
      if (!iso3 || !c) break;
      view = countryView(iso3, 'ADM1', c);
      continue;
    }
    const next = view.level ? NEXT[view.level] : undefined;
    if (!view.country || !next) break;
    const here = matchPlaces([step], buildGeoIndex(props(view.collection.features))).matched.get(step);
    const c = await tryAdmin(loaders, view.country, next);
    if (!c || !here) break;
    view = countryView(view.country, next, c, here);
  }
  return view;
}
