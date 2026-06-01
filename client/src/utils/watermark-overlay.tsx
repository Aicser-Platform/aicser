/**
 * Watermark DOM overlay component - logo + "Aicser" centered with CSS flexbox.
 */

import React from 'react';

const LOGO_SIZE = 64;
const CORNER_LOGO_SIZE = 28;
const GAP = -10;
const TEXT_FONT_SIZE = 12;

export type WatermarkVariant = 'center' | 'corner';

export interface WatermarkOverlayProps {
  isDark?: boolean;
  /** When true, sit under the chart layer (visible in gaps only). When false, centered on top but non-interactive. */
  behind?: boolean;
  variant?: WatermarkVariant;
  /** Softer/smaller center mark for dashboard widget cards */
  subtle?: boolean;
}

export function WatermarkOverlay({
  isDark,
  behind = false,
  variant = 'center',
  subtle = false,
}: WatermarkOverlayProps) {
  const textColor =
    isDark === true ? 'rgba(220,220,220,0.5)'
    : isDark === false ? 'rgba(60,60,60,0.55)'
    : 'rgba(128,128,128,0.45)';

  if (variant === 'corner') {
    return (
      <div
        className="aiser-watermark-overlay aiser-watermark-corner"
        style={{
          position: 'absolute',
          right: 8,
          bottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          pointerEvents: 'none',
          zIndex: behind ? 0 : 1,
          opacity: 0.35,
        }}
        aria-hidden
      >
        <img
          src="/aiser-logo.png"
          alt=""
          width={CORNER_LOGO_SIZE}
          height={CORNER_LOGO_SIZE}
          style={{ display: 'block' }}
        />
        <span
          style={{
            fontSize: 10,
            fontFamily: 'sans-serif',
            color: textColor,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          Aicser
        </span>
      </div>
    );
  }

  const logoSize = subtle ? 48 : LOGO_SIZE;
  const logoOpacity = subtle ? 0.16 : 0.3;
  const textOpacity = subtle ? 0.45 : 1;

  return (
    <div
      className={`aiser-watermark-overlay${subtle ? ' aiser-watermark-subtle' : ''}`}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: behind ? 0 : 2,
        userSelect: 'none',
      }}
      aria-hidden
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: subtle ? -6 : GAP,
          pointerEvents: 'none',
        }}
      >
        <img
          src="/aiser-logo.png"
          alt=""
          width={logoSize}
          height={logoSize}
          draggable={false}
          style={{ opacity: logoOpacity, pointerEvents: 'none' }}
        />
        <span
          style={{
            fontSize: subtle ? 11 : TEXT_FONT_SIZE,
            fontFamily: 'sans-serif',
            color: textColor,
            opacity: textOpacity,
            pointerEvents: 'none',
          }}
        >
          Aicser
        </span>
      </div>
    </div>
  );
}
