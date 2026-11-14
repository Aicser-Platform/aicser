'use client';

import React, { useMemo, useState } from 'react';
import { Button, Drawer, List, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useDataSources, useUpsertDataSourceAccessGrant, dataSourceKeys } from '@/hooks/useDataSources';
import { useProjectStore } from '@/stores/useProjectStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjects } from '@/hooks/useProjects';
import { isLakehouseComputeDataSource } from '@/utils/lakehouseComputeSource';
import { useFormatUserError } from '@/hooks/useFormatUserError';

const { Text } = Typography;

/**
 * Connections belong to the organization and are shared into projects, never copied.
 * Lists connections the person can see in their other projects and adds one to the
 * current project with a project grant (view + query), so every page in this project
 * — Ask, SQL editor, Semantic models, Catalog — sees the same set.
 */
export const OtherProjectConnections: React.FC<{ projectSourceIds: Set<string> }> = ({ projectSourceIds }) => {
  const t = useTranslations('data_page');
  const formatError = useFormatUserError();
  const qc = useQueryClient();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const currentProject = useProjectStore((s) => s.currentProject);
  const currentOrgId = useOrganizationStore((s) => s.currentOrganization?.id);
  const { projects } = useProjects(currentProject?.organization_id ?? currentOrgId ?? null);
  const { dataSources: orgSources } = useDataSources(null, { allProjects: true });
  const upsertGrant = useUpsertDataSourceAccessGrant();
  const [open, setOpen] = useState(false);

  const others = useMemo(
    () =>
      (orgSources || []).filter(
        (ds) => ds.is_active !== false && !projectSourceIds.has(String(ds.id)) && !isLakehouseComputeDataSource(ds),
      ),
    [orgSources, projectSourceIds],
  );

  if (!currentProjectId || others.length === 0) return null;

  const projectName = (id?: string | null) =>
    projects.find((p) => String(p.id) === String(id))?.name ?? t('other_project');

  const addToProject = async (id: string, name: string) => {
    try {
      await upsertGrant.mutateAsync({
        id,
        data: { grantee_type: 'project', grantee_id: String(currentProjectId), permissions: ['view', 'query'] },
      });
      await qc.invalidateQueries({ queryKey: dataSourceKeys.all });
      message.success(t('added_to_project', { name }));
    } catch (err) {
      message.error(formatError(err));
    }
  };

  // One quiet line that opens the list, so the page's own connections stay first.
  return (
    <>
      <Button type="link" size="small" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => setOpen(true)}>
        {t('other_projects_title', { count: others.length })}
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} width={520} title={t('other_projects_title', { count: others.length })} destroyOnHidden>
        <List
          size="small"
          dataSource={others}
          renderItem={(ds) => (
            <List.Item
              actions={[
                <Button
                  key="add"
                  size="small"
                  icon={<PlusOutlined />}
                  loading={upsertGrant.isPending && upsertGrant.variables?.id === ds.id}
                  onClick={() => addToProject(String(ds.id), ds.name)}
                >
                  {t('add_to_project')}
                </Button>,
              ]}
            >
              <Text strong>{ds.name}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                {t('in_project', { project: projectName(ds.project_id) })}
              </Text>
            </List.Item>
          )}
        />
      </Drawer>
    </>
  );
};
