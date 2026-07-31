'use client';

import React, { useState } from 'react';
import { Input, Button, Space, message } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useGenerateSql } from '@/hooks/useAi';
import { ApiError } from '@/utils/api';
import { ModelSelector } from '@/components/ai/ModelSelector/ModelSelector';
import { useAiAvailability } from '@/hooks/useAiAvailability';

const IS_EE = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

type Props = {
  dataSourceId?: string;
  onInsert: (sql: string) => void;
};

export default function NL2SqlPromptBar({ dataSourceId, onInsert }: Props) {
  const [question, setQuestion] = useState('');
  // Undefined (not 'auto') until the persisted preference loads — ModelSelector
  // treats any truthy controlled value as authoritative and skips loading it.
  const [model, setModel] = useState<string | undefined>(undefined);
  const { mutateAsync, isPending } = useGenerateSql();
  const aiAvailability = useAiAvailability(true, IS_EE);
  const aiAvailable = !IS_EE || aiAvailability.available;

  if (IS_EE && !aiAvailability.loading && !aiAvailability.available) {
    return null;
  }

  const handleGenerate = async () => {
    if (!aiAvailable) {
      message.warning('AI is unavailable. Add or update an AI provider key in Settings.');
      return;
    }
    if (!question.trim()) {
      message.warning('Enter a question first.');
      return;
    }
    if (!dataSourceId) {
      message.warning('Select a data source first.');
      return;
    }
    try {
      const res = await mutateAsync({
        question: question.trim(),
        data_source_id: dataSourceId,
        model: model ?? 'auto',
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
      <ModelSelector compact value={model} onModelChange={setModel} disabled={isPending} persistPreference />
      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        loading={isPending}
        onClick={handleGenerate}
        style={{ borderRadius: 8 }}
      >
        Generate
      </Button>
    </Space.Compact>
  );
}
