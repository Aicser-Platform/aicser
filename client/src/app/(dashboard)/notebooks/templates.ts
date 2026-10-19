import { newCellId, type NotebookCell } from '@/services/notebookService';

type Translate = (key: string) => string;

/** Starting points that teach the notebook by doing: each cell says what it's for. */
export function templateCells(key: 'blank' | 'explore' | 'python' | 'features', t: Translate): NotebookCell[] {
  if (key === 'explore') {
    return [
      { id: newCellId(), type: 'markdown', source: t('tpl_explore_intro') },
      { id: newCellId(), type: 'sql', name: 'q1', source: 'SELECT *\nFROM data\nLIMIT 100' },
      { id: newCellId(), type: 'markdown', source: t('tpl_explore_chart') },
      { id: newCellId(), type: 'chart', source: '', chart: { from: 'q1', type: 'bar', y: [] } },
    ];
  }
  if (key === 'features') {
    return [
      { id: newCellId(), type: 'markdown', source: t('tpl_features_intro') },
      {
        id: newCellId(),
        type: 'sql',
        name: 'features_sql',
        source: [
          '-- Build training features (adjust schema/table). Publish to gold via Pipelines or Save as dataset.',
          'SELECT',
          '  customer_id,',
          '  order_count_90d,',
          '  avg_order_value,',
          '  days_since_last_order,',
          '  will_churn  -- target for classification',
          'FROM analytics.customer_features',
          'LIMIT 5000',
        ].join('\n'),
      },
      {
        id: newCellId(),
        type: 'python',
        source: [
          '# Optional: pandas feature engineering on the SQL result',
          'features = features_sql.copy()',
          'features["order_count_90d"] = features["order_count_90d"].fillna(0)',
          'features.head()',
        ].join('\n'),
      },
      { id: newCellId(), type: 'markdown', source: t('tpl_features_gold') },
      {
        id: newCellId(),
        type: 'python',
        source: [
          '# Inspect columns the Models wizard would use (Enterprise)',
          'inspection = aicser.inspect(',
          '    table="analytics.customer_features",',
          '    target="will_churn",',
          '    source="YOUR_DATA_SOURCE",',
          ')',
          'inspection',
        ].join('\n'),
      },
      {
        id: newCellId(),
        type: 'python',
        source: [
          'cols = [f["name"] for f in inspection["features"] if f["kind"] in ("numeric", "category")][:25]',
          'model = aicser.create_model(',
          '    name="Churn from features",',
          '    table="analytics.customer_features",',
          '    target="will_churn",',
          '    features=cols,',
          '    source="YOUR_DATA_SOURCE",',
          ')',
          'model',
        ].join('\n'),
      },
      { id: newCellId(), type: 'markdown', source: t('tpl_features_train') },
    ];
  }
  if (key === 'python') {
    return [
      { id: newCellId(), type: 'markdown', source: t('tpl_python_intro') },
      { id: newCellId(), type: 'sql', name: 'q1', source: 'SELECT *\nFROM data\nLIMIT 1000' },
      {
        id: newCellId(),
        type: 'python',
        source: [
          '# q1 is a pandas DataFrame with the result of the query above.',
          'clean = q1.dropna().drop_duplicates()',
          'print(f"{len(q1) - len(clean)} rows removed")',
          'clean.describe()',
        ].join('\n'),
      },
      { id: newCellId(), type: 'markdown', source: t('tpl_python_save') },
    ];
  }
  return [{ id: newCellId(), type: 'markdown', source: '' }];
}
