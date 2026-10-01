/**
 * Match the place names in a chart's data to map areas, the way people actually write them:
 * "USA", "U.S.", "United States of America", "US"; "Phnom Penh", "Phnom Penh Capital";
 * "Guangdong", "Guangdong Province", "广东省"; ISO codes ("KH", "KHM", "US-CA", "CA"); accents
 * and case ignored; a close spelling accepted for longer names. Works for any country's data.
 */

export type GeoFeatureProps = {
  name: string;
  iso2?: string | null;
  iso3?: string | null;
  code?: string | null;
  parent?: string | null;
  continent?: string | null;
  altNames?: string[];
};

/** Words that name the kind of area rather than the area ("Battambang Province"). */
const AREA_WORDS = [
  'province', 'provinces', 'state', 'region', 'district', 'municipality', 'city', 'county', 'prefecture',
  'oblast', 'governorate', 'department', 'territory', 'capital', 'special administrative region',
  'autonomous region', 'autonomous prefecture', 'khet', 'srok', 'khan', 'krong', 'tinh', 'thanh pho',
  'changwat', 'amphoe', 'kabupaten', 'kota', 'provinsi', 'of', 'the',
];
/** Written after the name in Chinese / Japanese ("广东省"), before it in Khmer and Thai ("ខេត្តសៀមរាប"). */
const AREA_SUFFIX_CHARS = ['特别行政区', '自治区', '省', '市', '县', '区', '都', '道', '府', '県'];
const AREA_PREFIX_CHARS = ['រាជធានី', 'ខេត្ត', 'ស្រុក', 'ក្រុង', 'จังหวัด', 'อำเภอ'];

/** Country names people use that differ from the map's own names. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  USA: ['united states', 'united states of america', 'usa', 'us', 'u s', 'america'],
  GBR: ['united kingdom', 'uk', 'great britain', 'britain', 'england'],
  RUS: ['russia', 'russian federation'],
  KOR: ['south korea', 'korea', 'republic of korea', 'korea republic of'],
  PRK: ['north korea', 'dprk', 'democratic peoples republic of korea'],
  VNM: ['vietnam', 'viet nam'],
  LAO: ['laos', 'lao pdr', 'lao peoples democratic republic'],
  CZE: ['czech republic', 'czechia'],
  CIV: ['ivory coast', 'cote divoire'],
  COD: ['drc', 'dr congo', 'democratic republic of the congo', 'congo kinshasa'],
  COG: ['republic of the congo', 'congo brazzaville'],
  MMR: ['myanmar', 'burma'],
  IRN: ['iran', 'islamic republic of iran'],
  SYR: ['syria'],
  TWN: ['taiwan'],
  TZA: ['tanzania'],
  BOL: ['bolivia'],
  VEN: ['venezuela'],
  MKD: ['north macedonia', 'macedonia'],
  SWZ: ['eswatini', 'swaziland'],
  TLS: ['timor leste', 'east timor'],
  ARE: ['uae', 'united arab emirates'],
  CHN: ['china', 'prc', 'peoples republic of china', 'mainland china'],
  KHM: ['cambodia', 'kampuchea', 'kingdom of cambodia'],
};

export function normalizePlace(text: unknown): string {
  let s = String(text ?? '').trim();
  for (const suffix of AREA_SUFFIX_CHARS) {
    if (s.length > suffix.length && s.endsWith(suffix)) s = s.slice(0, -suffix.length);
  }
  for (const prefix of AREA_PREFIX_CHARS) {
    if (s.length > prefix.length && s.startsWith(prefix)) s = s.slice(prefix.length).trim();
  }
  s = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    // Letters, digits and combining marks (Khmer, Thai and Indic vowel signs are marks).
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
  const words = s.split(' ').filter((w) => w && !AREA_WORDS.includes(w));
  // Multi-word area words ("special administrative region").
  let joined = words.join(' ');
  for (const phrase of AREA_WORDS.filter((w) => w.includes(' '))) joined = joined.replace(phrase, '').trim();
  return joined.replace(/\s+/g, ' ') || s;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/**
 * A short name for an area: the initials of a multi-word name ("Phnom Penh" → "PP",
 * "Banteay Meanchey" → "BM"), else the first three letters ("Battambang" → "BAT"). Only
 * returned when no other area in the set shares it, so a short name never points two ways.
 */
