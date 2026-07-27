/**
 * Stable icon reference stored on widget chartOptions.
 * Never persist React components — only set + name (+ optional color).
 */
export type WidgetIconSet = 'antd' | 'emoji' | 'custom' | 'brand';

export type WidgetIconRef = {
  set: WidgetIconSet;
  /**
   * - antd: registry id (e.g. DollarOutlined)
   * - emoji: single emoji / short sequence
   * - custom: https URL or data:image… URI
   * - brand: brand pack key (logo | emoji | accent-*)
   */
  name: string;
  /** Optional tint for antd / brand accent icons */
  color?: string;
};

export type WidgetIconCategory =
  | 'finance'
  | 'people'
  | 'ops'
  | 'time'
  | 'status'
  | 'charts'
  | 'media'
  | 'general';

export type DashboardIconCatalogEntry = {
  id: string;
  set: 'antd';
  category: WidgetIconCategory;
  keywords: string[];
  label: string;
};

export function isWidgetIconRef(value: unknown): value is WidgetIconRef {
  if (!value || typeof value !== 'object') return false;
  const v = value as WidgetIconRef;
  return (
    (v.set === 'antd' || v.set === 'emoji' || v.set === 'custom' || v.set === 'brand') &&
    typeof v.name === 'string' &&
    v.name.trim().length > 0
  );
}

/** Normalize legacy iconName string or new icon object into WidgetIconRef. */
export function normalizeWidgetIcon(
  icon?: unknown,
  legacyIconName?: unknown,
): WidgetIconRef | null {
  if (isWidgetIconRef(icon)) {
    return {
      set: icon.set,
      name: String(icon.name).trim(),
      color: typeof icon.color === 'string' && icon.color.trim() ? icon.color.trim() : undefined,
    };
  }
  if (typeof legacyIconName === 'string' && legacyIconName.trim()) {
    const name = legacyIconName.trim();
    // Emoji-looking legacy values
    if (/^\p{Extended_Pictographic}/u.test(name) || name.length <= 4 && /\p{Emoji}/u.test(name)) {
      return { set: 'emoji', name };
    }
    if (/^(https?:|data:image\/)/i.test(name)) {
      return { set: 'custom', name };
    }
    return { set: 'antd', name };
  }
  return null;
}
