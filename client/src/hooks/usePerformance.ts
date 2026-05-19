import { useEffect, useRef } from 'react';

interface PerformanceMetrics {
  pageLoadTime: number;
  renderTime: number;
  memoryUsage?: number;
}

export const usePerformance = (pageName: string) => {
  const startTime = useRef(performance.now());
  const renderStartTime = useRef<number | null>(null);

  useEffect(() => {
    renderStartTime.current = performance.now();

    const handleLoad = () => {
      const loadTime = performance.now() - startTime.current;
      const renderTime = renderStartTime.current 
        ? performance.now() - renderStartTime.current 
        : 0;

      console.log(`🚀 ${pageName} Performance:`, {
        'Page Load Time': `${loadTime.toFixed(2)}ms`,
        'Render Time': `${renderTime.toFixed(2)}ms`
      });
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(handleLoad);
    } else {
      setTimeout(handleLoad, 0);
    }

    return () => {
      const totalTime = performance.now() - startTime.current;
      console.log(`⏱️ ${pageName} Total Time: ${totalTime.toFixed(2)}ms`);
    };
  }, [pageName]);

  const debounce = <T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  };

  return { debounce };
};
