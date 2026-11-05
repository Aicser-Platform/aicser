'use client';

/**
 * The CLEAN panel beside the Prepare grid, one tab per stage of cleaning a dataset:
 * Conceptualize (what the data is), Locate (issues with a ready fix), Evaluate (issues a person
 * must judge: keep, exclude or note), Augment (add to the data) and Note (the cleaning report).
 */

import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, List, Segmented, Space, Tag, Tooltip, Typography, message } from 'antd';
import { CheckOutlined, CopyOutlined, DownloadOutlined, EditOutlined } from '@ant-design/icons';
import type { CleaningDecision, CleaningLog, ColumnDistribution, ColumnMeaning, Finding, PreviewColumn, PrepStep } from '@/api/prep';
import { friendlyType } from './recipeSteps';

const { Text } = Typography;

export type CleanStage = 'c' | 'l' | 'e' | 'a' | 'n';
const STAGES: CleanStage[] = ['c', 'l', 'e', 'a', 'n'];

export type AugmentAction = { key: string; label: string; icon?: React.ReactNode; onClick: () => void; needsColumn?: boolean };

/** The key a decision is stored under: one per issue kind and column. */
export const decisionKey = (f: Finding) => `${f.code}:${f.column ?? ''}`;

export function CleanPanel({
  name,
  table,
  rowCount,
  sampled,
  columns,
  dists,
  findings,
  loading,
  error,
  readOnly,
  columnMeta,
  cleaning,
  onCleaningChange,
  stepSentences,
  findingText,
  augment,
  hasSelection,
  onApply,
  onApplyAll,
  onSelectColumn,
  onMeaning,
  onExclude,
}: {
  name: string;
  table: string;
  rowCount?: number;
  sampled?: boolean;
  columns: PreviewColumn[];
  dists: Record<string, ColumnDistribution>;
  findings: Finding[];
  loading: boolean;
  error?: string;
  readOnly: boolean;
  columnMeta?: Record<string, ColumnMeaning>;
  cleaning?: CleaningLog;
  /** Absent when decisions and notes can't be saved here (read-only, or a host without a recipe). */
  onCleaningChange?: (log: CleaningLog) => Promise<void>;
  stepSentences: string[];
  findingText: (f: Finding) => string;
  augment: AugmentAction[];
  hasSelection: boolean;
  onApply: (step: PrepStep) => void;
  onApplyAll: () => void;
  onSelectColumn: (column: string) => void;
  onMeaning?: (column: string) => void;
  onExclude: (column: string) => void;
}) {
  const t = useTranslations('prepare.clean');
  const tp = useTranslations('prepare');
  const fixable = findings.filter((f) => f.suggested_step);
  const review = findings.filter((f) => !f.suggested_step);
  const decisions = cleaning?.decisions ?? {};
  const open = review.filter((f) => !decisions[decisionKey(f)]);
  const [stage, setStage] = useState<CleanStage>('c');
  const counts: Partial<Record<CleanStage, number>> = { l: fixable.length, e: open.length };

  const saveLog = async (next: CleaningLog) => {
    if (!onCleaningChange) return;
    try {
      await onCleaningChange(next);
    } catch {
      message.error(t('save_failed'));
    }
  };
  const decide = (f: Finding, decision: CleaningDecision | null) => {
    const rest = { ...decisions };
    delete rest[decisionKey(f)];
    saveLog({ ...(cleaning ?? {}), decisions: decision ? { ...rest, [decisionKey(f)]: decision } : rest });
  };

  return (
    <div className="clean-panel">
      <Segmented
        block
        size="small"
        value={stage}
        onChange={(v) => setStage(v as CleanStage)}
        options={STAGES.map((s) => ({
          value: s,
          label: (
            <Tooltip title={t(`stage_${s}`)} mouseEnterDelay={0.3}>
              <span className="clean-panel__letter">
                {s.toUpperCase()}
                {counts[s] ? <sup className="clean-panel__count">{counts[s]}</sup> : null}
              </span>
            </Tooltip>
          ),
        }))}
      />
      <div className="clean-panel__intro">
        <Text strong>{t(`stage_${stage}`)}</Text>
        <Text type="secondary" className="clean-panel__hint">{t(`stage_${stage}_hint`)}</Text>
      </div>

      {error ? <Text type="secondary">{tp('suggestions_after_fix')}</Text> : null}
      {loading && !findings.length && !columns.length ? <Text type="secondary">{tp('checking_data')}</Text> : null}

      {stage === 'c' ? (
        <Conceptualize
          rowCount={rowCount}
          sampled={sampled}
          columns={columns}
          dists={dists}
          columnMeta={columnMeta}
          onSelectColumn={onSelectColumn}
          onMeaning={onMeaning}
        />
      ) : null}

      {stage === 'l' ? (
        <>
          {fixable.length > 1 && !readOnly ? (
            <Button size="small" onClick={onApplyAll}>
              {tp('apply_all', { count: fixable.length })}
            </Button>
          ) : null}
          {!fixable.length && !loading && !error ? <Text type="secondary">{t('nothing_to_fix')}</Text> : null}
          <List
            size="small"
            locale={{ emptyText: <span /> }}
            dataSource={fixable}
            renderItem={(f) => (
              <List.Item
                actions={!readOnly ? [<Button key="apply" size="small" onClick={() => onApply(f.suggested_step as PrepStep)}>{tp('apply')}</Button>] : []}
              >
                <Space direction="vertical" size={2}>
                  <Text>{findingText(f)}</Text>
                  {Array.isArray(f.params.failing) && (f.params.failing as string[]).length ? (
                    <Text type="secondary" className="clean-panel__small">
                      {tp('still_unread', { values: (f.params.failing as string[]).slice(0, 3).join(' · ') })}
                    </Text>
                  ) : null}
                </Space>
              </List.Item>
            )}
          />
        </>
      ) : null}

      {stage === 'e' ? (
        <>
          {!review.length && !loading && !error ? <Text type="secondary">{t('nothing_to_review')}</Text> : null}
          <ul className="clean-panel__list">
            {review.map((f) => (
              <ReviewItem
                key={`${decisionKey(f)}|${decisions[decisionKey(f)]?.action ?? ''}|${decisions[decisionKey(f)]?.reason ?? ''}`}
                text={findingText(f)}
                finding={f}
                decision={decisions[decisionKey(f)]}
                canDecide={Boolean(onCleaningChange)}
                canExclude={!readOnly && Boolean(f.column)}
                onDecide={(d) => decide(f, d)}
                onExclude={() => {
                  if (f.column) onExclude(f.column);
                  decide(f, { action: 'exclude', reason: decisions[decisionKey(f)]?.reason ?? null });
                }}
                onShow={() => f.column && onSelectColumn(f.column)}
              />
            ))}
          </ul>
        </>
      ) : null}

      {stage === 'a' ? (
        <div className="clean-panel__actions">
          {augment.map((a) => {
            const blocked = a.needsColumn && !hasSelection;
            return (
              <Tooltip key={a.key} title={blocked ? t('select_column_first') : undefined} placement="left">
                <Button block icon={a.icon} disabled={readOnly || blocked} onClick={a.onClick} className="clean-panel__action">
                  {a.label}
                </Button>
              </Tooltip>
            );
          })}
        </div>
      ) : null}

      {stage === 'n' ? (
        <Notes
          key={cleaning?.note ?? ''}
          name={name}
          table={table}
          stepSentences={stepSentences}
          review={review}
          decisions={decisions}
          findingText={findingText}
          columnMeta={columnMeta}
          note={cleaning?.note ?? ''}
          canEdit={Boolean(onCleaningChange)}
          onNote={(note) => saveLog({ ...(cleaning ?? {}), decisions, note })}
        />
      ) : null}
    </div>
  );
}

