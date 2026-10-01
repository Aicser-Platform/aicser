import { newCellId, type NotebookCell } from '@/services/notebookService';

type Translate = (key: string) => string;

/** Starting points that teach the notebook by doing: each cell says what it's for. */
export function templateCells(key: 'blank' | 'explore' | 'python', t: Translate): NotebookCell[] {
  if (key === 'explore') {
    return [
      { id: newCellId(), type: 'markdown', source: t('tpl_explore_intro') },
      { id: newCellId(), type: 'sql', name: 'q1', source: 'SELECT *\nFROM data\nLIMIT 100' },
      { id: newCellId(), type: 'markdown', source: t('tpl_explore_chart') },
      { id: newCellId(), type: 'chart', source: '', chart: { from: 'q1', type: 'bar', y: [] } },
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
