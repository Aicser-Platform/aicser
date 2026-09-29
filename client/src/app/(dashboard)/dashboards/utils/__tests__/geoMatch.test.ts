import { describe, expect, it } from 'vitest';
import { buildGeoIndex, matchPlaces, normalizePlace } from '../geoMatch';

const world = buildGeoIndex([
  { name: 'United States of America', iso3: 'USA', iso2: 'US' },
  { name: 'Cambodia', iso3: 'KHM', iso2: 'KH', altNames: ['柬埔寨', 'Kambodscha'] },
  { name: "Côte d'Ivoire", iso3: 'CIV', iso2: 'CI' },
  { name: 'China', iso3: 'CHN', iso2: 'CN', altNames: ['中国'] },
]);

describe('place matching', () => {
  it('reads countries however people write them', () => {
    const { matched, unmatched } = matchPlaces(['USA', 'U.S.', 'united states', 'KH', 'KHM', '柬埔寨', 'Ivory Coast', 'Cote d’Ivoire', 'China', 'Atlantis'], world);
    expect(matched.get('USA')).toBe('United States of America');
    expect(matched.get('U.S.')).toBe('United States of America');
    expect(matched.get('KH')).toBe('Cambodia');
    expect(matched.get('柬埔寨')).toBe('Cambodia');
    expect(matched.get('Ivory Coast')).toBe("Côte d'Ivoire");
    expect(matched.get('Cote d’Ivoire')).toBe("Côte d'Ivoire");
    expect(unmatched).toEqual(['Atlantis']);
  });

  it('reads provinces with or without the area word, codes and close spellings', () => {
    const provinces = buildGeoIndex([
      { name: 'Siem Reap', code: 'KH-17' },
      { name: 'Phnom Penh', code: 'KH-12' },
      { name: 'California', code: 'US-CA' },
      { name: 'Guangdong', code: 'CN-GD' },
    ]);
    const { matched } = matchPlaces(['Siem Reap Province', 'Siem Reab', 'Phnom Penh Capital', 'KH-12', 'CA', '广东省'.replace('广东', 'Guangdong')], provinces);
    expect(matched.get('Siem Reap Province')).toBe('Siem Reap');
    expect(matched.get('Siem Reab')).toBe('Siem Reap');
    expect(matched.get('Phnom Penh Capital')).toBe('Phnom Penh');
    expect(matched.get('KH-12')).toBe('Phnom Penh');
    expect(matched.get('CA')).toBe('California');
  });

  it('ignores case, accents and area words in any script', () => {
    expect(normalizePlace('São Paulo State')).toBe('sao paulo');
    expect(normalizePlace('ខេត្តសៀមរាប')).toBe(normalizePlace('សៀមរាប'));
  });
});

describe('short names', () => {
  it('match unambiguous initials and three-letter forms', async () => {
    const { shortNames } = await import('../geoMatch');
    const idx = buildGeoIndex([
      { name: 'Phnom Penh' }, { name: 'Siem Reap' }, { name: 'Battambang' }, { name: 'Kampong Cham' }, { name: 'Kampong Chhnang' },
    ]);
    const { matched, unmatched } = matchPlaces(['PP', 'SR', 'BAT', 'KC'], idx);
    expect(matched.get('PP')).toBe('Phnom Penh');
    expect(matched.get('SR')).toBe('Siem Reap');
    expect(matched.get('BAT')).toBe('Battambang');
    // "KC" could be Kampong Cham or Kampong Chhnang: not guessed.
    expect(unmatched).toContain('KC');
    expect(shortNames(['Phnom Penh', 'Kampong Cham', 'Kampong Chhnang']).get('Kampong Cham')).toBeUndefined();
  });
});
