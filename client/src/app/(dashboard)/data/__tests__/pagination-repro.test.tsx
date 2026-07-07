import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Table } from 'antd';

// jsdom has no matchMedia; antd's responsive breakpoint observer (used by
// Pagination/Grid) needs it just to mount, unrelated to what this test covers.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Isolated repro of the exact `pagination` prop shape used on the Data Sources
// page's <Table>: a plain object literal with a hardcoded `pageSize`, no
// `current`/`onChange` wired to component state. antd's usePagination merges
// `{ ...innerPagination, ...paginationProp }` on every render, so a *constant*
// pageSize in paginationProp always wins over whatever the user picked via the
// size-changer.
function UncontrolledPaginationTable() {
  const dataSource = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Row ${i}` }));
  return (
    <Table
      rowKey="id"
      dataSource={dataSource}
      columns={[{ title: 'Name', dataIndex: 'name', key: 'name' }]}
      pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
    />
  );
}

// The fix: pageSize/current live in component state and are threaded back in,
// instead of a hardcoded literal that always wins antd's pagination merge.
function ControlledPaginationTable() {
  const dataSource = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Row ${i}` }));
  const [pagination, setPagination] = React.useState({ current: 1, pageSize: 10 });
  return (
    <Table
      rowKey="id"
      dataSource={dataSource}
      columns={[{ title: 'Name', dataIndex: 'name', key: 'name' }]}
      pagination={{
        current: pagination.current,
        pageSize: pagination.pageSize,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '50'],
        onChange: (current, pageSize) => setPagination({ current, pageSize }),
      }}
    />
  );
}

async function pickPageSize20() {
  const sizeChangerTrigger = document.querySelector('.ant-pagination-options-size-changer');
  expect(sizeChangerTrigger).toBeTruthy();
  fireEvent.mouseDown(sizeChangerTrigger!.querySelector('.ant-select-selector')!);
  const option = await screen.findByTitle('20 / page');
  fireEvent.click(option);
}

describe('Table pagination size-changer (Data Sources page pattern)', () => {
  it('BUG: uncontrolled pagination snaps back to the hardcoded pageSize', async () => {
    render(<UncontrolledPaginationTable />);
    await pickPageSize20();

    // Row 19 only exists on a page size >= 20; with the bug, pageSize snaps
    // back to 10 and only Row 0..9 remain rendered.
    await expect(screen.findByText('Row 19', {}, { timeout: 500 })).rejects.toThrow();
  });

  it('FIX: controlled pagination keeps the picked page size', async () => {
    render(<ControlledPaginationTable />);
    await pickPageSize20();

    await screen.findByText('Row 19');
  });
});
