/** Convert normalized row array to Excel (.xls XML) and trigger browser download. */
export const exportExcel = (data: any, filename: string, widget?: any) => {
  try {
    const rows = normalizeToRows(data, widget);
    if (!rows.length) throw new Error('No rows to export');

    const headers = Object.keys(rows[0]);

    const escapeXml = (v: unknown): string =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const isNumeric = (v: unknown) =>
      v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

    // Header row (bold via StyleID="Bold")
    const headerRow =
      '<Row>' +
      headers
        .map(
          (h) =>
            `<Cell ss:StyleID="Bold"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`,
        )
        .join('') +
      '</Row>';

    // Data rows
    const dataRows = rows
      .map((row: Record<string, unknown>) => {
        const cells = headers.map((h) => {
          const v = row[h];
          const type = isNumeric(v) ? 'Number' : 'String';
          return `<Cell><Data ss:Type="${type}">${escapeXml(v)}</Data></Cell>`;
        });
        return '<Row>' + cells.join('') + '</Row>';
      })
      .join('');

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      ' <Styles>',
      '  <Style ss:ID="Bold"><Font ss:Bold="1"/></Style>',
      ' </Styles>',
      ' <Worksheet ss:Name="Data">',
      '  <Table>',
      '   ' + headerRow,
      '   ' + dataRows,
      '  </Table>',
      ' </Worksheet>',
      '</Workbook>',
    ].join('\n');

    const blob = new Blob([xml], {
      type: 'application/vnd.ms-excel;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(filename)}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke after 10 s to free memory
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    throw new Error(
      `Failed to export Excel: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
};

const sanitizeFilename = (name: string) =>
  (name || 'chart')
    .trim()
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();

export function normalizeToRows(data: any, widget?: any): any[] {
  const xColumnName = widget?.chartQuery?.x || 'category';
  const yMetrics = widget?.chartQuery?.yMetrics || [];
  const yMetricsSecondary = widget?.chartQuery?.yMetricsSecondary || [];
  const allYMetrics = [...yMetrics, ...yMetricsSecondary];

  if (Array.isArray(data)) return data;

  if (data?.series && Array.isArray(data.series)) {
    const categories = data.categories || data.xAxis?.data || data.x || [];
    return categories.map((category: any, index: number) => {
      const row: any = { [xColumnName]: category };
      data.series.forEach((series: any, si: number) => {
        const col = series.name || allYMetrics[si]?.field || `Series ${si + 1}`;
        row[col] = series.data?.[index] ?? 0;
      });
      (data.secondarySeries || []).forEach((series: any, si: number) => {
        const col = series.name || yMetricsSecondary[si]?.field || `Secondary ${si + 1}`;
        row[col] = series.data?.[index] ?? row[col];
      });
      return row;
    });
  }

  if (Array.isArray(data?.x) && Array.isArray(data?.y)) {
    const yCol = allYMetrics[0]?.field || 'value';
    const rows = data.x.map((xv: any, i: number) => ({
      [xColumnName]: xv,
      [yCol]: data.y[i] ?? 0,
    }));
    if (Array.isArray(data.y2)) {
      const sec = yMetricsSecondary[0]?.field || 'secondary_value';
      data.y2.forEach((v: any, i: number) => {
        if (rows[i]) rows[i][sec] = v;
      });
    }
    return rows;
  }

  if (typeof data === 'object' && data !== null) return [data];
  return [];
}

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
          const columnName =
            series.name || allYMetrics[seriesIndex]?.field || `Series ${seriesIndex + 1}`;
          row[columnName] = series.data?.[index] ?? 0;
        });

        // Secondary series support
        const secondarySeries = data.secondarySeries || data.secondSeries || [];
        secondarySeries.forEach((series: any, sIndex: number) => {
          const columnName =
            series.name || yMetricsSecondary[sIndex]?.field || `Secondary ${sIndex + 1}`;
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
          .join(','),
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
    throw new Error(
      `Failed to export CSV: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
};
