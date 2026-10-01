/**
 * Chart text as the author styled it (Format → Text): one font, size and color for all chart
 * text, with optional overrides for axis labels, data labels and the legend. The card title is
 * styled by the card itself (titleColor / titleSize / titleBold).
 */

type AnyOption = Record<string, any>;

export type TextSize = 'small' | 'medium' | 'large';

export type TextStyleConfig = {
  textFont?: string;
  textSize?: TextSize;
  textColor?: string;
  axisTextColor?: string;
  axisTextSize?: number;
  dataLabelColor?: string;
  dataLabelSize?: number;
  dataLabelBold?: boolean;
  legendTextColor?: string;
  legendTextSize?: number;
};

/** Font choices, each ending in generic families so every script (Khmer, Thai, CJK) still renders. */
export const TEXT_FONTS: Record<string, string> = {
  default: '',
  sans: 'Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  mono: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", sans-serif',
};

const SCALE: Record<TextSize, number> = { small: 0.9, medium: 1, large: 1.2 };

const scaled = (size: unknown, scale: number) =>
  typeof size === 'number' && scale !== 1 ? Math.round(size * scale * 10) / 10 : size;

export function hasTextStyles(c: TextStyleConfig): boolean {
  return Boolean(
    (c.textFont && c.textFont !== 'default') ||
      (c.textSize && c.textSize !== 'medium') ||
      c.textColor ||
      c.axisTextColor ||
      c.axisTextSize ||
      c.dataLabelColor ||
      c.dataLabelSize ||
      c.dataLabelBold ||
      c.legendTextColor ||
      c.legendTextSize,
  );
}

export function applyTextStyles(option: AnyOption, config: TextStyleConfig): AnyOption {
  if (!option || !hasTextStyles(config)) return option;
  const scale = SCALE[config.textSize || 'medium'] ?? 1;
  const fontFamily = TEXT_FONTS[config.textFont || 'default'] || undefined;
  const next: AnyOption = { ...option };
  if (fontFamily) next.textStyle = { ...(option.textStyle || {}), fontFamily };

  const axisColor = config.axisTextColor || config.textColor;
  const patchAxis = (axis: AnyOption) =>
    axis
      ? {
          ...axis,
          axisLabel: axis.axisLabel
            ? {
                ...axis.axisLabel,
                fontSize: config.axisTextSize ?? scaled(axis.axisLabel.fontSize, scale),
                ...(axisColor ? { color: axisColor } : {}),
                ...(fontFamily ? { fontFamily } : {}),
              }
            : axis.axisLabel,
          nameTextStyle: {
            ...(axis.nameTextStyle || {}),
            fontSize: scaled(axis.nameTextStyle?.fontSize ?? 12, scale),
            ...(axisColor ? { color: axisColor } : {}),
            ...(fontFamily ? { fontFamily } : {}),
          },
        }
      : axis;
  for (const key of ['xAxis', 'yAxis'] as const) {
    if (Array.isArray(option[key])) next[key] = option[key].map(patchAxis);
    else if (option[key]) next[key] = patchAxis(option[key]);
  }

  const legendColor = config.legendTextColor || config.textColor;
  const patchLegend = (legend: AnyOption) =>
    legend
      ? {
          ...legend,
          textStyle: {
            ...(legend.textStyle || {}),
            fontSize: config.legendTextSize ?? scaled(legend.textStyle?.fontSize ?? 12, scale),
            ...(legendColor ? { color: legendColor } : {}),
            ...(fontFamily ? { fontFamily } : {}),
          },
        }
      : legend;
  if (Array.isArray(option.legend)) next.legend = option.legend.map(patchLegend);
  else if (option.legend) next.legend = patchLegend(option.legend);

  if (Array.isArray(option.series)) {
    next.series = option.series.map((s: AnyOption) => {
      if (!s?.label) return s;
      // Labels drawn on a bar keep their white-on-color unless the author picked a label color.
      const onBar = s.label.textBorderWidth > 0 && s.label.color === '#fff';
      const color = config.dataLabelColor || (onBar ? undefined : config.textColor);
      return {
        ...s,
        label: {
          ...s.label,
          fontSize: config.dataLabelSize ?? scaled(s.label.fontSize ?? 11, scale),
          ...(color ? { color } : {}),
          ...(config.dataLabelBold ? { fontWeight: 'bold' } : {}),
          ...(fontFamily ? { fontFamily } : {}),
        },
      };
    });
  }
  return next;
}
