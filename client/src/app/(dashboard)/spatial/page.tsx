'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Alert, App, Button, Card, Col, Form, Input, InputNumber, Modal, Radio, Row, Segmented, Select, Slider, Space, Statistic, Table, Tooltip, Typography,
} from 'antd';
import {
  AimOutlined, AppstoreOutlined, CarOutlined, EnvironmentOutlined, FireOutlined, GlobalOutlined, RadarChartOutlined, SaveOutlined,
} from '@ant-design/icons';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  spatialService, type SpatialAnalysis, type SpatialCapabilities, type SpatialRequest, type SpatialResult, type SpatialTravel,
} from '@/services/spatialService';
import { PointSetPicker, isComplete, type PointSetDraft } from './components/PointSetPicker';
import './spatial.css';

const BasemapMap = dynamic(() => import('@/components/maps/BasemapMap'), { ssr: false });

const { Paragraph, Text } = Typography;

const QUESTIONS: Array<{ key: SpatialAnalysis; icon: React.ReactNode }> = [
  { key: 'nearest', icon: <AimOutlined /> },
  { key: 'coverage', icon: <RadarChartOutlined /> },
  { key: 'density', icon: <AppstoreOutlined /> },
  { key: 'hotspots', icon: <FireOutlined /> },
  { key: 'regions', icon: <GlobalOutlined /> },
];

const HEX_SIZES = [
  { value: 0, key: 'hex_auto' },
  { value: 9, key: 'hex_street' },
  { value: 8, key: 'hex_neighbourhood' },
  { value: 7, key: 'hex_town' },
  { value: 6, key: 'hex_district' },
  { value: 5, key: 'hex_region' },
];

const LEVELS = ['ADM1', 'ADM2', 'ADM3'];

function pct(v: unknown): string {
  return typeof v === 'number' ? `${Math.round(v * 1000) / 10}%` : '—';
}

function num(v: unknown, digits = 1): string {
  return typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
}