function Conceptualize({
  rowCount,
  sampled,
  columns,
  dists,
  columnMeta,
  onSelectColumn,
  onMeaning,
}: {
  rowCount?: number;
  sampled?: boolean;
  columns: PreviewColumn[];
  dists: Record<string, ColumnDistribution>;
  columnMeta?: Record<string, ColumnMeaning>;
  onSelectColumn: (column: string) => void;
  onMeaning?: (column: string) => void;
}) {
  const t = useTranslations('prepare.clean');
  const tp = useTranslations('prepare');
  const described = columns.filter((c) => columnMeta?.[c.name]?.description).length;
  return (
    <>
      <div className="clean-panel__summary">
        <Text>{t('summary', { rows: rowCount ?? 0, columns: columns.length })}</Text>
        {sampled ? <Tag>{t('sampled')}</Tag> : null}
        <Text type="secondary" className="clean-panel__small">{t('described', { count: described, total: columns.length })}</Text>
      </div>
      <ul className="clean-panel__list">
        {columns.map((col) => {
          const d = dists[col.name];
          const filled = d && d.rows ? Math.round(((d.rows - d.empty) / d.rows) * 100) : null;
          const meaning = columnMeta?.[col.name];
          return (
            <li key={col.name} className="clean-panel__col">
              <button type="button" className="clean-panel__col-main" onClick={() => onSelectColumn(col.name)}>
                <span className="clean-panel__col-name">{col.name}</span>
                <span className="clean-panel__col-type">{tp(`type_${friendlyType(col.type)}`)}</span>
              </button>
              {filled !== null ? (
                <div className="clean-panel__bar" role="img" aria-label={t('filled', { percent: filled })}>
                  <span style={{ width: `${filled}%` }} />
                </div>
              ) : null}
              {d ? (
                <Text type="secondary" className="clean-panel__small" ellipsis={{ tooltip: true }}>
                  <ColumnShape dist={d} filled={filled ?? 0} />
                </Text>
              ) : null}
              {meaning?.description ? (
                <Text className="clean-panel__small clean-panel__meaning">{meaning.description}</Text>
              ) : onMeaning ? (
                <Button type="link" size="small" className="clean-panel__link" onClick={() => onMeaning(col.name)}>
                  {t('add_meaning')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ColumnShape({ dist, filled }: { dist: ColumnDistribution; filled: number }) {
  const t = useTranslations('prepare.clean');
  const unique = dist.distinct === dist.rows - dist.empty;
  const parts = [t('filled', { percent: filled }), unique ? t('unique') : t('distinct', { count: dist.distinct })];
  if (dist.kind === 'number' && dist.min !== undefined && dist.max !== undefined) {
    parts.push(t('range', { min: dist.min.toLocaleString(), max: dist.max.toLocaleString() }));
  } else if (dist.top?.length && dist.top[0].count > 1) {
    parts.push(t('most_common', { value: dist.top[0].value, count: dist.top[0].count }));
  }
  return <>{parts.join(' · ')}</>;
}

function ReviewItem({
  text,
  finding,
  decision,
  canDecide,
  canExclude,
  onDecide,
  onExclude,
  onShow,
}: {
  text: string;
  finding: Finding;
  decision?: CleaningDecision;
  canDecide: boolean;
  canExclude: boolean;
  onDecide: (d: CleaningDecision | null) => void;
  onExclude: () => void;
  onShow: () => void;
}) {
  const t = useTranslations('prepare.clean');
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(decision?.reason ?? '');
  const examples = Array.isArray(finding.params.examples) ? (finding.params.examples as string[]) : [];

  return (
    <li className={`clean-panel__review${decision ? ' is-decided' : ''}`}>
      <button type="button" className="clean-panel__review-text" onClick={onShow}>
        {text}
      </button>
      {examples.length ? <Text type="secondary" className="clean-panel__small">{t('examples', { values: examples.join(' · ') })}</Text> : null}
      {decision && !editing ? (
        <div className="clean-panel__decision">
          <Tag color={decision.action === 'exclude' ? 'orange' : decision.action === 'keep' ? 'green' : 'blue'} icon={<CheckOutlined />}>
            {t(`decision_${decision.action}`)}
          </Tag>
          {decision.reason ? <Text className="clean-panel__small">{decision.reason}</Text> : null}
          {canDecide ? (
            <Button type="text" size="small" icon={<EditOutlined />} aria-label={t('change_decision')} onClick={() => setEditing(true)} />
          ) : null}
        </div>
      ) : canDecide ? (
        <>
          <Input.TextArea
            size="small"
            autoSize={{ minRows: 1, maxRows: 3 }}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reason_placeholder')}
            aria-label={t('reason_placeholder')}
          />
          <Space size={4} wrap>
            <Button size="small" onClick={() => { onDecide({ action: 'keep', reason: reason || null }); setEditing(false); }}>
              {t('keep')}
            </Button>
            {canExclude ? (
              <Button size="small" onClick={() => { onExclude(); setEditing(false); }}>
                {t('exclude')}
              </Button>
            ) : null}
            <Button size="small" type="text" onClick={() => { onDecide({ action: 'note', reason: reason || null }); setEditing(false); }}>
              {t('note_only')}
            </Button>
            {decision ? (
              <Button size="small" type="text" danger onClick={() => { onDecide(null); setEditing(false); }}>
                {t('clear_decision')}
              </Button>
            ) : null}
          </Space>
        </>
      ) : null}
    </li>
  );
}

function Notes({
  name,
  table,
  stepSentences,
  review,
  decisions,
  findingText,
  columnMeta,
  note,
  canEdit,
  onNote,
}: {
  name: string;
  table: string;
  stepSentences: string[];
  review: Finding[];
  decisions: Record<string, CleaningDecision>;
  findingText: (f: Finding) => string;
  columnMeta?: Record<string, ColumnMeaning>;
  note: string;
  canEdit: boolean;
  onNote: (note: string) => void;
}) {
  const t = useTranslations('prepare.clean');
  const [draft, setDraft] = useState(note);

  const decided = review.filter((f) => decisions[decisionKey(f)]);
  const open = review.filter((f) => !decisions[decisionKey(f)]);
  const meanings = Object.entries(columnMeta ?? {}).filter(([, m]) => m.description);

  const report = useMemo(() => {
    const lines = [`# ${t('report_title', { name })}`, '', t('report_source', { table }), ''];
    lines.push(`## ${t('report_steps')}`);
    lines.push(...(stepSentences.length ? stepSentences.map((s, i) => `${i + 1}. ${s}`) : [`- ${t('report_none')}`]), '');
    lines.push(`## ${t('report_decisions')}`);
    lines.push(
      ...(decided.length
        ? decided.map((f) => {
            const d = decisions[decisionKey(f)];
            return `- ${findingText(f)}: **${t(`decision_${d.action}`)}**${d.reason ? ` (${d.reason})` : ''}`;
          })
        : [`- ${t('report_none')}`]),
    );
    if (open.length) lines.push('', `## ${t('report_open')}`, ...open.map((f) => `- ${findingText(f)}`));
    if (meanings.length) lines.push('', `## ${t('report_columns')}`, ...meanings.map(([c, m]) => `- **${c}**: ${m.description}`));
    if (draft.trim()) lines.push('', `## ${t('report_notes')}`, draft.trim());
    return lines.join('\n');
  }, [t, name, table, stepSentences, decided, open, decisions, findingText, meanings, draft]);

  const copy = () =>
    navigator.clipboard.writeText(report).then(() => message.success(t('copied')), () => message.error(t('copy_failed')));
  const download = () => {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^\w.-]+/g, '_') || 'cleaning'}-report.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="clean-panel__summary">
        <Text>{t('report_counts', { steps: stepSentences.length, decided: decided.length, open: open.length })}</Text>
      </div>
      <Input.TextArea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== note && onNote(draft)}
        disabled={!canEdit}
        autoSize={{ minRows: 4, maxRows: 10 }}
        maxLength={5000}
        placeholder={t('notes_placeholder')}
        aria-label={t('report_notes')}
      />
      <Space size={6}>
        <Button size="small" icon={<CopyOutlined />} onClick={copy}>{t('copy_report')}</Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={download}>{t('download_report')}</Button>
      </Space>
      <pre className="clean-panel__report">{report}</pre>
    </>
  );
}

export default CleanPanel;
