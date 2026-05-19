'use client';

import React, { memo, useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { debounce, throttle } from 'lodash-es';

// Memory management utilities
export const MemoryManager = {
  // Component cleanup utilities
  cleanup: {
    // Cleanup event listeners
    removeEventListeners: (element: HTMLElement, events: string[]) => {
      events.forEach(event => {
        element.removeEventListener(event, () => {});
      });
    },
    
    // Cleanup timers
    clearTimers: (timers: (NodeJS.Timeout | number)[]) => {
      timers.forEach(timer => {
        if (timer) clearTimeout(timer as NodeJS.Timeout);
      });
    },
    
    // Cleanup subscriptions
    unsubscribe: (subscriptions: (() => void)[]) => {
      subscriptions.forEach(unsubscribe => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    }
  },

  // Performance monitoring
  performance: {
    // Measure component render time
    measureRender: (componentName: string, renderFn: () => React.ReactNode) => {
      const start = performance.now();
      const result = renderFn();
      const end = performance.now();
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`${componentName} render time: ${end - start}ms`);
      }
      
      return result;
    },
    
    // Memory usage tracking
    trackMemoryUsage: (componentName: string) => {
      if (process.env.NODE_ENV === 'development' && 'memory' in performance) {
        const memory = (performance as any).memory;
        console.log(`${componentName} memory usage:`, {
          used: `${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB`,
          total: `${Math.round(memory.totalJSHeapSize / 1024 / 1024)}MB`,
          limit: `${Math.round(memory.jsHeapSizeLimit / 1024 / 1024)}MB`
        });
      }
    }
  }
};

// Optimized hook for debounced state updates
export const useDebouncedState = <T,>(
  initialValue: T,
  delay: number = 300
): [T, T, (value: T) => void] => {
  const [value, setValue] = useState<T>(initialValue);
  const [debouncedValue, setDebouncedValue] = useState<T>(initialValue);

  const debouncedSetValue = useMemo(
    () => debounce((newValue: T) => setDebouncedValue(newValue), delay),
    [delay]
  );

  const updateValue = useCallback((newValue: T) => {
    setValue(newValue);
    debouncedSetValue(newValue);
  }, [debouncedSetValue]);

  useEffect(() => {
    return () => {
      debouncedSetValue.cancel();
    };
  }, [debouncedSetValue]);

  return [value, debouncedValue, updateValue];
};

// Optimized hook for throttled callbacks
export const useThrottledCallback = <T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 100
): T => {
  const throttledCallback = useMemo(
    () => throttle(callback, delay),
    [callback, delay]
  );

  useEffect(() => {
    return () => {
      throttledCallback.cancel();
    };
  }, [throttledCallback]);

  return throttledCallback as unknown as T;
};

// Optimized hook for intersection observer
export const useIntersectionObserver = (
  elementRef: React.RefObject<HTMLElement>,
  options: IntersectionObserverInit = {}
) => {
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      options
    );

    observer.observe(element);

    return () => {
      observer.unobserve(element);
    };
  }, [elementRef, options]);

  return isIntersecting;
};

// Optimized hook for resize observer
export const useResizeObserver = (
  elementRef: React.RefObject<HTMLElement>,
  callback: (size: { width: number; height: number }) => void
) => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        callbackRef.current({ width, height });
      }
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.unobserve(element);
    };
  }, [elementRef]);
};

// Memory-optimized component wrapper
export const withMemoryOptimization = <P extends object>(
  Component: React.ComponentType<P>,
  options: {
    memo?: boolean;
    displayName?: string;
    shouldRerender?: (prevProps: P, nextProps: P) => boolean;
  } = {}
) => {
  const { memo: useMemoFlag = true, displayName, shouldRerender } = options;

  const OptimizedComponent = useMemoFlag ? memo(Component, shouldRerender) : Component;

  if (displayName) {
    (OptimizedComponent as any).displayName = displayName;
  }

  return OptimizedComponent;
};

