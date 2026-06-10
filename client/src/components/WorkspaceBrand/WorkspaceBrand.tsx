'use client';

import React from 'react';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { getOrganizationBranding, getOrganizationInitial } from '@/utils/orgBranding';

type WorkspaceBrandProps = {
  /** Icon-only when sidebar is collapsed to rail */
  compact?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  onClick?: () => void;
};

export function WorkspaceBrand({
  compact = false,
  size = 'md',
  className,
  onClick,
}: WorkspaceBrandProps) {
  const currentOrganization = useOrganizationStore((s) => s.currentOrganization);
  const { logoUrl, name } = getOrganizationBranding(currentOrganization);

  const iconSize = compact ? (size === 'sm' ? 20 : 32) : size === 'sm' ? 24 : 36;
  const fontSize = size === 'sm' ? 13 : 15;

  const content = (
    <>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={name || 'Organization'}
          style={{
            width: iconSize,
            height: iconSize,
            objectFit: 'contain',
            borderRadius: 6,
            flexShrink: 0,
            background: 'var(--ant-color-fill-quaternary)',
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: iconSize,
            height: iconSize,
            borderRadius: 6,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.round(iconSize * 0.42),
            fontWeight: 700,
            color: 'var(--ant-color-primary)',
            background: 'var(--ant-color-primary-bg)',
          }}
        >
          {getOrganizationInitial(name)}
        </span>
      )}
      {!compact && name ? (
        <span
          style={{
            fontSize,
            fontWeight: 600,
            color: 'var(--ant-color-text)',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {name}
        </span>
      ) : null}
    </>
  );

  const sharedStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: compact ? 0 : 8,
    minWidth: 0,
    width: compact ? 'auto' : '100%',
    justifyContent: compact ? 'center' : 'flex-start',
  };

  if (onClick) {
    return (
      <button
        type="button"
        className={className ? `${className} workspace-brand-btn` : 'workspace-brand-btn'}
        onClick={onClick}
        title={name || undefined}
        style={{
          ...sharedStyle,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: compact ? 0 : '0 4px',
          borderRadius: 6,
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={className} style={sharedStyle} title={compact ? name || undefined : undefined}>
      {content}
    </div>
  );
}
