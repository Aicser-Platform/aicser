import { readFileSync, writeFileSync } from 'node:fs';

const LOCALES = ['en', 'de', 'es', 'fr', 'id', 'ja', 'km', 'th', 'vi', 'zh'];
// DataSourcesTab.tsx keeps using this one for the lock-icon tooltip.
const KEEP_IN_SETTINGS = new Set(['data_source_access_manage']);
const MOVE = /^data_source_(access|rls)_/;

// New keys the detail page needs. English is the source of truth; other locales
// receive the English string as a placeholder, matching how the existing keys landed.
const NEW_KEYS = {
  tab_overview: 'Overview',
  tab_schema: 'Schema',
  tab_permissions: 'Permissions',
  tab_row_filters: 'Row filters',
  back_to_data: 'Back to data',
  not_found: 'This data source no longer exists.',
  share_placeholder: 'Add people, teams, or projects…',
  share_group_project: 'Projects',
  share_group_user: 'People',
  share_group_org_role: 'Org roles',
  share_group_project_role: 'Project roles',
  share_submit: 'Grant',
  row_access_label: 'Row access',
  row_access_choose: 'Choose row access',
  row_access_all_rows: 'All rows — row filtering not applied',
  row_access_not_applicable: 'Not applicable without query access',
  row_access_required: 'Choose row access before granting query permission.',
  bypass_banner: 'Row filtering is not being applied — {count} grant(s) allow all rows.',
  policy_used_by: 'Used by {count} grant(s)',
  policy_active: 'Active',
  policy_active_off_confirm:
    'Users restricted by this filter will see no rows. To remove filtering instead, set their grants to All rows.',
  policy_delete_confirm: 'Deleting this filter denies all rows to {count} grant(s) that use it.',
  policy_new: 'New policy',
  preview_unavailable: 'Preview unavailable',
  preview_masked: 'Literal values are masked because you are simulating another user.',
  preview_unresolved: 'Unresolved attribute: {path}',
  effect_filtered: 'Filtered',
  effect_deny_all: 'Denies all rows',
  effect_no_filter: 'No filter applied',
  grant_partial_failure: 'Could not grant access to: {names}',
  schema_unavailable: 'Schema unavailable — enter table and column names manually.',
  // Absent from the moved set; the policy modal needs it.
  data_source_rls_policy_description: 'Description',
};

const en = JSON.parse(readFileSync('src/messages/en.json', 'utf8'));
const moved = Object.keys(en.settings).filter((k) => MOVE.test(k) && !KEEP_IN_SETTINGS.has(k));
if (moved.length !== 91) throw new Error(`expected 91 keys to move, found ${moved.length}`);

for (const locale of LOCALES) {
  const path = `src/messages/${locale}.json`;
  const messages = JSON.parse(readFileSync(path, 'utf8'));
  const detail = { ...(messages.data_source_detail ?? {}) };

  for (const key of moved) {
    if (key in messages.settings) {
      detail[key] = messages.settings[key];
      delete messages.settings[key];
    } else {
      detail[key] = en.settings[key]; // locale was missing it; fall back to English
    }
  }
  for (const [key, value] of Object.entries(NEW_KEYS)) {
    if (!(key in detail)) detail[key] = value;
  }

  messages.data_source_detail = detail;
  writeFileSync(path, `${JSON.stringify(messages, null, 2)}\n`);
  console.log(`${locale}: ${Object.keys(detail).length} keys in data_source_detail`);
}
