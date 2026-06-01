'use client';

import React from 'react';
import { Select } from 'antd';
import { useTranslations } from 'next-intl';
import { chartTypeSelectOptions } from './chartTypeCatalog';

export interface ChartTypeSelectProps {
  value: string;
  availableTypes: readonly string[];
  onChange: (chartType: string) => void;
  size?: 'small' | 'middle' | 'large';
  disabled?: boolean;
  className?: string;
}

/** Icon-only style chart type dropdown (no "Chart type" label). */
export const ChartTypeSelect: React.FC<ChartTypeSelectProps> = ({
  value,
  availableTypes,
  onChange,
  size = 'small',
  disabled,
  className,
}) => {
  const t = useTranslations('chat_page');
  const options = chartTypeSelectOptions(availableTypes);

  return (
    <Select
      className={className ?? 'chart-type-select'}
      size={size}
      value={value}
      options={options}
      disabled={disabled || options.length <= 1}
      popupMatchSelectWidth={false}
      onChange={onChange}
      aria-label={t('chart_type')}
    />
  );
};
