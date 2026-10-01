/**
 * The words around a chart (Datawrapper's model), read the same way on every surface and in
 * exports: a description under the title, and one source / notes line under the chart.
 */

type Options = Record<string, unknown> | null | undefined;

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function chartDescription(options: Options): string {
  return text(options?.subtitle);
}

/** Source / notes. Charts saved with the old "Brand footer" (Format → Design) keep showing it. */
export function chartSource(options: Options): string {
  const design = options?.design as { brand?: { footer?: unknown } } | undefined;
  return text(options?.sourceNote) || text(design?.brand?.footer);
}

/** Writing the source replaces a legacy brand footer, so the chart never shows two. */
export function sourcePatch(options: Options, sourceNote: string | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(options || {}), sourceNote };
  const design = options?.design as { brand?: Record<string, unknown> } | undefined;
  if (design?.brand && 'footer' in design.brand) {
    const { footer: _drop, ...brand } = design.brand;
    next.design = { ...design, brand };
  }
  return next;
}

/** The card title's style from the chart's Text settings (same on canvas, viewer and feed). */
export function cardTitleStyle(options: Options): Record<string, string | number> {
  const o = (options || {}) as Record<string, unknown>;
  const fonts: Record<string, string> = {
    sans: 'Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
    mono: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
    rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", sans-serif',
  };
  const style: Record<string, string | number> = {};
  if (typeof o.titleColor === 'string' && o.titleColor) style.color = o.titleColor;
  if (typeof o.titleSize === 'number') style.fontSize = o.titleSize;
  if (o.titleBold === false) style.fontWeight = 500;
  else if (typeof o.titleFontWeight === 'string' || typeof o.titleFontWeight === 'number') style.fontWeight = o.titleFontWeight as string;
  const family = typeof o.textFont === 'string' ? fonts[o.textFont] : undefined;
  if (family) style.fontFamily = family;
  return style;
}
