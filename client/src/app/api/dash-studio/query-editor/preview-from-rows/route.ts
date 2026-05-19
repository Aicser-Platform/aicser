import { NextRequest, NextResponse } from 'next/server';

/**
 * API endpoint to preview chart from query result rows
 * POST /api/dash-studio/query-editor/preview-from-rows
 * 
 * Body: {
 *   rows: any[], // Query result rows
 *   chartType?: string, // Optional chart type
 *   config?: any // Optional chart configuration
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rows, chartType, config } = body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No rows provided or rows is not an array' },
        { status: 400 }
      );
    }

    // Analyze data structure
    const firstRow = rows[0];
    const columns = Object.keys(firstRow);
    
    if (columns.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No columns found in data' },
        { status: 400 }
      );
    }

    // Detect column types
    const numericColumns: string[] = [];
    const textColumns: string[] = [];
    const dateColumns: string[] = [];

    columns.forEach(col => {
      const sampleValue = firstRow[col];
      if (sampleValue === null || sampleValue === undefined) {
        return;
      }
      
      if (typeof sampleValue === 'number') {
        numericColumns.push(col);
      } else if (typeof sampleValue === 'string') {
        const numValue = Number(sampleValue);
        if (!isNaN(numValue) && sampleValue.trim() !== '') {
          numericColumns.push(col);
        } else {
          const dateValue = new Date(sampleValue);
          if (!isNaN(dateValue.getTime()) && sampleValue.length > 5) {
            dateColumns.push(col);
          } else {
            textColumns.push(col);
          }
        }
      } else if (sampleValue instanceof Date) {
        dateColumns.push(col);
      }
    });

    // Determine best columns for chart
    const xColumn = config?.xAxisField || textColumns[0] || dateColumns[0] || columns[0];
    const yColumn = config?.yAxisField || numericColumns[0] || columns.find(c => !textColumns.includes(c) && !dateColumns.includes(c)) || columns[1] || columns[0];

    // Generate chart data based on chart type
    const normalizedChartType = (chartType || 'bar').toLowerCase().replace(/\s+/g, ' ').trim();
    let chartData: any = {};
    let chartConfig: any = {};

    switch (normalizedChartType) {
      case 'bar chart':
      case 'column chart':
      case 'bar':
      case 'column':
        chartData = {
          xAxis: rows.map(row => String(row[xColumn] || '')),
          yAxis: rows.map(row => {
            const val = row[yColumn];
            return typeof val === 'number' ? val : (Number(val) || 0);
          })
        };
        chartConfig = {
          chartType: 'bar',
          title: { text: `${xColumn} vs ${yColumn}` },
          xAxisField: xColumn,
          yAxisField: yColumn
        };
        break;

      case 'line chart':
      case 'line':
        chartData = {
          xAxis: rows.map(row => String(row[xColumn] || '')),
          yAxis: rows.map(row => {
            const val = row[yColumn];
            return typeof val === 'number' ? val : (Number(val) || 0);
          })
        };
        chartConfig = {
          chartType: 'line',
          title: { text: `${xColumn} Trend` },
          xAxisField: xColumn,
          yAxisField: yColumn
        };
        break;

      case 'pie chart':
      case 'pie':
        chartData = {
          series: rows
            .filter(row => {
              const val = row[yColumn];
              return val !== null && val !== undefined && (typeof val === 'number' || !isNaN(Number(val)));
            })
            .map(row => ({
              name: String(row[xColumn] || 'Unknown'),
              value: typeof row[yColumn] === 'number' ? row[yColumn] : (Number(row[yColumn]) || 0)
            }))
        };
        chartConfig = {
          chartType: 'pie',
          title: { text: `${xColumn} Distribution` },
          xAxisField: xColumn,
          yAxisField: yColumn
        };
        break;

      default:
        // Fallback to bar chart
        chartData = {
          xAxis: rows.map(row => String(row[xColumn] || '')),
          yAxis: rows.map(row => {
            const val = row[yColumn];
            return typeof val === 'number' ? val : (Number(val) || 0);
          })
        };
        chartConfig = {
          chartType: 'bar',
          title: { text: `${xColumn} vs ${yColumn}` },
          xAxisField: xColumn,
          yAxisField: yColumn
        };
    }

    return NextResponse.json({
      success: true,
      data: {
        chartData,
        chartConfig: {
          ...chartConfig,
          ...config
        },
        rawData: rows,
        columns,
        numericColumns,
        textColumns,
        dateColumns
      }
    });
  } catch (error: any) {
    console.error('Error in preview-from-rows:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to generate preview' },
      { status: 500 }
    );
  }
}

