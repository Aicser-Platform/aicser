/** Pie/donut layout tuned for dashboard widget cards (legend + compact height). */
export function getPieLayout(
  legendPos: string,
  compact = false
): { center: [string, string]; outerRadius: string } {
  const outerRadius = compact ? '55%' : '68%';

  switch (legendPos) {
    case 'left':
      return { center: [compact ? '58%' : '60%', '52%'], outerRadius };
    case 'right':
      return { center: [compact ? '42%' : '40%', '52%'], outerRadius };
    case 'bottom':
      // Legend below — shift pie upward
      return { center: ['50%', compact ? '42%' : '44%'], outerRadius };
    case 'top':
      // Legend above — keep pie in lower canvas without clipping bottom edge
      return { center: ['50%', compact ? '52%' : '50%'], outerRadius };
    default:
      return { center: ['50%', '50%'], outerRadius: compact ? '58%' : '70%' };
  }
}

export function getChartSliceBorderColor(): string {
  if (typeof window === 'undefined') return '#ffffff';
  const cardBg = getComputedStyle(document.documentElement).getPropertyValue('--studio-card-bg').trim();
  if (cardBg) return cardBg;
  return document.documentElement.classList.contains('dark') ? '#161b22' : '#ffffff';
}
