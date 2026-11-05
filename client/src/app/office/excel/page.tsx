'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Script from 'next/script';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Select, Space, Typography } from 'antd';
import { fetchApi } from '@/utils/api';

type Source = { id: string; name: string };
type Answer = { answer: string; columns: string[]; rows: Record<string, unknown>[]; row_count: number };

declare const Excel: any;
declare const Office: any;

function cell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/** Excel taskpane: ask a governed question, put the result table into a new sheet. */
export default function ExcelTaskpane() {
  const t = useTranslations('office');
  const [ready, setReady] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState<string>();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On the desktop the session cookie works; Excel on the web shows this page inside Office's own
  // page, where it doesn't, so a sign-in dialog hands over a token instead.
  const [token, setToken] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const call = useCallback(<T,>(endpoint: string, options: RequestInit = {}) =>
    fetchApi<T>(endpoint, token ? { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } } : options),
  [token]);

  useEffect(() => {
    call<{ data_sources?: Source[] }>('/api/office/sources')
      .then((r) => {
        setNeedsSignIn(false);
        setSources(r.data_sources ?? []);
      })
      .catch((e) => {
        if (e?.status === 401 || e?.status === 403) setNeedsSignIn(true);
        else setError(String(e?.message || e));
      });
  }, [call]);

  const signIn = () => {
    Office.context.ui.displayDialogAsync(`${window.location.origin}/office/auth`, { height: 60, width: 30 }, (res: any) => {
      if (res.status !== 'succeeded') {
        setError(t('sign_in_failed'));
        return;
      }
      const dialog = res.value;
      dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg: any) => {
        dialog.close();
        try {
          setToken(JSON.parse(arg.message).token);
        } catch {
          setError(t('sign_in_failed'));
        }
      });
    });
  };

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await call<Answer>('/api/office/ask', {
        method: 'POST',
        body: JSON.stringify({ question, data_source_id: sourceId }),
      }));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const insert = async () => {
    if (!answer?.columns.length) return;
    await Excel.run(async (context: any) => {
      const sheet = context.workbook.worksheets.add();
      const values = [answer.columns, ...answer.rows.map((r) => answer.columns.map((c) => cell(r[c])))];
      const range = sheet.getRangeByIndexes(0, 0, values.length, answer.columns.length);
      range.values = values;
      sheet.tables.add(range, true);
      range.format.autofitColumns();
      sheet.activate();
      await context.sync();
    });
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--ant-color-bg-container)', minHeight: '100vh' }}>
      <Script
        src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"
        onLoad={() => Office.onReady(() => setReady(true))}
      />
      <Typography.Title level={4} style={{ margin: 0 }}>{t('title')}</Typography.Title>
      {needsSignIn ? (
        <Button type="primary" onClick={signIn} disabled={!ready}>{t('sign_in')}</Button>
      ) : null}
      <Select
        placeholder={t('source')}
        value={sourceId}
        onChange={setSourceId}
        options={sources.map((s) => ({ value: s.id, label: s.name }))}
        showSearch
        optionFilterProp="label"
      />
      <Input.TextArea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={t('question')}
        autoSize={{ minRows: 2, maxRows: 6 }}
        onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); if (question.trim() && sourceId) void ask(); } }}
      />
      <Button type="primary" loading={busy} disabled={!question.trim() || !sourceId} onClick={ask}>{t('ask')}</Button>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {answer ? (
        <Space direction="vertical" size={8}>
          {answer.answer ? <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{answer.answer}</Typography.Paragraph> : null}
          {answer.columns.length ? (
            <Button onClick={() => void insert()} disabled={!ready}>
              {t('insert', { rows: answer.rows.length })}
            </Button>
          ) : null}
          {!ready ? <Typography.Text type="secondary">{t('open_in_excel')}</Typography.Text> : null}
        </Space>
      ) : null}
    </div>
  );
}
