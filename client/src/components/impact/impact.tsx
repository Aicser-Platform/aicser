'use client';

import React from 'react';
import { Modal, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { useProjectStore } from '@/stores/useProjectStore';

const { Text } = Typography;

export type ImpactKind = 'data_source' | 'chart' | 'dashboard' | 'metric' | 'recipe' | 'model' | 'decision';

export type ImpactItem = { kind: string; id: string; name: string; relation: string; href: string | null };
export type Impact = { items: ImpactItem[]; counts: Record<string, number>; hidden: number };

const SHOWN = 6;

/** What depends on an object; null when it can't be told (the change itself still works). */
export async function fetchImpact(kind: ImpactKind, id: string, projectId?: string | null): Promise<Impact | null> {
  try {
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    return await fetchApi<Impact>(`/api/impact/${kind}/${encodeURIComponent(id)}${query}`);
  } catch {
    return null;
  }
}

type T = ReturnType<typeof useTranslations>;

/** The dependents as a short list. Renders nothing when nothing depends on the object. */
export function ImpactList({ impact, t, heading = true }: { impact: Impact | null; t: T; heading?: boolean }) {
  if (!impact || (!impact.items.length && !impact.hidden)) return null;
  const more = impact.items.length - SHOWN;
  return (
    <div style={heading ? { marginTop: 12 } : undefined}>
      {heading ? <Text strong>{t('used_by')}</Text> : null}
      <ul style={{ margin: heading ? '4px 0 0' : 0, paddingInlineStart: 18 }}>
        {impact.items.slice(0, SHOWN).map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <Text type="secondary">{t(`kind_${item.kind}`)} · </Text>
            {item.href ? (
              <a href={item.href} target="_blank" rel="noreferrer">
                {item.name}
              </a>
            ) : (
              <Text>{item.name}</Text>
            )}
          </li>
        ))}
        {more > 0 ? (
          <li>
            <Text type="secondary">{t('and_more', { count: more })}</Text>
          </li>
        ) : null}
        {impact.hidden ? (
          <li>
            <Text type="secondary">{t('hidden', { count: impact.hidden })}</Text>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * A delete/replace confirmation that first says what depends on the object. Translations are
 * resolved here, before the dialog opens, because confirm dialogs render outside the app's providers.
 */
export function useImpactConfirm() {
  const t = useTranslations('impact');
  const projectId = useProjectStore((s) => s.currentProjectId);
  return async (opts: {
    kind: ImpactKind;
    id: string;
    title: React.ReactNode;
    content: React.ReactNode;
    okText: React.ReactNode;
    cancelText?: React.ReactNode;
    danger?: boolean;
    onOk: () => unknown;
  }) => {
    const impact = await fetchImpact(opts.kind, opts.id, projectId != null ? String(projectId) : null);
    Modal.confirm({
      title: opts.title,
      content: (
        <>
          {opts.content}
          <ImpactList impact={impact} t={t} />
        </>
      ),
      okText: opts.okText,
      cancelText: opts.cancelText,
      okButtonProps: opts.danger ? { danger: true } : undefined,
      onOk: opts.onOk,
    });
  };
}
