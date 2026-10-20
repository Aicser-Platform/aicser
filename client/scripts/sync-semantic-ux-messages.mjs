/**
 * Copies new semantic / access UX strings from en.json into other locales (English placeholders).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'src', 'messages');
const LOCALES = ['de', 'es', 'fr', 'id', 'ja', 'km', 'th', 'vi', 'zh'];

const PATCHES = {
  data_source_detail: {
    tab_access: 'Access',
    access_sub_sharing: 'Sharing & permissions',
  },
  semantic_layer_hub: {
    intro_copy:
      'Open a source to define metrics, dimensions, and how tables connect. Ask and dashboards use these names—not raw column names.',
    continue_setup: 'Continue setup',
    readiness_needs_relationships: 'Connect tables',
    readiness_needs_metrics: 'Add metrics',
    readiness_needs_certification: 'Review & certify',
    readiness_ready: 'Ready for Ask',
    subtitle: 'Business metrics and table relationships for each data source.',
    subtitle_project: 'Sources in {project} — switch project in the header to work on another workspace.',
  },
  semantic_studio: {
    coach_needs_relationships: 'Connect your tables so metrics can join across them.',
    coach_needs_metrics: 'Generate or add metrics — Ask and dashboards use these names.',
    coach_needs_certification: 'Review draft metrics and mark the ones that are official.',
    mark_official: 'Mark official ({count})',
    nav_joins_optional: 'Not needed for one sheet',
    metrics_joins_warning_slim: 'This source has multiple tables — connect them in Relationships before metrics will line up.',
    nav_tables: 'Tables & preview',
    nav_workflow: 'Build your model',
    nav_model: 'Relationships',
    nav_definitions: 'Metrics',
    nav_time: 'Time',
    nav_preview: 'Preview',
    nav_advanced: 'Advanced',
    open_data_source: 'Data source',
    open_full_workbench: 'Open full workbench',
    ee_only: 'Semantic layer workbench is available on Aicser Enterprise.',
  },
  sheets: {
    formula_target_cell: 'Selected cell: {cell}',
    chart_select_first: 'Select cells on the sheet first, then open Chart from Analyze.',
  },
  data_page: {
    dedupe_file_sources_banner:
      '{count, plural, one {# duplicate sheet file in this project} other {# duplicate sheet files in this project}}',
    dedupe_file_sources_action: 'Merge duplicates',
    dedupe_file_sources_ok:
      'Merged {count, plural, one {# duplicate} other {# duplicates}}. Kept the newest linked copy of each sheet.',
    dedupe_file_sources_none: 'No duplicate sheet files to merge.',
  },
};

function mergeSection(locale, section, keys) {
  const path = join(ROOT, `${locale}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data[section]) data[section] = {};
  Object.assign(data[section], keys);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

for (const locale of LOCALES) {
  for (const [section, keys] of Object.entries(PATCHES)) {
    mergeSection(locale, section, keys);
  }
  console.log(`patched ${locale}.json`);
}
