'use client';

import React from 'react';
import { Button, Empty, List, Typography } from 'antd';

export type HistoryEntry = {
  id: string;
  title: string;
  detail?: React.ReactNode;
  disabled?: boolean;
  /** Anything beside Put back (e.g. delete a saved snapshot). */
  extra?: React.ReactNode;
};

/** The one way a list of earlier versions looks, for dashboards, charts and alerts. */
export function HistoryList({ entries, loading, restoreLabel, emptyLabel, restoringId, onRestore }: {
  entries: HistoryEntry[];
  loading?: boolean;
  restoreLabel: string;
  emptyLabel: string;
  restoringId?: string | null;
  onRestore: (id: string) => void;
}) {
  if (!loading && entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyLabel} />;
  }
  return (
    <List
      loading={loading}
      dataSource={entries}
      renderItem={(e) => (
        <List.Item
          actions={[
            <Button key="restore" size="small" disabled={e.disabled} loading={restoringId === e.id} onClick={() => onRestore(e.id)}>
              {restoreLabel}
            </Button>,
            ...(e.extra ? [e.extra] : []),
          ]}
        >
          <List.Item.Meta
            title={<Typography.Text ellipsis={{ tooltip: e.title }} style={{ display: 'block', fontWeight: 500 }}>{e.title}</Typography.Text>}
            description={e.detail}
          />
        </List.Item>
      )}
    />
  );
}
