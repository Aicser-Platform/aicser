export const exportCSV = (data: any, filename: string, widget?: any) => {
  try {
    if (!data) throw new Error('No data provided for export');

    const sanitizeFilename = (name: string) =>
      (name || 'chart')
        .trim()
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase();

    const xColumnName = widget?.chartQuery?.x || 'category';
    const yMetrics = widget?.chartQuery?.yMetrics || [];
    const yMetricsSecondary = widget?.chartQuery?.yMetricsSecondary || [];
    const allYMetrics = [...yMetrics, ...yMetricsSecondary];

    let rows: any[] = [];

    /* -------------------- Normalize data -------------------- */

    // 1. Already tabular
    if (Array.isArray(data)) {
      rows = data;
    }

    // 2. ECharts-style series data
    else if (data.series && Array.isArray(data.series)) {
      const categories = data.categories || data.xAxis?.data || data.x || [];

      rows = categories.map((category: any, index: number) => {
        const row: any = {};
        row[xColumnName] = category;

        data.series.forEach((series: any, seriesIndex: number) => {
          const columnName = series.name || allYMetrics[seriesIndex]?.field || `Series ${seriesIndex + 1}`;

          row[columnName] = series.data?.[index] ?? 0;
        });

        // Secondary series support
        const secondarySeries = data.secondarySeries || data.secondSeries || [];

        secondarySeries.forEach((series: any, sIndex: number) => {
          const columnName = series.name || yMetricsSecondary[sIndex]?.field || `Secondary ${sIndex + 1}`;

          row[columnName] = series.data?.[index] ?? row[columnName];
        });

        return row;
      });
    }

    // 3. x / y structure
    else if (Array.isArray(data.x) && Array.isArray(data.y)) {
      const yColumnName = allYMetrics[0]?.field || 'value';

      rows = data.x.map((xValue: any, index: number) => ({
        [xColumnName]: xValue,
        [yColumnName]: data.y[index] ?? 0,
      }));

      // y2 support
      if (Array.isArray(data.y2)) {
        const secondaryColumn = yMetricsSecondary[0]?.field || 'secondary_value';

        data.y2.forEach((value: any, index: number) => {
          if (rows[index]) rows[index][secondaryColumn] = value;
        });
      }
    }

    // 4. Fallback object
    else if (typeof data === 'object') {
      rows = [data];
    } else {
      throw new Error('Unsupported data format');
    }

    if (!rows.length) throw new Error('No rows to export');

    /* -------------------- Build CSV -------------------- */

    const headers = Object.keys(rows[0]);
    if (!headers.length) throw new Error('No columns found');

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((field) => {
            const value = String(row[field] ?? '');
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(',')
      ),
    ].join('\n');

    /* -------------------- Download -------------------- */

    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${sanitizeFilename(filename)}.csv`;
    link.click();
  } catch (error) {
    throw new Error(`Failed to export CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};
