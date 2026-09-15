import '@testing-library/jest-dom/vitest';

// antd's Grid/responsive breakpoint hooks (e.g. Descriptions) call matchMedia,
// which jsdom doesn't implement.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

// antd v6's Table (virtual mode) and other size-aware components observe
// element resize via ResizeObserver, which jsdom doesn't implement.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}
