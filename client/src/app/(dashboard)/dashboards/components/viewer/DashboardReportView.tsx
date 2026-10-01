'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardWidgetCell } from '../DashboardWidgetCell';
import { WidgetFootnote } from '../WidgetFootnote';
import { chartDescription, chartSource } from '../../utils/chartAnnotations';
import { displayTitle } from '../../utils/widgetAutoTitle';
import type { LayoutItem, RuntimeFilter, WidgetInstance } from '../../stores/useDashboardStore';
import type { DashboardViewerMeta } from './DashboardViewerShell';
import './DashboardReportView.css';

/**
 * A dashboard as a paginated document (PDF export → "Report"): a cover with the title, date and
 * filters, the KPIs together, then one chart per page with its title, description and source —
 * the way finance and operations packs are read and printed. The column is A4 width on screen too,
 * so charts are drawn at their printed size (nothing is squeezed or clipped by the print box).
 */

const SKIP = new Set(['slicer', 'filter', 'embed']);
const KPI = new Set(['stat', 'gauge']);

type Section =
  | { kind: 'heading'; id: string; text: string }
  | { kind: 'kpis'; id: string; widgets: WidgetInstance[] }
  | { kind: 'widget'; id: string; widget: WidgetInstance };

function readingOrder(widgets: WidgetInstance[], layout: LayoutItem[]): WidgetInstance[] {
  const pos = new Map(layout.map((l) => [l.i, l]));
  return widgets
    .slice()
    .sort((a, b) => {
      const la = pos.get(a.id);
      const lb = pos.get(b.id);
      return (la?.y ?? 0) - (lb?.y ?? 0) || (la?.x ?? 0) - (lb?.x ?? 0);
    });
}

export function DashboardReportView({
  meta,
  widgets,
  layout,
  runtimeFilters,
  dashboardId,
}: {
  meta: DashboardViewerMeta;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  runtimeFilters: RuntimeFilter[];
  dashboardId: string;
}) {
  const t = useTranslations('dashboard_report');
  const tPage = useTranslations('dashboards_page');

  const sections = useMemo<Section[]>(() => {
    // The headline numbers first, together (a report pack's summary page), then the charts in
    // the dashboard's reading order with its section headings.
    const ordered = readingOrder(widgets, layout).filter((w) => !SKIP.has(String(w.chartType)));
    const kpis = ordered.filter((w) => KPI.has(String(w.chartType)));
    const out: Section[] = kpis.length ? [{ kind: 'kpis', id: 'kpis', widgets: kpis }] : [];
    for (const w of ordered) {
      const type = String(w.chartType);
      if (KPI.has(type)) continue;
      if (type === 'divider') {
        const text = String((w.chartOptions as { sectionTitle?: string })?.sectionTitle || w.title || '').trim();
        if (text) out.push({ kind: 'heading', id: w.id, text });
        continue;
      }
      out.push({ kind: 'widget', id: w.id, widget: w });
    }
    return out;
  }, [widgets, layout]);

  // Ready once every data widget has its result (or a settled error): the PDF renderer waits for this.
  const dataReady = widgets
    .filter((w) => !SKIP.has(String(w.chartType)) && !['divider', 'text', 'image'].includes(String(w.chartType)))
    .every((w) => !w.isLoading && (w.chartData != null || w.error != null));
  // Data in hand isn't the same as drawn: maps fetch their boundaries and charts animate in.
  // Give them a moment to settle before telling the PDF renderer to print.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!dataReady) {
      setReady(false);
      return;
    }
    const timer = setTimeout(() => setReady(true), widgets.some((w) => w.chartType === 'geo') ? 4000 : 1500);
    return () => clearTimeout(timer);
  }, [dataReady, widgets]);

  const filters = runtimeFilters.filter((f) => f && f.field && f.value !== undefined && f.value !== null && f.value !== '');
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const card = (w: WidgetInstance, tall: boolean) => (
    <figure className={`report-figure${tall ? ' report-figure-tall' : ''}`} key={w.id}>
      <figcaption>
        <h3>{displayTitle(w, tPage as never)}</h3>
        {chartDescription(w.chartOptions as never) ? <p className="report-desc">{chartDescription(w.chartOptions as never)}</p> : null}
      </figcaption>
      <div className="report-chart">
        <DashboardWidgetCell widget={w} dashboardId={dashboardId} runtimeFilters={runtimeFilters} readOnly hideInteractionHint />
      </div>
      <WidgetFootnote note={chartSource(w.chartOptions as never)} />
    </figure>
  );

  return (
    <div className="dashboard-report" data-report-ready={ready ? 'true' : 'false'}>
      <section className="report-cover report-page">
        <p className="report-kicker">{t('kicker')}</p>
        <h1>{meta.title}</h1>
        {meta.description ? <p className="report-lede">{meta.description}</p> : null}
        <dl className="report-facts">
          <div>
            <dt>{t('prepared')}</dt>
            <dd>{today}</dd>
          </div>
          <div>
            <dt>{t('filters')}</dt>
            <dd>
              {filters.length
                ? filters.map((f) => `${f.field} ${f.operator || '='} ${Array.isArray(f.value) ? f.value.join(', ') : String(f.value)}`).join(' · ')
                : t('no_filters')}
            </dd>
          </div>
        </dl>
      </section>
      {sections.map((s) =>
        s.kind === 'heading' ? (
          <h2 key={s.id} className="report-heading">{s.text}</h2>
        ) : s.kind === 'kpis' ? (
          <section key={s.id} className="report-kpis">
            {s.widgets.map((w) => card(w, false))}
          </section>
        ) : (
          <section key={s.id} className="report-page report-chart-page">
            {card(s.widget, true)}
          </section>
        ),
      )}
    </div>
  );
}
