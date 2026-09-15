import React from 'react';

export interface BookmarkIconProps {
  /** Solid fill for the "already saved" state — mirrors antd's Outlined/Filled icon pairs (e.g. StarOutlined/StarFilled). */
  filled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * @ant-design/icons has no bookmark glyph (only BookOutlined, an open book -
 * a different concept, still correctly used elsewhere for "knowledge/docs").
 * Authored as a plain inline SVG rather than pulling in a second icon
 * library for one icon; sized/colored the same way antd's own icon
 * components are (1em, currentColor) so it drops in wherever BookOutlined
 * used to be.
 */
export function BookmarkIcon({ filled = false, className, style }: BookmarkIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinejoin="round"
      className={className}
      style={{ display: 'inline-block', verticalAlign: '-0.125em', ...style }}
      aria-hidden
    >
      <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.2-7 4.2V4.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}
