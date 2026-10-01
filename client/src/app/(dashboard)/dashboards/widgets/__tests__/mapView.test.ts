import { describe, expect, it } from 'vitest';
import { resolveMapView } from '../mapView';

const f = (properties: Record<string, unknown>) => ({ type: 'Feature', properties, geometry: null }) as any;
const world = {
  type: 'FeatureCollection',
  features: [
    f({ name: 'Cambodia', iso3: 'KHM', iso2: 'KH', continent: 'Asia' }),
    f({ name: 'Thailand', iso3: 'THA', iso2: 'TH', continent: 'Asia' }),
    f({ name: 'France', iso3: 'FRA', iso2: 'FR', continent: 'Europe' }),
    f({ name: 'Antarctica', iso3: 'ATA', continent: 'Antarctica' }),
  ],
} as any;
const admin: Record<string, any> = {
  KHM_ADM1: { type: 'FeatureCollection', features: [f({ name: 'Battambang' }), f({ name: 'Siem Reap' })] },
  KHM_ADM2: {
    type: 'FeatureCollection',
    features: [f({ name: 'Sangkae', parent: 'Battambang' }), f({ name: 'Thma Koul', parent: 'Battambang' }), f({ name: 'Angkor Thum', parent: 'Siem Reap' })],
  },
};
const loaders = {
  loadWorld: async () => world,
  loadAdmin: async (iso3: string, level: string) => {
    const c = admin[`${iso3}_${level}`];
    if (!c) throw new Error('none');
    return c;
  },
};

describe('map view', () => {
  it('shows the world for country data, without Antarctica', async () => {
    const v = await resolveMapView({ values: ['Cambodia', 'France'] }, loaders);
    expect(v.key).toBe('world');
    expect(v.features.map((x) => x.properties.name)).not.toContain('Antarctica');
  });

  it('finds the viewer’s own country for province data on Auto', async () => {
    const v = await resolveMapView({ values: ['Battambang', 'Siem Reap Province'], homeRegion: 'KH' }, loaders);
    expect(v.key).toBe('KHM_ADM1');
  });

  it('drills world → provinces → one province’s districts', async () => {
    const v1 = await resolveMapView({ area: 'world', values: ['Cambodia'], drill: ['Cambodia'] }, loaders);
    expect(v1.key).toBe('KHM_ADM1');
    const v2 = await resolveMapView({ area: 'world', values: [], drill: ['Cambodia', 'Battambang'] }, loaders);
    expect(v2.key).toBe('KHM_ADM2|Battambang');
    expect(v2.features.map((x) => x.properties.name)).toEqual(['Sangkae', 'Thma Koul']);
  });

  it('stops at the deepest level that exists', async () => {
    const v = await resolveMapView({ area: 'country:KHM', level: 'ADM2', values: [], drill: ['Sangkae'] }, loaders);
    expect(v.key).toBe('KHM_ADM2');
  });

  it('shows one continent', async () => {
    const v = await resolveMapView({ area: 'continent:Asia', values: [] }, loaders);
    expect(v.features.map((x) => x.properties.name)).toEqual(['Cambodia', 'Thailand']);
  });
});

describe('map view for points', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
  const w = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Cambodia', iso3: 'KHM', iso2: 'KH', continent: 'Asia' }, geometry: sq(102, 10, 108, 15) },
      { type: 'Feature', properties: { name: 'Thailand', iso3: 'THA', iso2: 'TH', continent: 'Asia' }, geometry: sq(97, 5, 102, 21) },
    ],
  } as any;
  const l = { loadWorld: async () => w, loadAdmin: loaders.loadAdmin };

  it('zooms to the country holding the dots', async () => {
    const v = await resolveMapView({ values: ['Shop A', 'Shop B'], points: [[104.9, 11.5], [103.8, 13.3], [105, 12]] }, l);
    expect(v.key).toBe('KHM_ADM1');
  });

  it('falls back to the continent when dots span countries', async () => {
    const v = await resolveMapView({ values: [], points: [[104.9, 11.5], [100, 13], [99, 14]] }, l);
    expect(v.key).toBe('world|Asia');
  });
});
