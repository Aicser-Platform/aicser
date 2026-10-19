import { describe, expect, it, vi } from 'vitest';
import { createPythonBridge } from '../pythonBridge';


const text = {
  enterpriseOnly: 'EE only',
  notFound: (w: string, n: string) => `no ${w} ${n}`,
  ambiguous: (w: string, n: string) => `two ${w}s ${n}`,
};

function bridge(api: ReturnType<typeof vi.fn>) {
  return createPythonBridge({
    api: api as never, text, projectId: 'p1',
    sourceId: (s) => (s === 'Retail' ? 'ds1' : 'ds0'),
    query: async () => ({ columns: ['a'], rows: [[1]] }),
  });
}

describe('notebook Python bridge', () => {
  it('predicts in batches of 1000 with the model found by name', async () => {
    const api = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.split('?')[0] === '/api/models') return { items: [{ id: 'm1', name: 'Churn' }] };
      const n = JSON.parse(String(init?.body)).rows.length;
      return { output_column: 'predicted_churn', predictions: Array(n).fill({ prediction: 'no' }), warnings: [] };
    });
    const rows = Array.from({ length: 2500 }, (_, i) => [i]);
    const out = (await bridge(api)('predict', { model: 'churn', columns: ['tenure'], rows })) as { predictions: unknown[] };
    expect(out.predictions).toHaveLength(2500);
    expect(api.mock.calls.filter(([u]) => u === '/api/models/m1/predict')).toHaveLength(3);
    expect(JSON.parse(String(api.mock.calls[1][1]?.body)).rows[0]).toEqual({ tenure: 0 });
  });

  it('says clearly when a model is unknown, ambiguous, or the edition lacks models', async () => {
    const two = vi.fn(async () => ({ items: [{ id: 'a', name: 'X' }, { id: 'b', name: 'x' }] }));
    await expect(bridge(two)('forecast_model', { model: 'X' })).rejects.toThrow('two models X');
    await expect(bridge(two)('forecast_model', { model: 'Y' })).rejects.toThrow('no model Y');
    const ce = vi.fn(async () => { throw Object.assign(new Error('Not Found'), { status: 404 }); });
    await expect(bridge(ce)('models', {})).rejects.toThrow('EE only');
  });

  it('saves a forecast on the named source in the current project, and refuses other kinds', async () => {
    const api = vi.fn(async (_url: string, _init?: RequestInit) => ({ id: 'm9', name: 'Sales' }));
    await bridge(api)('save_forecast', { name: 'Sales', sql: 'SELECT 1', time_col: 'd', value_col: 'v', periods: 6, source: 'Retail' });
    expect(JSON.parse(String(api.mock.calls[0][1]?.body))).toMatchObject({ data_source_id: 'ds1', project_id: 'p1' });
    await expect(bridge(api)('delete_everything', {})).rejects.toThrow("can't do");
  });

  it('runs a semantic metric through the governed query path', async () => {
    // The bridge calls the semantic layer itself (it also runs in the scheduled-run worker).
    const api = vi.fn(async (endpoint: string, _init?: RequestInit) =>
      endpoint.startsWith('/api/semantic/compile')
        ? { sql: 'SELECT region, SUM(amount) AS metric_value FROM orders GROUP BY 1' }
        : { metrics: [{ id: 'm2', name: 'orders' }, { id: 'm1', name: 'revenue', certified: true }] },
    );
    const query = vi.fn(async () => ({ columns: ['region', 'metric_value'], rows: [['north', 10]] }));
    const run = createPythonBridge({ api: api as never, text, projectId: 'p1', sourceId: (s) => (s === 'Retail' ? 'ds1' : 'ds0'), query });
    const out = await run('metric', { metric: 'revenue', by: ['region'], grain: 'month', source: 'Retail' });
    expect(api.mock.calls[0][0]).toBe('/api/semantic/compile');
    expect(JSON.parse(String(api.mock.calls[0][1]?.body))).toMatchObject({
      data_source_id: 'ds1', metric: 'revenue', dimensions: ['region'], time_grain: 'month', project_id: 'p1',
    });
    expect(query).toHaveBeenCalledWith('SELECT region, SUM(amount) AS metric_value FROM orders GROUP BY 1', 'Retail');
    expect(out).toEqual({ columns: ['region', 'metric_value'], rows: [['north', 10]] });
    const listed = (await run('metrics', {})) as { metrics: Array<{ name: string }> };
    expect(api.mock.calls[1][0]).toBe('/api/semantic/metrics?data_source_id=ds0&project_id=p1');
    expect(listed.metrics.map((m) => m.name)).toEqual(['revenue', 'orders']); // official first
  });
});
