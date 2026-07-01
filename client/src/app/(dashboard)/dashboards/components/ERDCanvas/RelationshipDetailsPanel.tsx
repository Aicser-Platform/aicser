'use client';

import React, { useState, useEffect } from 'react';
import { Button, Select, Switch, Typography, Modal, Alert } from 'antd';
import {
  ArrowRightOutlined,
  CloseOutlined,
  FilterOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  useUpdateRelationship,
  useDeleteRelationship,
} from '@/hooks/useDataModelRelationships';
import type { DataModelRelationship } from '@/api/dataModel';
import { useDashboardStore, type WidgetInstance } from '../../stores/useDashboardStore';

const { Text } = Typography;

// Strip UUID data-source prefix from table IDs: "uuid__sheet_name" → "sheet_name"
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__/i;
function shortTableName(id: string): string {
  return id.replace(UUID_PREFIX_RE, '');
}

function bareTableName(value?: string | null): string {
  if (!value) return '';
  return value.split('.').pop()?.trim().toLowerCase() || value.trim().toLowerCase();
}

function fieldRefParts(value: unknown): [string, string] {
  if (typeof value !== 'string') return ['', ''];
  const parts = value.split('.').map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length < 2) return ['', parts[0] || ''];
  return [bareTableName(parts[parts.length - 2]), parts[parts.length - 1]];
}

type RelationshipJoin = NonNullable<NonNullable<WidgetInstance['chartQuery']>['joins']>[number] & {
  relationship_id?: string;
};

function joinMatchesRelationship(join: RelationshipJoin, relationship: DataModelRelationship): boolean {
  if (!join || typeof join !== 'object') return false;
  const relationshipId = join.relationshipId || join.relationship_id;
  if (relationshipId && String(relationshipId) === String(relationship.id)) return true;

  let left: unknown;
  let right: unknown;
  if (typeof join.on === 'string' && join.on.includes('=')) {
    [left, right] = join.on.split('=').map((part: string) => part.trim());
  } else if (join.on && typeof join.on === 'object') {
    left = join.on.left;
    right = join.on.right;
  } else {
    return false;
  }

  const fromRef: [string, string] = [
    bareTableName(relationship.from_table),
    relationship.from_column.trim().toLowerCase(),
  ];
  const toRef: [string, string] = [
    bareTableName(relationship.to_table),
    relationship.to_column.trim().toLowerCase(),
  ];
  const leftRef = fieldRefParts(left);
  const rightRef = fieldRefParts(right);
  return (
    (leftRef[0] === fromRef[0] && leftRef[1] === fromRef[1] && rightRef[0] === toRef[0] && rightRef[1] === toRef[1]) ||
    (leftRef[0] === toRef[0] && leftRef[1] === toRef[1] && rightRef[0] === fromRef[0] && rightRef[1] === fromRef[1])
  );
}

function removeRelationshipJoinsFromOpenDashboard(relationship: DataModelRelationship) {
  useDashboardStore.setState((state) => {
    let changed = false;
    const cleanWidget = (widget: WidgetInstance): WidgetInstance => {
      const joins = widget.chartQuery?.joins;
      if (!Array.isArray(joins) || joins.length === 0) return widget;
      const nextJoins = joins.filter((join) => !joinMatchesRelationship(join, relationship));
      if (nextJoins.length === joins.length) return widget;
      changed = true;
      return {
        ...widget,
        chartQuery: {
          ...widget.chartQuery,
          joins: nextJoins,
        },
      };
    };

    const widgets = state.widgets.map(cleanWidget);
    const dashboards = state.dashboards.map((dashboard) => ({
      ...dashboard,
      widgets: dashboard.widgets.map(cleanWidget),
    }));

    return changed ? { widgets, dashboards } : state;
  });
}

interface RelationshipDetailsPanelProps {
  relationship: DataModelRelationship;
  onClose: () => void;
}

const CARDINALITY_OPTIONS = [
  { value: 'one_to_one', label: 'One to One (1:1)' },
  { value: 'one_to_many', label: 'One to Many (1:*)' },
  { value: 'many_to_many', label: 'Many to Many (*:*)' },
];

