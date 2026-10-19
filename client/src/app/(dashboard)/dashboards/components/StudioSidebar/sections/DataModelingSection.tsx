'use client';

import React from 'react';
import type { DataModelRelationship } from '@/api/dataModel';
import { DataModelWorkbenchPanel } from '@/components/data/DataModelWorkbenchPanel';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';

export interface DataModelingSectionProps {
  onRelationshipSelect: (rel: DataModelRelationship | null) => void;
  selectedRelationshipId: string | null;
}

export function DataModelingSection({
  onRelationshipSelect,
  selectedRelationshipId,
}: DataModelingSectionProps) {
  const focusSourceId = useDataSourceStore((s) => s.selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <DataModelWorkbenchPanel
        primarySourceId={focusSourceId}
        scope="single"
        showProjectScopeToggle={isEnterpriseEdition}
        defaultProjectCanvas={isEnterpriseEdition}
        variant="sidebar"
        onRelationshipSelect={onRelationshipSelect}
        selectedRelationshipId={selectedRelationshipId}
        canvasMinHeight={320}
      />
    </div>
  );
}
