'use client';

import React, { createContext, useContext, useMemo } from 'react';

/**
 * The colour palette of the dashboard a widget is drawn in. Each surface (studio canvas,
 * shared/embed viewer, a feed post) provides its own dashboard's palette, captured palette for
 * snapshots, so a widget never borrows the palette of whatever dashboard is open in the studio.
 * No provider = no dashboard palette (the chart's own palette or the default).
 */
const DashboardPaletteContext = createContext<string | undefined>(undefined);

export function DashboardPaletteProvider({
  palette,
  children,
}: {
  palette: string | undefined | null;
  children: React.ReactNode;
}) {
  const value = useMemo(() => palette || undefined, [palette]);
  return <DashboardPaletteContext.Provider value={value}>{children}</DashboardPaletteContext.Provider>;
}

export function useDashboardPalette(): string | undefined {
  return useContext(DashboardPaletteContext);
}
