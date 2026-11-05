'use client';

import React, { useEffect, useState } from 'react';
import { Badge, Button, Popover, Progress, Tooltip } from 'antd';
import { CheckCircleFilled, CloseOutlined, CompassOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { COMMUNITY_URL, showCommunity } from '@/constants/community';
import { nextItem, skipKey, visibleItems, type ChecklistItem } from './guides';
import { onOpenChecklist, startGuide } from './guideEvents';
import { useJourney, useSaveGuide } from './useJourney';
import './guide.css';

/** The getting-started list, one header button. Gone once everything is done, or when hidden. */
export function GuideLauncher() {
  const t = useTranslations('guide');
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenChecklist(() => setOpen(true)), []);
  const { data: journey } = useJourney();
  const save = useSaveGuide();
  const items = visibleItems(journey);
  const next = nextItem(journey);
  if (!items.length || !next || journey?.guides.checklist?.status === 'dismissed') return null;
  const done = items.filter((item) => journey?.steps[item.step]).length;

  const go = (item: ChecklistItem) => {
    setOpen(false);
    startGuide(item.guide);
  };

  const list = (
    <div className="guide-list">
      <Progress percent={Math.round((done / items.length) * 100)} size="small" showInfo={false} />
      {items.map((item) => {
        const finished = Boolean(journey?.steps[item.step]);
        return (
          <div key={item.step} className="guide-list__item">
            <button
              type="button"
              className={`guide-list__row${finished ? ' guide-list__row--done' : ''}${item === next ? ' guide-list__row--next' : ''}`}
              disabled={finished}
              onClick={() => go(item)}
            >
              {finished ? <CheckCircleFilled aria-hidden /> : <span className="guide-list__dot" aria-hidden />}
              <span>{t(`checklist.${item.step}`)}</span>
            </button>
            {!finished && (
              <Button
                type="text"
                size="small"
                className="guide-list__skip"
                icon={<CloseOutlined />}
                title={t('skip')}
                aria-label={t('skip')}
                onClick={() => save(skipKey(item.step), 'dismissed')}
              />
            )}
          </div>
        );
      })}
      <div className="guide-list__foot">
        {showCommunity ? <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">{t('community')}</a> : <span />}
        <Button type="text" size="small" className="guide-list__hide" onClick={() => save('checklist', 'dismissed')}>
          {t('hide_list')}
        </Button>
      </div>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" title={t('title')} content={list} zIndex={1046}>
      <Tooltip title={open ? undefined : t('title')}>
        <Badge dot={done === 0} offset={[-4, 4]}>
          <Button
            type="text"
            icon={<CompassOutlined />}
            className="header-shell-icon-btn icon-only-btn"
            aria-label={t('open', { done, total: items.length })}
          />
        </Badge>
      </Tooltip>
    </Popover>
  );
}
