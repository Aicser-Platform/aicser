'use client';

import React, { useMemo, useState } from 'react';
import { Input, Select, Button, Space, message, Avatar } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useAiModels, useGenerateSql } from '@/hooks/useAi';
import { ApiError } from '@/utils/api';
import { getAiProviderLogo } from '@/config/aiProviders';

type Props = {
  dataSourceId?: string;
  onInsert: (sql: string) => void;
};

export default function NL2SqlPromptBar({ dataSourceId, onInsert }: Props) {
  const [question, setQuestion] = useState('');
  const [model, setModel] = useState<string | undefined>();
  const { data: models = [], isLoading: modelsLoading } = useAiModels();
  const { mutateAsync, isPending } = useGenerateSql();

  // Only show models with configured keys
  const availableModels = useMemo(() => models.filter((m) => m.available), [models]);

  const options = useMemo(
    () =>
      availableModels.map((m) => {
        const logo = getAiProviderLogo(m.provider);
        return {
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {logo && <Avatar src={logo} size={16} />}
              {m.name}
            </span>
          ),
          value: m.id,
        };
      }),
    [availableModels]
  );

  const firstAvailable = useMemo(() => availableModels[0]?.id, [availableModels]);
  const selectedModel = model ?? firstAvailable;

  const handleGenerate = async () => {
    if (!question.trim()) {
      message.warning('Enter a question first.');
      return;
    }
    if (!dataSourceId) {
      message.warning('Select a data source first.');
      return;
    }
    if (!selectedModel) {
      message.error('No AI key configured. Add one in Settings → API Keys.');
      return;
    }
    try {
      const res = await mutateAsync({
        question: question.trim(),
        data_source_id: dataSourceId,
        model: selectedModel,
      });
      onInsert(res.sql);
      if (res.warning) message.warning(res.warning);
      else message.success('SQL generated.');
    } catch (err) {
      if (err instanceof ApiError && (err.detail as { code?: string } | undefined)?.code === 'no_provider_key') {
        message.error('No AI key configured. Add one in Settings → API Keys.');
      } else {
        message.error(err instanceof Error ? err.message : 'Generation failed.');
      }
    }
  };

  return (
    <Space.Compact block style={{ padding: '8px 12px', gap: 8, display: 'flex' }}>
      <Input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onPressEnter={handleGenerate}
        placeholder="Ask a question about your data…"
        allowClear
        style={{borderRadius: 8 }}
      />
      <Select
        value={selectedModel}
        onChange={setModel}
        options={options}
        loading={modelsLoading}
        placeholder={availableModels.length === 0 ? 'No keys configured' : 'Select model'}
        disabled={availableModels.length === 0}
        style={{ minWidth: 200, borderRadius: 8 }}
      />
      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        loading={isPending}
        onClick={handleGenerate}
        disabled={availableModels.length === 0}
        style={{ borderRadius: 8 }}
      >
        Generate
      </Button>
    </Space.Compact>
  );
}
