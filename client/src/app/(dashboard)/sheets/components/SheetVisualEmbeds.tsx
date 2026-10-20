'use client';

import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { SharedChartRenderer } from '@/components/charts/SharedChartRenderer';
import type { SheetVisualEmbed } from './sheetVisualEmbed';

type Props = {
  embeds: SheetVisualEmbed[];
  activeSheetIndex: number;
  /** Map sheet index → grid host element for positioning (same parent as overlays). */
  gridHost: HTMLDivElement | null;
  readOnly?: boolean;
  onRemove?: (id: string) => void;
  /** Double-click a floated chart to reopen Analyze with its field layout. */
  onOpenChart?: (embed: SheetVisualEmbed) => void;
};

/** Charts and images floated above the grid, anchored to sheet cells (Excel-style). */
export function SheetVisualEmbeds({
  embeds,
  activeSheetIndex,
  gridHost,
  readOnly,
  onRemove,
  onOpenChart,
}: Props) {
  const t = useTranslations('sheets');
  const visible = useMemo(
    () => embeds.filter((e) => e.sheet_index === activeSheetIndex),
    [embeds, activeSheetIndex],
  );

  if (!gridHost || !visible.length) return null;

  return (
    <>
      {visible.map((embed) => (
        <div
          key={embed.id}
          className="wb-visual-embed"
          style={{
            position: 'absolute',
            left: 12 + (embed.column - 1) * 96,
            top: 72 + (embed.row - 1) * 22,
            width: embed.width,
            height: embed.height,
            zIndex: 12,
            pointerEvents: 'auto',
          }}
        >
          {!readOnly && onRemove ? (
            <Button
              type="text"
              size="small"
              className="wb-visual-embed__close"
              icon={<CloseOutlined />}
              aria-label="Remove"
              onClick={() => onRemove(embed.id)}
            />
          ) : null}
          {embed.kind === 'image' && typeof embed.payload.src === 'string' ? (
            <img
              src={embed.payload.src}
              alt={String(embed.payload.alt ?? 'Sheet image')}
              style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6 }}
            />
          ) : null}
          {embed.kind === 'chart' && embed.payload.chartType && embed.payload.chartData ? (
            <div
              className="wb-visual-embed__chart"
              role="button"
              tabIndex={0}
              title={onOpenChart ? t('chart_embed_edit_hint') : undefined}
              onDoubleClick={() => onOpenChart?.(embed)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onOpenChart?.(embed);
              }}
            >
              <SharedChartRenderer
                chartType={String(embed.payload.chartType)}
                chartData={embed.payload.chartData as { x: string[]; series: { name: string; data: number[]; type?: string }[] }}
                chartOptions={{ title: String(embed.payload.title ?? '') }}
                minHeight={embed.height - 8}
              />
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}
