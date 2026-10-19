import { describe, expect, it } from 'vitest';
import { buildChartOptions } from '@/app/(dashboard)/dashboards/widgets/ChartOptionsBuilder';
import { buildSharedChartPropsForType, resolveSharedChartProps } from './echartsToSharedWidget';

// What the AI chart builder sends for "top branches by revenue": ranked high → low, then listed
// bottom-up because ECharts draws category 0 at the bottom (so North shows at the top).
const aiHorizontal = {
  aiserChartType: 'bar',
  aiserChartOptions: { barChartType: 'horizontal' },
  yAxis: { type: 'category', data: ['West', 'South', 'North'] },
  xAxis: { type: 'value' },
  series: [{ type: 'bar', data: [10, 20, 30] }],
};
const rows = [
  { branch: 'North', revenue: 30 },
  { branch: 'South', revenue: 20 },
  { branch: 'West', revenue: 10 },
];

const drawnCategories = (props: ReturnType<typeof resolveSharedChartProps>) => {
  const opts = buildChartOptions(props!.chartType, props!.chartData, props!.chartOptions);
  const y = Array.isArray(opts.yAxis) ? opts.yAxis[0] : opts.yAxis;
  return y.data as string[];
};

describe('horizontal bars in Ask AI', () => {
  it('reads the chart in row order, first row first', () => {
    const props = resolveSharedChartProps(aiHorizontal, null);
    expect(props?.chartData.x).toEqual(['North', 'South', 'West']);
    expect(props?.chartData.series?.[0]?.data).toEqual([30, 20, 10]);
  });

  it('draws the same way as the AI meant it and as a dashboard draws the rows', () => {
    const fromChat = drawnCategories(resolveSharedChartProps(aiHorizontal, null));
    const fromRows = drawnCategories(buildSharedChartPropsForType(rows, 'bar') && {
      ...buildSharedChartPropsForType(rows, 'bar')!,
      chartOptions: { barChartType: 'horizontal' },
    });
    expect(fromChat).toEqual(['West', 'South', 'North']); // North (highest) at the top
    expect(fromChat).toEqual(fromRows);
  });

  it('leaves an option that already lists categories top-down alone', () => {
    const topDown = { ...aiHorizontal, yAxis: { type: 'category', inverse: true, data: ['North', 'South', 'West'] }, series: [{ type: 'bar', data: [30, 20, 10] }] };
    expect(resolveSharedChartProps(topDown, null)?.chartData.x).toEqual(['North', 'South', 'West']);
  });
});
