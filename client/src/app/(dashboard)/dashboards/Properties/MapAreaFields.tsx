'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Select } from 'antd';
import { useTranslations } from 'next-intl';
import { PpLabel } from './PpLabel';
import { CONTINENTS, loadCountryLevels, loadWorld, type AdminLevel, type GeoCollection } from '../widgets/mapBoundaries';

/**
 * Map area and detail level (Power BI shape map / Tableau): Auto fits the area to the data;
 * otherwise the world, a continent, or any country, at its states/provinces, districts,
 * communes or smaller — only the levels published for that country are offered.
 */
export function MapAreaFields({
  area,
  level,
  onChange,
}: {
  area?: string;
  level?: AdminLevel;
  onChange: (patch: { mapArea?: string; mapLevel?: AdminLevel }) => void;
}) {
  const t = useTranslations('chart_options');
  const [world, setWorld] = useState<GeoCollection | null>(null);
  const [levels, setLevels] = useState<AdminLevel[] | null>(null);
  const country = area?.startsWith('country:') ? area.slice('country:'.length) : null;

  useEffect(() => {
    loadWorld().then(setWorld).catch(() => setWorld(null));
  }, []);
  useEffect(() => {
    setLevels(null);
    if (!country) return;
    loadCountryLevels(country)
      .then((r) => setLevels(r.levels))
      .catch(() => setLevels([]));
  }, [country]);

  const countries = useMemo(
    () =>
      (world?.features || [])
        .map((f) => f.properties)
        .filter((p) => p.iso3 && p.continent !== 'Antarctica')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: `country:${p.iso3}`, label: p.name, search: `${p.name} ${p.iso3} ${p.iso2 ?? ''} ${(p.altNames || []).join(' ')}` })),
    [world],
  );

  return (
    <div className="pp-map-area">
      <div>
        <PpLabel tip={t('map_area_tip')}>{t('map_area')}</PpLabel>
        <Select
          size="small"
          style={{ width: '100%' }}
          showSearch
          value={area || 'auto'}
          onChange={(v) => onChange({ mapArea: v === 'auto' ? undefined : v, mapLevel: undefined })}
          filterOption={(input, opt) =>
            String((opt as { search?: string })?.search ?? opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={[
            { value: 'auto', label: t('map_area_auto'), search: t('map_area_auto') },
            { value: 'world', label: t('map_area_world'), search: t('map_area_world') },
            {
              label: t('map_area_continents'),
              options: CONTINENTS.map((c) => ({ value: `continent:${c}`, label: t(`continent_${c.replace(' ', '_').toLowerCase()}`), search: c })),
            },
            { label: t('map_area_countries'), options: countries },
          ]}
        />
      </div>
      {country ? (
        <div>
          <PpLabel tip={t('map_level_tip')}>{t('map_level')}</PpLabel>
          <Select
            size="small"
            style={{ width: '100%' }}
            loading={levels === null}
            value={level || 'ADM1'}
            onChange={(v) => onChange({ mapLevel: v })}
            options={(levels && levels.length ? levels : (['ADM1'] as AdminLevel[])).map((lv) => ({
              value: lv,
              label: t(`map_level_${lv.toLowerCase()}`),
            }))}
            notFoundContent={t('map_level_none')}
          />
        </div>
      ) : null}
    </div>
  );
}
