'use client';

/**
 * After a file upload or a new sheet connection, checks once whether the data needs tidying (title
 * rows above the headers, notes under the data, numbers stored as text, …). Tidy data says nothing.
 * Otherwise one quiet notice offers a Prepare recipe already holding the fixes; nothing is blocked.
 */

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Space, notification } from 'antd';
import { ToolOutlined } from '@ant-design/icons';
import { createRecipe, type PrepStep } from '@/api/prep';
import { useProjectStore } from '@/stores/useProjectStore';
import { fetchApi } from '@/utils/api';

type Readiness = {
  needs_prep: boolean;
  table: string;
  issues: { code: string; column?: string | null; params?: Record<string, unknown> }[];
  steps: PrepStep[];
};

const SHEET_TYPES = new Set(['file', 'google_sheets', 'excel', 'csv', 'sheet', 'sheets']);

export function needsCheck(source: { id?: unknown; type?: unknown; db_type?: unknown } | null | undefined): boolean {
  if (!source?.id) return false;
  return [source.type, source.db_type].some((v) => SHEET_TYPES.has(String(v ?? '').toLowerCase()));
}

export function UploadReadinessWatcher() {
  const t = useTranslations('prepare');
  const router = useRouter();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [api, holder] = notification.useNotification();

  useEffect(() => {
    const onCreated = (event: Event) => {
      const source = (event as CustomEvent).detail as { id: string; name?: string; type?: string; db_type?: string } | undefined;
      if (!needsCheck(source)) return;
      void (async () => {
        let result: Readiness;
        try {
          const q = projectId ? `?project_id=${encodeURIComponent(String(projectId))}` : '';
          result = await fetchApi<Readiness>(`/api/prep/readiness${q}`, {
            method: 'POST', body: JSON.stringify({ data_source_id: String(source!.id) }),
          });
        } catch {
          return; // a check that couldn't run never gets in the way
        }
        if (!result?.needs_prep) return;
        const key = `readiness-${source!.id}`;
        const codes = [...new Set(result.issues.map((i) => i.code))];
        const tidy = async () => {
          api.destroy(key);
          try {
            const recipe = await createRecipe({
              name: t('readiness_recipe_name', { name: source!.name || result.table }),
              data_source_id: String(source!.id), table: result.table, steps: result.steps, project_id: projectId ? String(projectId) : null,
            });
            router.push(`/prepare/${recipe.id}`);
          } catch (e) {
            api.error({ message: e instanceof Error ? e.message : String(e) });
          }
        };
        api.open({
          key,
          icon: <ToolOutlined style={{ color: 'var(--ant-color-primary)' }} />,
          message: t('readiness_title', { name: source!.name || result.table }),
          description: (
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {codes.slice(0, 4).map((c) => <li key={c}>{t.has(`readiness_${c}` as never) ? t(`readiness_${c}` as never) : t('readiness_other')}</li>)}
            </ul>
          ),
          btn: (
            <Space>
              <Button size="small" onClick={() => api.destroy(key)}>{t('readiness_not_now')}</Button>
              <Button size="small" type="primary" onClick={() => void tidy()}>{t('readiness_tidy')}</Button>
            </Space>
          ),
          duration: 0,
          placement: 'bottomRight',
        });
      })();
    };
    window.addEventListener('datasource-created', onCreated);
    return () => window.removeEventListener('datasource-created', onCreated);
  }, [api, projectId, router, t]);

  return <>{holder}</>;
}
