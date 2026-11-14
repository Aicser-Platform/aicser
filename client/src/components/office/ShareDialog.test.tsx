import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShareDialog } from './ShareDialog';

vi.mock('@/lib/office/sharing', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/office/sharing')>();
  return {
    ...real,
    sharingApi: {
      ...real.sharingApi,
      shares: vi.fn(async () => ({
        people: [],
        link: {
          id: 'l1',
          target: 'link',
          role: 'view',
          status: 'pending',
          person_id: null,
          slug: 'abc',
          link_access: 'organization',
          view_count: 0,
        },
      })),
      people: vi.fn(async () => ({
        people: [{ id: 'p1', name: 'Dara', email: 'dara@example.com' }],
        organization: true,
      })),
    },
  };
});

describe('ShareDialog', () => {
  it('opens, loads the shares and settles (no render loop)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let renders = 0;
    const Counted = () => {
      renders += 1;
      return <ShareDialog fileId="f1" title="Plan" noun="document" open onOpenChange={() => undefined} />;
    };
    render(
      <QueryClientProvider client={client}>
        <Counted />
      </QueryClientProvider>
    );
    expect(await screen.findByText('Share “Plan”')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Waiting for approval')).toBeTruthy());
    expect(renders).toBeLessThan(5);
  });
});
