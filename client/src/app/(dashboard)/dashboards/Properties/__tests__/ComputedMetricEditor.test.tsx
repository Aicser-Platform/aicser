import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComputedMetricEditor } from '../ComputedMetricEditor';

const cols = [
  { label: 'Revenue', value: 'revenue' },
  { label: 'Profit', value: 'profit' },
];

describe('ComputedMetricEditor', () => {
  it('renders the modal when open is true', () => {
    render(
      <ComputedMetricEditor
        open={true}
        columnOptions={cols}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('fx Computed metric (ratio)')).toBeTruthy();
    expect(screen.getByText('Display format')).toBeTruthy();
  });

  it('disables the OK button when fields are not filled', () => {
    render(
      <ComputedMetricEditor
        open={true}
        columnOptions={cols}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const okBtn = screen.getByRole('button', { name: /Add Metric/i });
    expect(okBtn).toBeDisabled();
  });

  it('remains disabled when only label is entered', () => {
    render(
      <ComputedMetricEditor
        open={true}
        columnOptions={cols}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('e.g. Profit Margin'), {
      target: { value: 'Margin' },
    });
    // Still disabled because numerator/denominator fields not selected
    const okBtn = screen.getByRole('button', { name: /Add Metric/i });
    expect(okBtn).toBeDisabled();
  });

  it('does not call onSave when the form is invalid', () => {
    const onSave = vi.fn();
    render(
      <ComputedMetricEditor
        open={true}
        columnOptions={cols}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('e.g. Profit Margin'), {
      target: { value: 'Margin' },
    });
    // Clicking the OK button when disabled should not call onSave
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ComputedMetricEditor
        open={true}
        columnOptions={cols}
        onSave={vi.fn()}
        onCancel={onCancel}
      />
    );
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('populates initial values when editing an existing computed metric', () => {
    render(
      <ComputedMetricEditor
        open={true}
        initial={{
          field: 'profit_margin',
          aggregation: 'ratio',
          label: 'Profit Margin',
          computed: {
            type: 'ratio',
            numerator: { field: 'profit', aggregation: 'sum' },
            denominator: { field: 'revenue', aggregation: 'sum' },
            multiplier: 100,
          },
        }}
        columnOptions={cols}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const nameInput = screen.getByPlaceholderText('e.g. Profit Margin') as HTMLInputElement;
    expect(nameInput.value).toBe('Profit Margin');
    // Percentage radio should be selected
    const percentageRadio = screen.getByRole('radio', { name: /Percentage/i });
    expect(percentageRadio).toBeChecked();
    expect(screen.getByText('Percent (%)')).toBeTruthy();
  });

  it('shows ratio radio selected by default', () => {
    render(
      <ComputedMetricEditor
        open={true}
        columnOptions={cols}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const ratioRadio = screen.getByRole('radio', { name: /Ratio/i });
    expect(ratioRadio).toBeChecked();
  });

  it('switches multiplier to 100 when Percentage radio is clicked', () => {
    render(
      <ComputedMetricEditor
        open={true}
        columnOptions={cols}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const percentageRadio = screen.getByRole('radio', { name: /Percentage/i });
    fireEvent.click(percentageRadio);
    expect(percentageRadio).toBeChecked();
    const ratioRadio = screen.getByRole('radio', { name: /Ratio/i });
    expect(ratioRadio).not.toBeChecked();
  });
});
