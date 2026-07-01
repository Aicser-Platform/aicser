'use client';

import React, { useState } from 'react';
import { Dropdown, Button } from 'antd';
import { MoreOutlined } from '@ant-design/icons';

interface OverflowMenuButtonProps {
  /** Render prop so items that open a drawer/modal (e.g. Version History) can close this menu first. */
  children: (close: () => void) => React.ReactNode;
  ariaLabel: string;
  title?: string;
}

/**
 * Generic "..." overflow trigger for the studio toolbars. Uses `popupRender` with
 * controlled `open` state (like `DashboardTabs.tsx`'s `dashboardNavigator`) so
 * interactive content — zoom +/-, undo/redo — doesn't auto-close the menu on click;
 * only outside-click/Escape (via `onOpenChange`) or an explicit `close()` call does.
 */
export const OverflowMenuButton: React.FC<OverflowMenuButtonProps> = ({ children, ariaLabel, title }) => {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dropdown
      trigger={['click']}
      open={open}
      onOpenChange={setOpen}
      popupRender={() => (
        <div className="flex flex-col gap-1 min-w-[200px] p-2 mt-1 rounded-lg border border-border-light bg-bg-container shadow-md [&_.ant-btn]:!text-text">
          {children(close)}
        </div>
      )}
    >
      <Button
        type="text"
        icon={<MoreOutlined />}
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
      />
    </Dropdown>
  );
};

export default OverflowMenuButton;