export default function SpatialPage() {
  const t = useTranslations('spatial');
  const { message } = App.useApp();
  const { isDarkMode } = useThemeMode();
  const rawProjectId = useProjectStore((s) => s.currentProjectId);
  const projectId = rawProjectId != null ? String(rawProjectId) : null;

  const [analysis, setAnalysis] = useState<SpatialAnalysis>('nearest');
  const [points, setPoints] = useState<PointSetDraft>({});
  const [sites, setSites] = useState<PointSetDraft>({});
  const [travel, setTravel] = useState<SpatialTravel>('straight');
  const [radiusKm, setRadiusKm] = useState(3);
  const [minutes, setMinutes] = useState(15);
  const [hotspotKm, setHotspotKm] = useState(1);
  const [minPoints, setMinPoints] = useState(10);
  const [resolution, setResolution] = useState(0);
  const [level, setLevel] = useState('ADM1');
  const [caps, setCaps] = useState<SpatialCapabilities | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpatialResult | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    spatialService.capabilities().then(setCaps).catch(() => setCaps(null));
  }, []);

  const needsSites = analysis === 'nearest' || analysis === 'coverage';
  const usesTravel = needsSites;
  const routingReady = Boolean(caps?.routing.available);
  const effectiveTravel: SpatialTravel = usesTravel && routingReady ? travel : 'straight';
  const ready = isComplete(points) && (!needsSites || isComplete(sites));

  const onPoints = useCallback((p: PointSetDraft) => setPoints(p), []);
  const onSites = useCallback((p: PointSetDraft) => setSites(p), []);

  const run = async () => {
    if (!isComplete(points)) return;
    const body: SpatialRequest = {
      analysis,
      points,
      sites: needsSites && isComplete(sites) ? sites : null,
      travel: effectiveTravel,
      project_id: projectId,
    };
    if (analysis === 'coverage') {
      if (effectiveTravel === 'straight') body.radius_km = radiusKm;
      else body.minutes = minutes;
    }
    if (analysis === 'hotspots') {
      body.radius_km = hotspotKm;
      body.min_points = minPoints;
    }
    if (analysis === 'density' && resolution) body.resolution = resolution;
    if (analysis === 'regions') body.level = level;
    setRunning(true);
    setError(null);
    setSaved(null);
    try {
      setResult(await spatialService.analyze(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const res = await spatialService.save(result.result_id, saveName.trim() || t(`q_${analysis}`), projectId);
      if (res.data_source?.id) setSaved({ id: res.data_source.id, name: res.data_source.name });
      setSaveOpen(false);
      message.success(t('saved'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const unit = (u: unknown) => (u === 'minutes' ? t('unit_minutes') : t('unit_km'));

  const headline = useMemo(() => {
    if (!result) return null;
    const s = result.summary as Record<string, never>;
    switch (result.analysis) {
      case 'nearest':
        return t('headline_nearest', { median: num(s.median), p90: num(s.p90), unit: unit(s.unit), places: num(s.places, 0) });
      case 'coverage':
        return t('headline_coverage', { share: pct(s.covered_share), limit: num(s.limit), unit: unit(s.unit), outside: num(s.uncovered, 0) });
      case 'density':
        return t('headline_density', { share: pct(s.top_tenth_share), size: num(s.hexagon_km, 2) });
      case 'hotspots':
        return t('headline_hotspots', { count: Number(s.hotspots) || 0, share: pct(s.in_hotspots_share) });
      case 'regions': {
        const top = result.groups[0] as { area?: string; places?: number } | undefined;
        return t('headline_regions', { areas: num(s.areas_with_places, 0), total: num(s.areas, 0), top: top?.area ?? '—', count: num(top?.places, 0) });
      }
      default:
        return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, t]);

  const stats = useMemo(() => {
    if (!result) return [];
    const s = result.summary as Record<string, unknown>;
    const u = unit(s.unit);
    switch (result.analysis) {
      case 'nearest':
        return [
          { title: t('stat_places'), value: num(s.places, 0) },
          { title: t('stat_median', { unit: u }), value: num(s.median) },
          { title: t('stat_average', { unit: u }), value: num(s.average) },
          { title: t('stat_unreachable'), value: num(s.unreachable, 0) },
        ];
      case 'coverage':
        return [
          { title: t('stat_covered'), value: pct(s.covered_share) },
          { title: t('stat_outside'), value: num(s.uncovered, 0) },
          { title: t('stat_sites'), value: num(s.sites, 0) },
          ...(s.covered_total != null ? [{ title: t('stat_covered_total'), value: num(s.covered_total, 0) }] : []),
        ];
      case 'density':
        return [
          { title: t('stat_places'), value: num(s.places, 0) },
          { title: t('stat_hexagons'), value: num(s.hexagons, 0) },
          { title: t('stat_hex_size'), value: `${num(s.hexagon_km, 2)} ${t('unit_km')}` },
        ];
      case 'hotspots':
        return [
          { title: t('stat_hotspots'), value: num(s.hotspots, 0) },
          { title: t('stat_in_hotspots'), value: pct(s.in_hotspots_share) },
          { title: t('stat_places'), value: num(s.places, 0) },
        ];
      case 'regions':
        return [
          { title: t('stat_areas_used'), value: `${num(s.areas_with_places, 0)} / ${num(s.areas, 0)}` },
          { title: t('stat_outside_areas'), value: num(s.outside, 0) },
          { title: t('stat_country'), value: String(s.country ?? '—') },
        ];
      default:
        return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, t]);

  const groupColumns = useMemo(() => {
    const first = result?.groups[0];
    if (!first) return [];
    return Object.keys(first)
      .filter((k) => first[k] !== null && first[k] !== undefined)
      .map((k) => ({
        title: t.has(`col_${k}`) ? t(`col_${k}`) : k,
        dataIndex: k,
        key: k,
        render: (v: unknown) => (k.includes('share') ? pct(v) : typeof v === 'number' ? num(v, 2) : String(v ?? '—')),
        sorter: (a: Record<string, unknown>, b: Record<string, unknown>) =>
          typeof a[k] === 'number' ? (a[k] as number) - (b[k] as number) : String(a[k]).localeCompare(String(b[k])),
      }));
  }, [result, t]);

  const describe = useCallback(
    (p: Record<string, unknown>, kind: 'point' | 'site' | 'area') => {
      const lines = [String(p.label ?? '')];
      if (kind === 'area' && p.places != null) lines.push(t('popup_places', { count: Number(p.places) }));
      else if (kind === 'area' && p.value != null) lines.push(t('popup_places', { count: Number(p.value) }));
      if (kind === 'point' && typeof p.value === 'number') lines.push(`${num(p.value)} ${unit(result?.summary.unit)}`);
      if (kind === 'point' && typeof p.covered === 'boolean') lines.push(p.covered ? t('popup_covered') : t('popup_not_covered'));
      return lines.filter(Boolean).join('\n') || null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, t],
  );

  const travelOptions = [
    { value: 'straight', label: t('travel_straight') },
    { value: 'drive', label: t('travel_drive'), disabled: !routingReady },
    { value: 'walk', label: t('travel_walk'), disabled: !routingReady },
    { value: 'bike', label: t('travel_bike'), disabled: !routingReady },
  ];

  return (
    <DashboardPageShell maxWidth={1440}>
      <DashboardPageHeader icon={<EnvironmentOutlined />} title={t('title')} description={t('subtitle')} />
      <Row gutter={[16, 16]} className="spatial-page">
        <Col xs={24} lg={9} xl={8}>
          <Card size="small" className="spatial-panel">
            <Form layout="vertical" requiredMark={false}>
              <Text strong className="spatial-step">{t('step_question')}</Text>
              <Radio.Group
                className="spatial-questions"
                value={analysis}
                onChange={(e) => { setAnalysis(e.target.value); setResult(null); }}
              >
                {QUESTIONS.map((q) => (
                  <Radio.Button key={q.key} value={q.key} className="spatial-question">
                    <span className="spatial-question__icon" aria-hidden>{q.icon}</span>
                    <span>
                      <span className="spatial-question__title">{t(`q_${q.key}`)}</span>
                      <span className="spatial-question__desc">{t(`q_${q.key}_desc`)}</span>
                    </span>
                  </Radio.Button>
                ))}
              </Radio.Group>

              <Text strong className="spatial-step">{needsSites ? t('step_places_customers') : t('step_places')}</Text>
              <PointSetPicker value={points} onChange={onPoints} valueLabel={t('value_column')} />

              {needsSites ? (
                <>
                  <Text strong className="spatial-step">{t('step_sites')}</Text>
                  <PointSetPicker value={sites} onChange={onSites} valueLabel={null} />
                </>
              ) : null}

              <Text strong className="spatial-step">{t('step_options')}</Text>
              {usesTravel ? (
                <Form.Item label={t('travel_label')} extra={!routingReady ? t('routing_unavailable') : undefined}>
                  <Segmented value={effectiveTravel} options={travelOptions} onChange={(v) => setTravel(v as SpatialTravel)} />
                </Form.Item>
              ) : null}
              {analysis === 'coverage' && effectiveTravel === 'straight' ? (
                <Form.Item label={t('radius_label', { km: radiusKm })}>
                  <Slider min={0.5} max={50} step={0.5} value={radiusKm} onChange={setRadiusKm} />
                </Form.Item>
              ) : null}
              {analysis === 'coverage' && effectiveTravel !== 'straight' ? (
                <Form.Item label={t('minutes_label', { minutes })}>
                  <Slider min={5} max={60} step={5} value={minutes} onChange={setMinutes} />
                </Form.Item>
              ) : null}
              {analysis === 'hotspots' ? (
                <Space wrap>
                  <Form.Item label={t('hotspot_radius')}>
                    <InputNumber min={0.05} max={50} step={0.1} value={hotspotKm} onChange={(v) => setHotspotKm(Number(v) || 1)} addonAfter={t('unit_km')} />
                  </Form.Item>
                  <Form.Item label={t('hotspot_min')}>
                    <InputNumber min={2} max={1000} value={minPoints} onChange={(v) => setMinPoints(Number(v) || 10)} />
                  </Form.Item>
                </Space>
              ) : null}
              {analysis === 'density' ? (
                <Form.Item label={t('hex_size')}>
                  <Select value={resolution} options={HEX_SIZES.map((h) => ({ value: h.value, label: t(h.key) }))} onChange={setResolution} />
                </Form.Item>
              ) : null}
              {analysis === 'regions' ? (
                <Form.Item label={t('level_label')} extra={t('country_auto')}>
                  <Select value={level} options={LEVELS.map((l) => ({ value: l, label: t(`level_${l}`) }))} onChange={setLevel} />
                </Form.Item>
              ) : null}

              <Tooltip title={!ready ? t('run_needs') : undefined}>
                <Button type="primary" block size="large" icon={effectiveTravel === 'straight' ? <AimOutlined /> : <CarOutlined />} loading={running} disabled={!ready} onClick={() => void run()}>
                  {running ? (effectiveTravel === 'straight' ? t('running') : t('running_travel')) : t('run')}
                </Button>
              </Tooltip>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={15} xl={16}>
          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
          {!result ? (
            <Card size="small" className="spatial-empty">
              <BasemapMap ariaLabel={t('map_label')} failedText={t('map_failed')} dark={isDarkMode} height={420} />
              <Paragraph type="secondary" style={{ margin: '12px 4px 0' }}>{t('empty_hint')}</Paragraph>
            </Card>
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Card size="small">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Text className="spatial-headline">{headline}</Text>
                  <Row gutter={[16, 8]}>
                    {stats.map((s) => (
                      <Col key={s.title} xs={12} md={6}>
                        <Statistic title={s.title} value={s.value} />
                      </Col>
                    ))}
                  </Row>
                  <Space wrap>
                    <Button icon={<SaveOutlined />} onClick={() => { setSaveName(t(`q_${result.analysis}`)); setSaveOpen(true); }}>
                      {t('save')}
                    </Button>
                    {saved ? (
                      <Link href={`/data/sources/${saved.id}`}>{t('open_saved', { name: saved.name })}</Link>
                    ) : null}
                  </Space>
                </Space>
              </Card>
              <BasemapMap
                ariaLabel={t('map_label')}
                failedText={t('map_failed')}
                dark={isDarkMode}
                points={result.map.points}
                sites={result.map.sites}
                areas={result.map.areas}
                pointColor={result.analysis === 'coverage' ? 'covered' : result.analysis === 'density' || result.analysis === 'regions' ? 'single' : 'group'}
                describe={describe}
              />
              {result.notes.length || result.attribution || result.boundary_license ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {result.notes.map((n) => (n.key === 'dropped_rows' ? t('note_dropped', { count: n.count ?? 0 }) : null)).filter(Boolean).join(' ')}
                  {result.attribution ? ` ${result.attribution}.` : ''}
                  {result.boundary_license ? ` ${t('boundaries_license', { license: result.boundary_license })}` : ''}
                </Text>
              ) : null}
              <Card size="small" title={t(`groups_${result.analysis}`)}>
                <Table
                  size="small"
                  rowKey={(r) => JSON.stringify(r)}
                  dataSource={result.groups}
                  columns={groupColumns}
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  scroll={{ x: 'max-content' }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>{t('rows_note', { count: result.row_count })}</Text>
              </Card>
            </Space>
          )}
        </Col>
      </Row>
      <Modal
        open={saveOpen}
        title={t('save_title')}
        okText={t('save')}
        confirmLoading={saving}
        onOk={() => void save()}
        onCancel={() => setSaveOpen(false)}
        destroyOnHidden
      >
        <Paragraph type="secondary">{t('save_desc', { count: result?.row_count ?? 0 })}</Paragraph>
        <Input value={saveName} maxLength={120} onChange={(e) => setSaveName(e.target.value)} aria-label={t('save_name')} />
      </Modal>
    </DashboardPageShell>
  );
}
