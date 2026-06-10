/**
 * Watermark Utility
 * Adds Aicser logo + text watermark. Uses DOM overlay for reliable center alignment.
 */

import { EChartsOption } from 'echarts';

export const shouldApplyWatermark = (planType: string | null | undefined): boolean => {
  return !planType || planType === 'free';
};

export interface WatermarkOptions {
  isDark?: boolean;
}

const LOGO_SIZE = 64;
const GAP = -2;
const TEXT_FONT_SIZE = 12;

export { WatermarkOverlay } from './watermark-overlay';

/** ECharts graphic (fallback for canvas-only contexts). Logo + text, centered on the chart area. */
export function getWatermarkGraphicElement(options?: WatermarkOptions): any {
  const isDark = options?.isDark;
  const textFill =
    isDark === true ? 'rgba(220,220,220,0.65)'
    : isDark === false ? 'rgba(60,60,60,0.75)'
    : 'rgba(128,128,128,0.5)';
  const W = LOGO_SIZE;
  const H = LOGO_SIZE + GAP + 16;

  return {
    type: 'group',
    id: 'aiser-watermark-group',
    left: 'center',
    top: 'middle',
    children: [
      {
        type: 'group',
        id: 'aiser-watermark-inner',
        left: -W / 2,
        top: -H / 2,
        width: W,
        height: H,
        children: [
          {
            type: 'image',
            id: 'aiser-watermark',
            left: 0,
            top: 0,
            style: { image: '/aiser-logo.png', width: LOGO_SIZE, height: LOGO_SIZE, opacity: 0.28 },
            silent: true,
          },
          {
            type: 'text',
            id: 'aiser-watermark-text',
            left: 0,
            top: LOGO_SIZE + GAP,
            width: W,
            style: {
              text: 'Aicser',
              fill: textFill,
              fontSize: TEXT_FONT_SIZE,
              fontFamily: 'sans-serif',
              textAlign: 'center',
              textVerticalAlign: 'top',
            },
            silent: true,
          },
        ],
        silent: true,
      },
    ],
    z: 1,
    silent: true,
    zlevel: 0,
  };
}

export interface AddWatermarkOptions extends WatermarkOptions {
  /** When true, skip adding to ECharts (caller uses WatermarkOverlay DOM instead). */
  useOverlay?: boolean;
}

/**
 * Add watermark to ECharts option configuration.
 * When options.useOverlay is true, returns option unchanged (caller uses WatermarkOverlay).
 */
export const addWatermarkToChart = (
  option: EChartsOption,
  planType: string | null | undefined,
  options?: AddWatermarkOptions
): EChartsOption => {
  if (!option || typeof option !== 'object') {
    console.warn('⚠️ Watermark: Invalid option, returning as-is');
    return option;
  }

  if (!shouldApplyWatermark(planType)) {
    return option;
  }

  if (options?.useOverlay) {
    return option;
  }

  try {
    // Create a deep copy to avoid mutating the original
    const optionCopy = JSON.parse(JSON.stringify(option));

  // Ensure graphics array exists — preserve existing graphic elements
  if (!optionCopy.graphic) {
    optionCopy.graphic = [];
  } else if (!Array.isArray(optionCopy.graphic)) {
    // ECharts accepts graphic as { elements: [...] } or as an array of elements
    const existing = optionCopy.graphic;
    if (existing.elements && Array.isArray(existing.elements)) {
      optionCopy.graphic = [...existing.elements];
    } else if (existing.type) {
      optionCopy.graphic = [existing];
    } else {
      optionCopy.graphic = [];
    }
  }

  // Remove any existing watermark (group or legacy logo/text)
  optionCopy.graphic = optionCopy.graphic.filter(
    (g: any) =>
      g &&
      g.id !== 'aiser-watermark-group' &&
      g.id !== 'aiser-watermark-inner' &&
      g.id !== 'aiser-watermark' &&
      g.id !== 'aiser-watermark-text'
  );

  const watermarkGroup = getWatermarkGraphicElement(options);

  optionCopy.graphic.push(watermarkGroup);
  return optionCopy;
  } catch (error) {
    // CRITICAL: Don't break chart rendering if watermark fails
    console.error('❌ Watermark application error (non-blocking):', error);
    return option; // Return original option if watermark fails
  }
};

/**
 * Remove watermark from ECharts option
 */
export const removeWatermarkFromChart = (option: EChartsOption): EChartsOption => {
  if (option.graphic && Array.isArray(option.graphic)) {
    option.graphic = option.graphic.filter(
      (g: any) =>
        g.id !== 'aiser-watermark-group' &&
        g.id !== 'aiser-watermark-inner' &&
        g.id !== 'aiser-watermark' &&
        g.id !== 'aiser-watermark-text'
    );
  }
  return option;
};
