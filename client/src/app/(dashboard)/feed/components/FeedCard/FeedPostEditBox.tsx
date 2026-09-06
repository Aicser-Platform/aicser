import React from 'react';
import { Button, Mentions } from 'antd';
import { useTranslations } from 'next-intl';

interface FeedPostEditBoxProps {
  compact: boolean;
  value: string;
  onChange: (value: string) => void;
  mentionOptions: { value: string; label: string }[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

/** Inline edit box for a pure-text post's own content, swapped in for
 * FeedCardBody while editing - same shape as the comment inline-edit UI
 * (Mentions input + Save/Cancel), just at post scale. */
const FeedPostEditBox: React.FC<FeedPostEditBoxProps> = ({
  compact,
  value,
  onChange,
  mentionOptions,
  saving,
  onSave,
  onCancel,
}) => {
  const t = useTranslations('feed');
  const tp = useTranslations('feed_page');
  const canSave = value.trim().length > 0 && !saving;

  return (
    <div className={`flex flex-col gap-2 ${compact ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
      <Mentions
        autoFocus
        value={value}
        onChange={onChange}
        options={mentionOptions}
        placeholder={tp('edit_post_placeholder')}
        autoSize={{ minRows: 2, maxRows: 10 }}
        className="text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <Button size="small" onClick={onCancel} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button size="small" type="primary" loading={saving} disabled={!canSave} onClick={onSave}>
          {t('save')}
        </Button>
      </div>
    </div>
  );
};

export default FeedPostEditBox;
