'use client';

import React from 'react';
import { Input, Modal, message } from 'antd';
import type { MenuProps } from 'antd';
import { CopyOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { createRecipe, deleteRecipe, updateRecipe, type Recipe } from '@/api/prep';
import { useImpactConfirm } from '@/components/impact/impact';
import { useFormatUserError } from '@/hooks/useFormatUserError';

/** Rename, duplicate and delete for a recipe: the same menu on the list and on the recipe page. */
export function useRecipeActions(opts: { afterDelete?: () => void } = {}) {
  const t = useTranslations('prepare');
  const router = useRouter();
  const qc = useQueryClient();
  const formatError = useFormatUserError();
  const confirmWithImpact = useImpactConfirm();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['prep'] });

  const rename = (r: Recipe) => {
    let value = r.name;
    Modal.confirm({
      title: t('rename'),
      icon: null,
      content: <Input defaultValue={r.name} maxLength={200} autoFocus aria-label={t('field_name')} onChange={(e) => (value = e.target.value)} />,
      okText: t('rename'),
      onOk: async () => {
        const name = value.trim();
        if (!name || name === r.name) return;
        try {
          await updateRecipe(r.id, { name });
          refresh();
        } catch (err) {
          message.error(formatError(err));
        }
      },
    });
  };

  const duplicate = async (r: Recipe) => {
    try {
      const copy = await createRecipe({
        name: t('copy_of', { name: r.name }),
        data_source_id: r.data_source_id,
        table: r.table,
        steps: r.steps,
        project_id: r.project_id ?? null,
      });
      refresh();
      router.push(`/prepare/${copy.id}`);
    } catch (err) {
      message.error(formatError(err));
    }
  };

  const remove = (r: Recipe) =>
    void confirmWithImpact({
      kind: 'recipe',
      id: r.id,
      title: t('delete_title', { name: r.name }),
      content: t('delete_desc'),
      okText: t('delete'),
      danger: true,
      onOk: async () => {
        try {
          await deleteRecipe(r.id);
          message.success(t('deleted', { name: r.name }));
          refresh();
          opts.afterDelete?.();
        } catch (err) {
          message.error(formatError(err));
        }
      },
    });

  const menu = (r: Recipe): MenuProps['items'] => [
    { key: 'rename', icon: <EditOutlined />, label: t('rename'), onClick: () => rename(r) },
    { key: 'duplicate', icon: <CopyOutlined />, label: t('duplicate'), onClick: () => void duplicate(r) },
    { type: 'divider' },
    { key: 'delete', icon: <DeleteOutlined />, label: t('delete'), danger: true, onClick: () => remove(r) },
  ];

  return { menu, rename, duplicate, remove };
}
