import { describe, expect, it } from 'vitest';
import { buildSharedChartPropsForType, resolveSharedChartProps } from './echartsToSharedWidget';

describe('buildSharedChartPropsForType scatter', () => {
  const rows = [
    { Month: '2024-01-01', Total_Payments: 63456.78, Total_Loans_Disbursed: 12 },
    { Month: '2024-02-01', Total_Payments: 70123.45, Total_Loans_Disbursed: 10 },
    { Month: '2024-03-01', Total_Payments: 55200.1, Total_Loans_Disbursed: 9 },
  ];

  it('uses two numeric columns for scatter axes', () => {
    const props = buildSharedChartPropsForType(rows, 'scatter');
    expect(props?.chartType).toBe('scatter');
    expect(props?.chartData.series?.[0]?.data).toEqual([
      [63456.78, 12],
      [70123.45, 10],
      [55200.1, 9],
    ]);
    expect(props?.chartData.x).toEqual(['2024-01-01', '2024-02-01', '2024-03-01']);
  });
});

describe('resolveSharedChartProps forecast', () => {
  it('does not flatten Historical/Forecast nulls into the area renderer', () => {
    const cfg = {
      series: [
        { name: 'Historical', type: 'line', data: [100, 110, 120, null, null] },
        { name: 'Forecast', type: 'line', data: [null, null, 120, 130, 140] },
        { name: 'Lower Bound', type: 'line', stack: 'confidence-band', data: [null, null, 0, 110, 115] },
      ],
      xAxis: { type: 'category', data: ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03'] },
    };
    expect(resolveSharedChartProps(cfg, [])).toBeNull();
  });
});
