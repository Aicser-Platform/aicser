import type { CSSProperties } from 'react';
import { fontStack } from '@/lib/office/fonts';
import { PX_PER_PT, elementColor, elementFont, type SlideElement, type Theme } from './model';

/** PowerPoint's default text inset: 0.1 in left/right, 0.05 in top/bottom. */
export const TEXT_INSET = { x: 9.6, y: 4.8 };

export function textBoxStyle(el: SlideElement, theme: Theme): CSSProperties {
  return {
    fontFamily: fontStack(elementFont(el, theme)),
    fontSize: el.style.fontSize * PX_PER_PT,
    color: elementColor(el, theme),
    fontWeight: el.style.bold ? 700 : 400,
    fontStyle: el.style.italic ? 'italic' : 'normal',
    textDecoration: el.style.underline ? 'underline' : 'none',
    textAlign: el.style.align,
    lineHeight: 1.2,
    padding: `${TEXT_INSET.y}px ${TEXT_INSET.x}px`,
  };
}
