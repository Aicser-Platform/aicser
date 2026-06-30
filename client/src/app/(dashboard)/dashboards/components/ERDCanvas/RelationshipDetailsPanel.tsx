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

const { Text } = Typography;

// Strip UUID data-source prefix from table IDs: "uuid__sheet_name" → "sheet_name"
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__/i;
function shortTableName(id: string): string {
  return id.replace(UUID_PREFIX_RE, '');
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