export function shortNames(names: string[]): Map<string, string> {
  const candidate = (name: string) => {
    const words = normalizePlace(name).split(' ').filter(Boolean);
    if (words.length >= 2) return words.map((w) => w[0]).join('').toUpperCase().slice(0, 3);
    return (words[0] || '').slice(0, 3).toUpperCase();
  };
  const counts = new Map<string, number>();
  const byName = new Map<string, string>();
  for (const n of names) {
    const c = candidate(n);
    if (c.length < 2) continue;
    byName.set(n, c);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [n, c] of byName) if (counts.get(c) === 1) out.set(n, c);
  return out;
}

/** Every way a feature can be written, normalized, mapped to its display name. */
export function buildGeoIndex(features: GeoFeatureProps[]): Map<string, string> {
  const index = new Map<string, string>();
  const add = (key: unknown, name: string) => {
    const k = normalizePlace(key);
    if (k && !index.has(k)) index.set(k, name);
  };
  // Unambiguous short names ("PP", "SR", "BAT") are accepted after every longer form.
  const shorts = shortNames(features.map((f) => f.name));
  for (const f of features) {
    add(f.name, f.name);
    for (const alt of f.altNames || []) add(alt, f.name);
    if (f.iso3) {
      add(f.iso3, f.name);
      for (const alias of COUNTRY_ALIASES[f.iso3] || []) add(alias, f.name);
    }
    if (f.iso2) add(f.iso2, f.name);
    if (f.code) {
      add(f.code, f.name); // "US-CA", "KH-12"
      const tail = String(f.code).split('-').pop();
      if (tail && tail.length >= 2 && !/^\d$/.test(tail)) add(tail, f.name); // "CA"
      if (tail && /^\d+$/.test(tail)) add(`${f.code}`, f.name);
    }
  }
  for (const [name, short] of shorts) add(short, name);
  return index;
}

export type GeoMatchResult = {
  /** data value → map feature name */
  matched: Map<string, string>;
  unmatched: string[];
};

export function matchPlaces(values: unknown[], index: Map<string, string>): GeoMatchResult {
  const matched = new Map<string, string>();
  const unmatched: string[] = [];
  const keys = [...index.keys()];
  for (const v of values) {
    const raw = String(v ?? '');
    if (!raw || matched.has(raw)) continue;
    const k = normalizePlace(raw);
    let name = index.get(k);
    if (!name && k.length >= 5) {
      // A close spelling ("Siem Reab" / "Siem Reap"), only when one candidate is clearly closest.
      let best: string | undefined;
      let bestD = Infinity;
      let tie = false;
      for (const key of keys) {
        if (Math.abs(key.length - k.length) > 2) continue;
        const d = levenshtein(k, key);
        if (d < bestD) {
          bestD = d;
          best = key;
          tie = false;
        } else if (d === bestD) tie = true;
      }
      if (best && !tie && bestD <= Math.max(1, Math.floor(k.length / 6))) name = index.get(best);
    }
    if (name) matched.set(raw, name);
    else unmatched.push(raw);
  }
  return { matched, unmatched };
}

/** Share of values that are known places on this map (0-1). */
export function matchShare(values: unknown[], index: Map<string, string>): number {
  const distinct = [...new Set(values.map((v) => String(v ?? '')).filter(Boolean))];
  if (!distinct.length) return 0;
  return matchPlaces(distinct, index).matched.size / distinct.length;
}
