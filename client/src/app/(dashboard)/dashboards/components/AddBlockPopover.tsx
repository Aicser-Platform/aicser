'use client';

import React, { useState } from 'react';
import { Popover, Input } from 'antd';
import {
  LineChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
  AreaChartOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import './AddBlockPopover.css';

interface AddBlockPopoverProps {
  children: React.ReactNode;
  onSelect: (type: string) => void;
}

const SECTIONS = [
  {
    title: 'Charts',
    items: [
      { id: 'line', name: 'Line', icon: <LineChartOutlined />, type: 'line' },
      { id: 'bar', name: 'Bar', icon: <BarChartOutlined rotate={90} />, type: 'bar' },
      { id: 'area', name: 'Area', icon: <AreaChartOutlined />, type: 'area' },
      { id: 'pie', name: 'Pie', icon: <PieChartOutlined />, type: 'pie' },
      {
        id: 'donut',
        name: 'Donut',
        icon: (
          <div className="anticon">
            <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
              <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 672c-123.7 0-224-100.3-224-224s100.3-224 224-224 224 100.3 224 224-100.3 224-224 224z" />
            </svg>
          </div>
        ),
        type: 'donut',
      },
      {
        id: 'scatter',
        name: 'Scatter',
        icon: (
          <div className="anticon">
            <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
              <path d="M888 792H232V136c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v704c0 4.4 3.6 8 8 8h720c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zM312 288c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm560 216c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zM544 192c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm176 416c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64z" />
            </svg>
          </div>
        ),
        type: 'scatter',
      },
    ],
  },
  {
    title: 'Data & Content',
    items: [
      {
        id: 'table',
        name: 'Table',
        icon: (
          <div className="anticon">
            <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
              <path d="M912 192H112c-8.8 0-16 7.2-16 16v560c0 8.8 7.2 16 16 16h800c8.8 0 16-7.2 16-16V208c0-8.8-7.2-16-16-16zM656 256v160H368V256h288zM368 480h288v160H368V480zM160 256h144v160H160V256zm0 224h144v160H160V480zm0 304v-80h144v80H160zm208 0v-80h288v80H368zm496 0H720v-80h144v80zm0-144H720V480h144v160zm0-224H720V256h144v160z" />
            </svg>
          </div>
        ),
        type: 'table',
      },
      {
        id: 'text',
        name: 'Text Block',
        icon: (
          <div className="anticon">
            <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
              <path d="M128 128v768h768V128H128zm688 688H208V208h608v608zM320 320h384v64H320V320zm0 192h384v64H320V512zm0 192h256v64H320V704z" />
            </svg>
          </div>
        ),
        type: 'text',
      },
    ],
  },
];

export const AddBlockPopover: React.FC<AddBlockPopoverProps> = ({ children, onSelect }) => {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');

  const content = (
    <div className="add-block-popover-content">
      <div className="popover-search">
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--studio-text-muted)' }} />}
          placeholder="Search block type"
          variant="borderless"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
          autoFocus
        />
      </div>

      <div className="popover-scroll-area">
        {SECTIONS.map((section) => {
          const filteredItems = section.items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));

          if (filteredItems.length === 0) return null;

          return (
            <div key={section.title} className="popover-section">
              <div className="section-title">{section.title}</div>
              <div className="items-grid">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="popover-item"
                    onClick={() => {
                      onSelect(item.type);
                      setVisible(false);
                    }}
                  >
                    <div className="item-icon-wrapper">{item.icon}</div>
                    <span className="item-name">{item.name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={visible}
      onOpenChange={setVisible}
      placement="bottomLeft"
      classNames={{ root: 'add-block-popover-overlay' }}
      arrow={false}
    >
      {children}
    </Popover>
  );
};
