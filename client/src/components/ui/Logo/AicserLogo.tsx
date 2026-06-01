'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';

interface AicserLogoProps {
    size?: number;
    className?: string;
    showText?: boolean;
    text?: string;
}

const AicserLogo: React.FC<AicserLogoProps> = ({
    size = 40,
    className = '',
    showText = true,
    text,
}) => {
    const t = useTranslations('common');
    const displayName = text || t('brand_name');

    return (
        <div
            className={className}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: 0,
            }}
        >
            <Image
                src="/aiser-logo.png"
                alt={t('brand_logo_alt')}
                width={size}
                height={size}
                style={{ borderRadius: '8px' }}
                priority
            />
            {showText && (
                <span style={{
                    fontSize: displayName.length > 12 ? '15px' : '18px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    color: 'var(--color-text-primary)', // Use design system text color
                    lineHeight: '1.2',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                }} className="aicser-text">
                    {displayName}
                </span>
            )}
        </div>
    );
};

export default AicserLogo;
