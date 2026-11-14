// A finished analysis report in the shape the Docs and Slides converters read (reportDocument.ts,
// reportSlides.ts, ported from the desktop app). The web report page fills it from its own report data: section
// charts arrive as ready ECharts options (light theme), KPIs already resolved.

type Payload = Record<string, unknown>;

export interface ReportKpi {
  label: string;
  value: string;
}

export interface ReportSection {
  id: string;
  title: string;
  /** kpi, timeseries, breakdown, comparison, ranking, diagnostic, predictive… */
  type: string;
  status: 'pending' | 'complete' | 'empty' | 'failed';
  narrative: string;
  keyMetric: string;
  keyMetricValue: string;
  /** ECharts option to draw (null: KPI sections and sections without a chart). */
  chart: Payload | null;
  kpis: ReportKpi[];
}

export interface ReportRecommendation {
  title: string;
  action: string;
  rationale: string;
  priority: string;
}

export interface Report {
  title: string;
  /** brief / standard / comprehensive. */
  tier: string;
  tierLabel: string;
  industry: string;
  preparedFor: string;
  organization: string;
  summary: string;
  sections: ReportSection[];
  recommendations: ReportRecommendation[];
  followUps: string[];
}

/** Sections worth showing: finished ones, and empty ones with their note (failed and pending are left out). */
export const shownSections = (report: Report): ReportSection[] =>
  report.sections.filter((s) => s.status === 'complete' || (s.status === 'empty' && s.narrative));
