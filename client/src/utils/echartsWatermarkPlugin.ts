/**
 * ECharts Watermark Plugin
 * 
 * This plugin uses ECharts' preprocessor API to automatically add watermarks
 * to all charts before rendering. This ensures watermarks appear in:
 * - Displayed charts
 * - Exported charts (PNG, SVG, etc.)
 * - All chart operations
 * 
 * The preprocessor runs before chart rendering, ensuring the watermark
 * is part of the chart's option configuration.
 */

import * as echarts from 'echarts';
import { getWatermarkGraphicElement } from './watermark';

let watermarkPluginInstalled = false;
let currentPlanType: string | null | undefined = null;

/**
 * Install the watermark preprocessor plugin
 * This should be called once when the app initializes
 */
export function installWatermarkPlugin(planType?: string | null) {
  if (watermarkPluginInstalled) {
    // Update plan type if plugin already installed
    currentPlanType = planType;
    return;
  }

  // Register preprocessor that runs before chart rendering
  // This runs for ALL charts, ensuring watermark is always included
  echarts.registerPreprocessor(function (option: any) {
    try {
      // Skip if option is null/undefined
      if (!option || typeof option !== 'object') {
        return;
      }

      // Check if watermark should be applied
      // TEMP: DISABLED to fix blank chart issue - will re-enable after investigation
      // TODO: Change back to: const shouldApply = !currentPlanType || currentPlanType === 'free';
      const shouldApply = false; // TEMP: DISABLED - chart is blank when enabled
      
      if (!shouldApply) {
        // console.log('🚫 Watermark skipped - plan type:', currentPlanType);
        return; // Don't add watermark for Pro+ plans
      }

      // Ensure graphics array exists
      if (!option.graphic) {
        option.graphic = [];
      } else if (!Array.isArray(option.graphic)) {
        option.graphic = [];
      }

      // Remove any existing watermark (group or legacy)
      option.graphic = option.graphic.filter(
        (g: any) =>
          g &&
          g.id !== 'aiser-watermark-group' &&
          g.id !== 'aiser-watermark-inner' &&
          g.id !== 'aiser-watermark' &&
          g.id !== 'aiser-watermark-text'
      );

      const watermarkEl = getWatermarkGraphicElement(undefined);
      if (watermarkEl) {
        watermarkEl.z = 10000;
        option.graphic.push(watermarkEl);
      }

      console.log('✅ Watermark preprocessor: Added center-middle (logo + Aicser below)', {
        graphicsCount: option.graphic.length,
        planType: currentPlanType,
      });
    } catch (error) {
      // CRITICAL: Don't break chart rendering if watermark fails
      console.error('❌ Watermark preprocessor error (non-blocking):', error);
      // Don't throw - let chart render without watermark
    }
  });

  watermarkPluginInstalled = true;
  currentPlanType = planType;
  console.log('✅ ECharts watermark plugin installed');
}

/**
 * Update the plan type for watermark filtering
 */
export function updateWatermarkPlanType(planType: string | null | undefined) {
  currentPlanType = planType;
}

/**
 * Uninstall the watermark plugin (for testing or if needed)
 */
export function uninstallWatermarkPlugin() {
  // Note: ECharts doesn't provide an unregister method for preprocessors
  // This is mainly for reference - the plugin stays active once installed
  watermarkPluginInstalled = false;
  currentPlanType = null;
  console.log('⚠️ Watermark plugin uninstalled (preprocessor remains active)');
}

