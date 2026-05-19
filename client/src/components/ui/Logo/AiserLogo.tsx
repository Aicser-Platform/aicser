'use client';

import React from 'react';
import Image from 'next/image';

interface AiserLogoProps {
    size?: number;
    className?: string;
    showText?: boolean;
    text?: string;
}

const AiserLogo: React.FC<AiserLogoProps> = ({ 
    size = 40, 
    className = '',
    showText = true,
    text = 'Aicser',
}) => {
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
                alt="Aicser Logo"
                width={size}
                height={size}
                style={{ borderRadius: '8px' }}
                priority
            />
            {showText && (
                <span style={{ 
                    fontSize: text.length > 12 ? '15px' : '18px',
                    fontWeight: 600, 
                    fontFamily: 'var(--font-sans)',
                    color: 'var(--color-text-primary)', // Use design system text color
                    lineHeight: '1.2',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                }} className="aicser-text">
                    {text}
                </span>
            )}
        </div>
    );
};

export default AiserLogo;
