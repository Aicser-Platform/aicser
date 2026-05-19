'use client';

import Image from 'next/image';
import React from 'react';

interface AiserAIIconProps {
  size?: number;
  withGlow?: boolean;
  className?: string;
}

const AiserAIIcon: React.FC<AiserAIIconProps> = ({ size = 28, withGlow = false, className }) => {
  const dimension = `${size}px`;
  return (
    <span
      className={className}
      style={{
        width: dimension,
        height: dimension,
        minWidth: dimension,
        minHeight: dimension,
        borderRadius: '10px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        boxShadow: withGlow
          ? '0 0 16px rgba(0, 194, 203, 0.35), 0 4px 12px rgba(0, 0, 0, 0.2)'
          : 'none',
        border: '1px solid rgba(255,255,255,0.35)',
        background: 'linear-gradient(135deg, #030712 0%, #0b162e 100%)'
      }}
    >
      <Image
        src="/aiser-logo.png"
        alt="Aicser AI"
        width={size}
        height={size}
        style={{ objectFit: 'cover' }}
        priority
      />
    </span>
  );
};

export default AiserAIIcon;

