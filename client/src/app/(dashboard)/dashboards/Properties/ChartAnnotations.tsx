'use client';

import React, { useState } from 'react';
import { Button, Input } from 'antd';
import { useTranslations } from 'next-intl';
import { PpLabel } from './PpLabel';

/**
 * Description and "Source / notes" for a chart (Datawrapper's annotate step): one line under the
 * title saying what the reader is looking at, and a byline saying where it comes from. Folded
 * behind a link until used, so the panel stays short for charts that don't need them.
 */
export function ChartAnnotations({
  subtitle,
  sourceNote,
  onChange,
}: {
  subtitle?: unknown;
  sourceNote?: unknown;
  onChange: (patch: { subtitle?: string; sourceNote?: string }) => void;
}) {
  const t = useTranslations('dashboards');
  const description = typeof subtitle === 'string' ? subtitle : '';
  const source = typeof sourceNote === 'string' ? sourceNote : '';
  const [open, setOpen] = useState(Boolean(description || source));

  if (!open) {
    return (
      <Button type="link" size="small" className="pp-annotations-toggle" onClick={() => setOpen(true)}>
        {t('annotations_add')}
      </Button>
    );
  }

  return (
    <div className="pp-annotations">
      <PpLabel>{t('annotations_description')}</PpLabel>
      <Input.TextArea
        size="small"
        autoSize={{ minRows: 1, maxRows: 3 }}
        maxLength={200}
        value={description}
        placeholder={t('annotations_description_placeholder')}
        onChange={(e) => onChange({ subtitle: e.target.value || undefined })}
      />
      <PpLabel>{t('annotations_source')}</PpLabel>
      <Input.TextArea
        size="small"
        autoSize={{ minRows: 1, maxRows: 4 }}
        maxLength={300}
        value={source}
        placeholder={t('annotations_source_placeholder')}
        onChange={(e) => onChange({ sourceNote: e.target.value || undefined })}
      />
    </div>
  );
}
