import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useMemo } from 'react'
import { useDashboardStore } from '@/stores/useDashboardStore'

export function useVirtualDashboard() {
  const widgets = useDashboardStore(s => s.widgets)
  const parentRef = useRef<HTMLDivElement>(null)
  
  // Group widgets by row for virtualization
  const rows = useMemo(() => {
    if (widgets.length === 0) return []
    
    const rowHeight = 300
    const maxRow = Math.max(...widgets.map(w => w.position.y + w.position.h))
    return Array.from({ length: maxRow + 1 }, (_, i) => 
      widgets.filter(w => w.position.y <= i && w.position.y + w.position.h > i)
    )
  }, [widgets])
  
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 300,
    overscan: 5,
  })
  
  return {
    parentRef,
    virtualizer,
    rows,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
  }
}
