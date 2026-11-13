'use client';

import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/aicser-ui/button';
import { Slider } from '@/components/aicser-ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_PRESETS, clampZoom } from '@/lib/office/zoom';

/** Excel's zoom at the bottom right: −, a slider, +, and the percentage (presets). */
export function ZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  const percent = Math.round(zoom * 100);
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Zoom">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => onZoom(clampZoom(zoom - 0.1))}
      >
        <Minus />
      </Button>
      {/* Radix slider, not <input type="range">: WebKit scrolled the grid when the native one was on the page. */}
      <Slider
        thumbLabel="Zoom level"
        className="w-24"
        min={ZOOM_MIN * 100}
        max={ZOOM_MAX * 100}
        step={10}
        value={[percent]}
        onValueChange={([value]) => value !== undefined && onZoom(clampZoom(value / 100))}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => onZoom(clampZoom(zoom + 0.1))}
      >
        <Plus />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-12 px-1 text-xs tabular-nums" aria-label="Zoom presets">
            {percent}%
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ZOOM_PRESETS.map((z) => (
            <DropdownMenuItem key={z} onSelect={() => onZoom(z)}>
              {Math.round(z * 100)}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
