import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import { CleanPanel } from '../CleanPanel';
import type { CleaningLog, Finding } from '@/api/prep';

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">{ui}</NextIntlClientProvider>);

const fix: Finding = {
  code: 'whitespace', severity: 'info', column: 'name', message_key: 'prepare.finding.whitespace',
  params: { column: 'name', count: 2 }, suggested_step: { replace: { columns: ['name'] } },
};
const outliers: Finding = {
  code: 'outliers', severity: 'warning', column: 'amount', message_key: 'prepare.finding.outliers',
  params: { column: 'amount', count: 1, low: -5, high: 30, examples: ['9000'] },
};

function panel(props: Partial<React.ComponentProps<typeof CleanPanel>> = {}) {
  return (
    <CleanPanel
      name="orders"
      table="orders"
      rowCount={8}
      columns={[{ name: 'amount', type: 'DOUBLE' }, { name: 'name', type: 'VARCHAR' }]}
      dists={{ amount: { rows: 8, empty: 0, distinct: 8, kind: 'number', min: 9, max: 9000 } }}
      findings={[fix, outliers]}
      loading={false}
      readOnly={false}
      stepSentences={['Trim name']}
      findingText={(f) => `${f.code} in ${f.column}`}
      augment={[{ key: 'split', label: 'Split column', needsColumn: true, onClick: vi.fn() }]}
      hasSelection={false}
      onApply={vi.fn()}
      onApplyAll={vi.fn()}
      onSelectColumn={vi.fn()}
      onExclude={vi.fn()}
      {...props}
    />
  );
}

const stage = (letter: string) => fireEvent.click(screen.getByText(letter, { selector: '.clean-panel__letter' }));

describe('CleanPanel', () => {
  it('describes the data first: rows, columns and each column’s shape', () => {
    render(panel());
    expect(screen.getByText('8 rows · 2 columns')).toBeTruthy();
    expect(screen.getByText(/100% filled · all unique · 9 to 9,000/)).toBeTruthy();
  });

  it('splits fixable issues (Locate) from ones a person decides (Evaluate)', () => {
    const onApply = vi.fn();
    render(panel({ onApply }));
    stage('L');
    expect(screen.queryByText('outliers in amount')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(fix.suggested_step);

    stage('E');
    expect(screen.getByText('outliers in amount')).toBeTruthy();
    expect(screen.getByText('e.g. 9000')).toBeTruthy();
  });

  it('records a decision with its reason, and the report lists it', async () => {
    let saved: CleaningLog = {};
    const onCleaningChange = vi.fn(async (log: CleaningLog) => { saved = log; });
    const { rerender } = render(panel({ onCleaningChange }));
    stage('E');
    fireEvent.change(screen.getByPlaceholderText('Why? (optional)'), { target: { value: 'Bulk order, real' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(onCleaningChange).toHaveBeenCalled());
    expect(saved.decisions).toEqual({ 'outliers:amount': { action: 'keep', reason: 'Bulk order, real' } });

    rerender(<NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">{panel({ onCleaningChange, cleaning: saved })}</NextIntlClientProvider>);
    stage('N');
    const report = document.querySelector('.clean-panel__report')!.textContent!;
    expect(report).toContain('1. Trim name');
    expect(report).toContain('- outliers in amount: **Kept** (Bulk order, real)');
  });

  it('asks for a selected column before column-only enrichments', () => {
    render(panel());
    stage('A');
    expect((screen.getByRole('button', { name: 'Split column' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