export function RelationshipDetailsPanel({ relationship, onClose }: RelationshipDetailsPanelProps) {
  const [cardinality, setCardinality] = useState(relationship.cardinality);
  const [crossFilter, setCrossFilter] = useState(relationship.cross_filter_direction);
  const [isActive, setIsActive] = useState(relationship.is_active);
  const [assumeIntegrity, setAssumeIntegrity] = useState(relationship.assume_integrity);

  useEffect(() => {
    setCardinality(relationship.cardinality);
    setCrossFilter(relationship.cross_filter_direction);
    setIsActive(relationship.is_active);
    setAssumeIntegrity(relationship.assume_integrity);
  }, [
    relationship.id,
    relationship.cardinality,
    relationship.cross_filter_direction,
    relationship.is_active,
    relationship.assume_integrity,
  ]);

  const updateMutation = useUpdateRelationship(relationship.data_source_id);
  const deleteMutation = useDeleteRelationship(relationship.data_source_id);

  const handleSave = async () => {
    await updateMutation.mutateAsync({
      id: relationship.id,
      payload: {
        cardinality,
        cross_filter_direction: crossFilter,
        is_active: isActive,
        assume_integrity: assumeIntegrity,
      },
    });
    onClose();
  };

  const handleDelete = () => {
    Modal.confirm({
      title: 'Delete relationship?',
      content: `Remove the relationship between ${shortTableName(relationship.from_table)} → ${shortTableName(relationship.to_table)}?`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteMutation.mutateAsync(relationship.id);
        removeRelationshipJoinsFromOpenDashboard(relationship);
        onClose();
      },
    });
  };

  return (
    <div
      style={{
        width: 360,
        minWidth: 360,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ant-color-bg-container)',
        borderLeft: '1px solid var(--ant-color-border)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          minHeight: 68,
          padding: '0 20px',
          borderBottom: '1px solid var(--ant-color-border)',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>Relationship Details</span>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* From → To */}
        <div
          style={{
            background: 'var(--ant-color-primary-bg)',
            border: '1px solid var(--ant-color-primary-border)',
            borderRadius: 6,
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 6,
              background: 'var(--ant-color-info-bg)',
              color: 'var(--ant-color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            <LinkOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15 }}>
              {shortTableName(relationship.from_table)} <ArrowRightOutlined /> {shortTableName(relationship.to_table)}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {relationship.from_column} → {relationship.to_column}
            </Text>
          </div>
        </div>

        {/* Cardinality */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              color: 'var(--ant-color-text-secondary)',
              marginBottom: 6,
              letterSpacing: '0.12em',
            }}
          >
            <SwapOutlined style={{ marginRight: 6 }} />
            Cardinality
          </div>
          <Select
            size="middle"
            style={{ width: '100%' }}
            value={cardinality}
            onChange={setCardinality}
            options={CARDINALITY_OPTIONS}
          />
        </div>

        {/* Cross Filter Direction */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              color: 'var(--ant-color-text-secondary)',
              marginBottom: 6,
              letterSpacing: '0.12em',
            }}
          >
            <FilterOutlined style={{ marginRight: 6 }} />
            Cross Filter Direction
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {(['single', 'both'] as const).map((dir) => (
              <Button
                key={dir}
                size="middle"
                type={crossFilter === dir ? 'primary' : 'default'}
                onClick={() => setCrossFilter(dir)}
              >
                {dir === 'single' ? '→ Single' : '↔ Both'}
              </Button>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div
          style={{
            borderTop: '1px solid var(--ant-color-border)',
            paddingTop: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 13 }}>Make relationship active</span>
          <Switch checked={isActive} onChange={setIsActive} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13 }}>Assume integrity</span>
          <Switch checked={assumeIntegrity} onChange={setAssumeIntegrity} />
        </div>

        <Alert
          type="warning"
          showIcon
          icon={<InfoCircleOutlined />}
          message={`This relationship connects ${shortTableName(relationship.from_table)} to ${shortTableName(relationship.to_table)}.`}
          description="Validate that matching records exist in the target table before using this join in dashboards."
        />

        {updateMutation.isError && (
          <Alert type="error" message="Failed to save. Please try again." showIcon />
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--ant-color-border)',
          display: 'flex',
          gap: 12,
        }}
      >
        <Button
          size="middle"
          style={{ flex: 1 }}
          loading={deleteMutation.isPending}
          onClick={handleDelete}
        >
          Delete
        </Button>
        <Button
          type="primary"
          size="middle"
          style={{ flex: 1 }}
          loading={updateMutation.isPending}
          onClick={() => void handleSave()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