// Virtual scrolling hook for large lists
export const useVirtualScrolling = (
  itemCount: number,
  itemHeight: number,
  containerHeight: number,
  overscan: number = 5
) => {
  const [scrollTop, setScrollTop] = useState(0);

  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      itemCount - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );
    return { startIndex, endIndex };
  }, [scrollTop, itemHeight, containerHeight, itemCount, overscan]);

  const totalHeight = itemCount * itemHeight;
  const offsetY = visibleRange.startIndex * itemHeight;

  const handleScroll = useThrottledCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, 16); // ~60fps

  return {
    visibleRange,
    totalHeight,
    offsetY,
    handleScroll
  };
};

// Image lazy loading hook
export const useLazyImage = (src: string, placeholder?: string) => {
  const [imageSrc, setImageSrc] = useState(placeholder || '');
  const [isLoaded, setIsLoaded] = useState(false);
  const [isError, setIsError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = new Image();
    
    img.onload = () => {
      setImageSrc(src);
      setIsLoaded(true);
    };
    
    img.onerror = () => {
      setIsError(true);
    };
    
    img.src = src;
  }, [src]);

  return { imageSrc, isLoaded, isError, imgRef };
};

// Component performance profiler
export const PerformanceProfiler: React.FC<{
  id: string;
  children: React.ReactNode;
  onRender?: (id: string, phase: string, actualDuration: number) => void;
}> = memo(({ id, children, onRender }) => {
  const renderCount = useRef(0);
  const startTime = useRef(0);

  useEffect(() => {
    renderCount.current += 1;
    startTime.current = performance.now();
  });

  useEffect(() => {
    const endTime = performance.now();
    const duration = endTime - startTime.current;
    
    if (onRender) {
      onRender(id, 'mount', duration);
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`Component ${id} rendered ${renderCount.current} times, took ${duration}ms`);
    }
  });

  return <>{children}</>;
});

(PerformanceProfiler as any).displayName = 'PerformanceProfiler';

// Memory leak detection hook
export const useMemoryLeakDetection = (componentName: string) => {
  const mountedRef = useRef(true);
  const subscriptionsRef = useRef<(() => void)[]>([]);
  const timersRef = useRef<(NodeJS.Timeout | number)[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
      
      // Cleanup subscriptions
      subscriptionsRef.current.forEach(unsubscribe => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
      
      // Cleanup timers
      timersRef.current.forEach(timer => {
        if (timer) clearTimeout(timer as NodeJS.Timeout);
      });
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`Component ${componentName} cleaned up`);
      }
    };
  }, [componentName]);

  const addSubscription = useCallback((unsubscribe: () => void) => {
    subscriptionsRef.current.push(unsubscribe);
  }, []);

  const addTimer = useCallback((timer: NodeJS.Timeout | number) => {
    timersRef.current.push(timer);
  }, []);

  return {
    isMounted: () => mountedRef.current,
    addSubscription,
    addTimer
  };
};

// Optimized context provider
export const createOptimizedContext = <T,>(defaultValue: T) => {
  const Context = React.createContext<T>(defaultValue);
  
  const Provider: React.FC<{ value: T; children: React.ReactNode }> = memo(({ value, children }) => {
    const memoizedValue = useMemo(() => value, [JSON.stringify(value)]);
    
    return (
      <Context.Provider value={memoizedValue}>
        {children}
      </Context.Provider>
    );
  });
  
  (Provider as any).displayName = 'OptimizedContextProvider';
  
  return { Context, Provider };
};

// Bundle size optimization utilities
export const BundleOptimizer = {
  // Lazy load components
  lazyLoad: <T extends React.ComponentType<any>>(
    importFn: () => Promise<{ default: T }>,
    fallback?: React.ReactNode
  ) => {
    return React.lazy(importFn);
  },
  
  // Code splitting utilities
  split: {
    // Split by route
    byRoute: (route: string) => {
      return React.lazy(() => import(`../pages/${route}`));
    },
    
    // Split by feature
    byFeature: (feature: string) => {
      return React.lazy(() => import(`../features/${feature}`));
    }
  }
};

export default MemoryManager;
