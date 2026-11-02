'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { getChatHref, isEnterpriseEdition } from '@/utils/appPaths';

/** For empty pages: hands the job to the Agent with a ready request the person can read and send. */
export function AgentSetupButton({ prompt }: { prompt: string }) {
  const t = useTranslations('common');
  if (!isEnterpriseEdition()) return null;
  return (
    <Link href={getChatHref({ mode: 'agent', prompt })}>
      <Button icon={<RobotOutlined />}>{t('agent_set_up')}</Button>
    </Link>
  );
}
