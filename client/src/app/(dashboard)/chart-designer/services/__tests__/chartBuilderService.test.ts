import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fetchApi is mocked so we can assert the exact endpoint + options the service builds.
const fetchApi = vi.fn();
vi.mock('@/utils/api', () => ({
  fetchApi: (...args: unknown[]) => fetchApi(...args),
}));

const PROJECT = 'a1b2c3d4-1111-4222-8333-444455556666';

async function loadService(edition: 'ce' | 'enterprise') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_EDITION', edition === 'enterprise' ? 'enterprise' : '');
  return await import('../chartBuilderService');
}

beforeEach(() => {
  fetchApi.mockReset();
  fetchApi.mockResolvedValue({ success: true, charts: [], id: 'chart-1' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('chartBuilderService — CE scoping (user_id)', () => {
  it('listCharts omits project_id', async () => {
    const { chartBuilderService } = await loadService('ce');
    await chartBuilderService.listCharts(PROJECT);
    expect(fetchApi).toHaveBeenCalledWith('chart');
  });

  it('createChart omits project_id and sends the payload body', async () => {
    const { chartBuilderService } = await loadService('ce');
    await chartBuilderService.createChart({ chartType: 'bar' }, PROJECT);
    expect(fetchApi).toHaveBeenCalledWith('chart', {
      method: 'POST',
      body: JSON.stringify({ chartType: 'bar' }),
    });
  });

  it('executeAdhoc does not thread projectId into the body', async () => {
    const { chartBuilderService } = await loadService('ce');
    await chartBuilderService.executeAdhoc({ chartType: 'pie' }, PROJECT);
    expect(fetchApi).toHaveBeenCalledWith('chart/execute', {
      method: 'POST',
      body: JSON.stringify({ chartType: 'pie' }),
    });
  });
});

describe('chartBuilderService — EE scoping (project_id)', () => {
  it('listCharts appends project_id', async () => {
    const { chartBuilderService } = await loadService('enterprise');
    await chartBuilderService.listCharts(PROJECT);
    expect(fetchApi).toHaveBeenCalledWith(`chart?project_id=${PROJECT}`);
  });

  it('createChart appends project_id', async () => {
    const { chartBuilderService } = await loadService('enterprise');
    await chartBuilderService.createChart({ chartType: 'bar' }, PROJECT);
    expect(fetchApi).toHaveBeenCalledWith(`chart?project_id=${PROJECT}`, {
      method: 'POST',
      body: JSON.stringify({ chartType: 'bar' }),
    });
  });

  it('executeAdhoc threads projectId into the body', async () => {
    const { chartBuilderService } = await loadService('enterprise');
    await chartBuilderService.executeAdhoc({ chartType: 'pie' }, PROJECT);
    expect(fetchApi).toHaveBeenCalledWith('chart/execute', {
      method: 'POST',
      body: JSON.stringify({ chartType: 'pie', projectId: PROJECT }),
    });
  });

  it('createChart throws ProjectRequiredError when no valid project is selected', async () => {
    const { chartBuilderService, ProjectRequiredError } = await loadService('enterprise');
    await expect(chartBuilderService.createChart({ chartType: 'bar' }, null)).rejects.toBeInstanceOf(
      ProjectRequiredError,
    );
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it('listCharts throws ProjectRequiredError for a non-uuid project', async () => {
    const { chartBuilderService, ProjectRequiredError } = await loadService('enterprise');
    await expect(chartBuilderService.listCharts('not-a-uuid')).rejects.toBeInstanceOf(
      ProjectRequiredError,
    );
  });
});

describe('chartBuilderService — id-scoped ops (no project param)', () => {
  it('updateChart PUTs to chart/{id}', async () => {
    const { chartBuilderService } = await loadService('enterprise');
    await chartBuilderService.updateChart('chart-9', { title: 'x' });
    expect(fetchApi).toHaveBeenCalledWith('chart/chart-9', {
      method: 'PUT',
      body: JSON.stringify({ title: 'x' }),
    });
  });

  it('deleteChart DELETEs chart/{id}', async () => {
    const { chartBuilderService } = await loadService('ce');
    await chartBuilderService.deleteChart('chart-9');
    expect(fetchApi).toHaveBeenCalledWith('chart/chart-9', { method: 'DELETE' });
  });

  it('getChart GETs chart/{id}', async () => {
    const { chartBuilderService } = await loadService('ce');
    await chartBuilderService.getChart('chart-9');
    expect(fetchApi).toHaveBeenCalledWith('chart/chart-9');
  });
});
