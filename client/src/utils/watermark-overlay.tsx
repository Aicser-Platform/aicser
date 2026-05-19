/**
 * Watermark DOM overlay component - logo + "Aicser" centered with CSS flexbox.
 */

import React from 'react';

const LOGO_SIZE = 64;
const GAP = -10;
const TEXT_FONT_SIZE = 12;

export interface WatermarkOverlayProps {
  isDark?: boolean;
  /** When false, render on top of chart (zIndex 10); when true, behind (zIndex 0). Default false = on top so logo+text are visible. */
  behind?: boolean;
}

export function WatermarkOverlay({ isDark, behind = false }: WatermarkOverlayProps) {
  const textColor =
    isDark === true ? 'rgba(220,220,220,0.5)'
    : isDark === false ? 'rgba(60,60,60,0.55)'
    : 'rgba(128,128,128,0.45)';

  return (
    <div
      className="aiser-watermark-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: behind ? 0 : 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: GAP,
        }}
      >
        <img
          src="/aiser-logo.png"
          alt=""
          width={LOGO_SIZE}
          height={LOGO_SIZE}
          style={{ opacity: 0.3 }}
        />
        <span
          style={{
            fontSize: TEXT_FONT_SIZE,
            fontFamily: 'sans-serif',
            color: textColor,
          }}
        >
          Aicser
        </span>
      </div>
    </div>
  );
}
