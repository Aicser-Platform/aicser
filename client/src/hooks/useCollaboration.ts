import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useDashboardStore } from '@/stores/useDashboardStore'
import { useAuthStore as useAuth } from '@/stores/useAuthStore'
import { debounce } from 'lodash'

export function useCollaboration(dashboardId: string) {
  const socketRef = useRef<Socket | null>(null)
  const { user } = useAuth()
  const applyRemoteUpdate = useDashboardStore(s => s.applyRemoteUpdate)
  
  useEffect(() => {
    if (!dashboardId) return
    
    // Connect to Socket.io
    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    })
    
    socketRef.current = socket
    
    // Join dashboard room
    socket.emit('join_dashboard', {
      dashboard_id: dashboardId,
      user: {
        id: user?.id,
        name: (user?.user_metadata as any)?.username || user?.email,
        email: user?.email,
      }
    })
    
    // Listen for remote updates
    socket.on('widget:update', (data) => {
      console.log('Remote widget update:', data)
      applyRemoteUpdate({
        type: 'widget:update',
        id: data.widget_id,
        changes: data.changes,
      })
    })
    
    socket.on('widget:add', (data) => {
      console.log('Remote widget add:', data)
      applyRemoteUpdate({
        type: 'widget:add',
        widget: data.widget,
      })
    })
    
    socket.on('widget:remove', (data) => {
      console.log('Remote widget remove:', data)
      applyRemoteUpdate({
        type: 'widget:remove',
        id: data.widget_id,
      })
    })
    
    socket.on('user:joined', (data) => {
      console.log('User joined:', data)
      // Show notification or update presence indicator
    })
    
    socket.on('user:left', (data) => {
      console.log('User left:', data)
    })
    
    // Subscribe to local Zustand changes and broadcast
    const unsubscribe = useDashboardStore.subscribe(
      (state) => {
        const widgets = state.widgets;
        debounce((widgets) => {
          // Find what changed
          const changes = computeChanges([], widgets)
          
          changes.forEach(change => {
            switch (change.type) {
              case 'update':
                socket.emit('widget:update', {
                  dashboard_id: dashboardId,
                  widget_id: change.id,
                  changes: change.data,
                })
                break
              case 'add':
                socket.emit('widget:add', {
                  dashboard_id: dashboardId,
                  widget: change.data,
                })
                break
              case 'remove':
                socket.emit('widget:remove', {
                  dashboard_id: dashboardId,
                  widget_id: change.id,
                })
                break
            }
          })
        }, 300)(widgets);
      }
    );
    
    // Cleanup
    return () => {
      socket.emit('leave_dashboard', { dashboard_id: dashboardId })
      socket.disconnect()
      unsubscribe()
    }
  }, [dashboardId, user, applyRemoteUpdate])
  
  return socketRef.current
}

// Helper to compute changes between widget arrays
function computeChanges(prev: any[], current: any[]) {
  const changes: any[] = []
  
  // Detect additions
  current.forEach(widget => {
    if (!prev.find(w => w.id === widget.id)) {
      changes.push({ type: 'add', data: widget })
    }
  })
  
  // Detect removals
  prev.forEach(widget => {
    if (!current.find(w => w.id === widget.id)) {
      changes.push({ type: 'remove', id: widget.id })
    }
  })
  
  // Detect updates
  current.forEach(widget => {
    const prevWidget = prev.find(w => w.id === widget.id)
    if (prevWidget && JSON.stringify(prevWidget) !== JSON.stringify(widget)) {
      changes.push({ type: 'update', id: widget.id, data: widget })
    }
  })
  
  return changes
}
