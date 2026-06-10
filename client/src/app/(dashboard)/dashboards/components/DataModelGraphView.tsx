'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { listRelationships, type DataModelRelationship } from '@/api/dataModel';
import { buildRelationshipGraphLayout } from '../utils/dataModelGraphLayout';

type Props = {
  dataSourceId: string;
  compact?: boolean;
};

export function DataModelGraphView({ dataSourceId, compact = false }: Props) {
  const t = useTranslations('dashboards');
  const [rows, setRows] = useState<DataModelRelationship[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTable, setActiveTable] = useState<string | null>(null);

  useEffect(() => {
    if (!dataSourceId) return;
    let cancelled = false;
    setLoading(true);
    void listRelationships(dataSourceId)
      .then((rels) => {
        if (!cancelled) setRows(rels);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSourceId]);

  const layout = useMemo(() => buildRelationshipGraphLayout(rows), [rows]);

  const connected = useMemo(() => {
    if (!activeTable) return new Set<string>();
    const set = new Set<string>([activeTable]);
    layout.edges.forEach((e) => {
      if (e.from === activeTable) set.add(e.to);
      if (e.to === activeTable) set.add(e.from);
    });
    return set;
  }, [activeTable, layout.edges]);

  if (loading) {
    return (
      <div className="data-model-graph-loading">
        <Spin size="small" />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <Typography.Text type="secondary" className="data-model-graph-empty">
        {t('data_model_graph_empty')}
      </Typography.Text>
    );
  }

  const modelLabel =
    layout.modelHint === 'star'
      ? t('data_model_hint_star')
      : layout.modelHint === 'snowflake'
        ? t('data_model_hint_snowflake')
        : t('data_model_hint_flat');

  return (
    <div className={`data-model-graph${compact ? ' data-model-graph-compact' : ''}`}>
      <div className="data-model-graph-header">
        <Tag color="processing">{modelLabel}</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {t('data_model_graph_hint')}
        </Typography.Text>
      </div>
      <svg
        className="data-model-graph-svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={t('data_model_graph_aria')}
      >
        {layout.edges.map((edge) => {
          const from = layout.nodes.find((n) => n.id === edge.from);
          const to = layout.nodes.find((n) => n.id === edge.to);
          if (!from || !to) return null;
          const dimmed =
            activeTable && !connected.has(edge.from) && !connected.has(edge.to);
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          return (
            <g key={edge.id} className={dimmed ? 'data-model-edge dimmed' : 'data-model-edge'}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
              {!compact && (
                <text x={midX} y={midY - 4} textAnchor="middle" className="data-model-edge-label">
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
        {layout.nodes.map((node) => {
          const isActive = activeTable === node.id;
          const isConnected = !activeTable || connected.has(node.id);
          const w = compact ? 88 : 108;
          const h = compact ? 28 : 34;
          return (
            <g
              key={node.id}
              className={`data-model-node${isActive ? ' active' : ''}${!isConnected ? ' dimmed' : ''}`}
              onClick={() => setActiveTable(isActive ? null : node.id)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={node.x - w / 2}
                y={node.y - h / 2}
                width={w}
                height={h}
                rx={6}
                className={node.role === 'fact' ? 'data-model-node-fact' : 'data-model-node-dim'}
              />
              <text x={node.x} y={node.y + 4} textAnchor="middle" className="data-model-node-label">
                {node.label.length > 14 ? `${node.label.slice(0, 12)}…` : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
