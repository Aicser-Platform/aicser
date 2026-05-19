// Simple, working dynamic rendering configuration
// This prevents Next.js from trying to statically generate pages

// For pages that need to be dynamic (use React context, hooks, etc.)
export const DYNAMIC_CONFIG = {
  dynamic: 'force-dynamic',
  revalidate: 0,
  fetchCache: 'force-no-store'
};

// For pages that can be static (landing pages, etc.)
export const STATIC_CONFIG = {
  dynamic: 'auto',
  revalidate: 3600,
  fetchCache: 'auto'
};

// Utility function to check if we're in the browser
export const isBrowser = typeof window !== 'undefined';
