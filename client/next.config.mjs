/**
 * Next.js configuration
 * Proxy auth service under the same origin during development.
 *
 * Next 16 defaults to Turbopack for build/dev. This project still needs the
 * custom webpack() aliases (EE swap, antd Ellipsis, Sentry client bundle), so
 * package.json scripts pin `next build --webpack` / `next dev --webpack`.
 * Turbopack resolveAlias is kept for `dev:turbo` / future migration.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getSerwistRevision() {
  try {
    const stdout = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout?.trim();
    if (stdout) return stdout.slice(0, 12);
  } catch {
    // ignore — not a git repo or git unavailable
  }
  return randomUUID();
}

/** Optional — dev Docker volumes may lag package.json until `npm install` runs. */
function loadSerwistWrapper() {
  try {
    const withSerwistInit = require('@serwist/next').default;
    return withSerwistInit({
      swSrc: 'src/sw.ts',
      swDest: 'public/sw.js',
      cacheOnNavigation: true,
      reloadOnOnline: true,
      disable: process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_PWA_DEV !== 'true',
      additionalPrecacheEntries: [{ url: '/offline', revision: getSerwistRevision() }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[PWA] @serwist/next unavailable — skipping service worker wrapper (${message})`);
    return (config) => config;
  }
}

const pwaEnabled =
  process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_PWA_DEV === 'true';
const withSerwist = pwaEnabled ? loadSerwistWrapper() : (config) => config;

function loadSentryWrapper() {
  try {
    return require('@sentry/nextjs').withSentryConfig;
  } catch {
    return null;
  }
}

// Webpack alias: @/ee → ee/src/ee/ (EE) or src/ee-fallback.ts (CE).
// Turbopack: absolute-path aliases are limited; CE uses setup-ee.js shim + resolveAlias below.
const eeIndex = path.resolve(__dirname, 'ee/src/ee/index.ts');
const eeFallback = path.resolve(__dirname, 'src/ee-fallback.ts');
const pricingModalNoop = path.resolve(__dirname, 'src/components/PricingModal.noop.tsx');
const edition = (process.env.NEXT_PUBLIC_EDITION || process.env.EDITION || '').toLowerCase();
const isEnterprise = edition === 'enterprise' || edition === 'ee';
const eeEntry = isEnterprise ? path.dirname(eeIndex) : eeFallback;
const eeSubscriptionStore = isEnterprise
  ? path.resolve(__dirname, 'ee/src/ee/stores/useSubscriptionStore.ts')
  : eeFallback;
const eeSubscriptionStoreTurbo = isEnterprise
  ? './ee/src/ee/stores/useSubscriptionStore.ts'
  : './src/ee-fallback.ts';
const sentryEnabled = Boolean(
  process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
);

const antdEllipsisAlias = {
  'antd/es/typography/Base/Ellipsis': './src/patches/antd-safe-ellipsis.tsx',
  'antd/es/typography/Base/Ellipsis.js': './src/patches/antd-safe-ellipsis.tsx',
  'antd/lib/typography/Base/Ellipsis': './src/patches/antd-safe-ellipsis.tsx',
  'antd/lib/typography/Base/Ellipsis.js': './src/patches/antd-safe-ellipsis.tsx',
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },

  // Allow local builds when Docker left a root-owned `.next` cache.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  output: 'standalone',

  productionBrowserSourceMaps: false,

  experimental: {
    ...(process.env.NEXT_DEV_CPUS
      ? { cpus: Number.parseInt(process.env.NEXT_DEV_CPUS, 10) }
      : {}),
    // Rewrites barrel imports (`import { x } from 'pkg'`) to direct submodule
    // imports so only the used code is pulled into the graph.
    optimizePackageImports: [
      'antd',
      '@ant-design/icons',
      'echarts',
      'recharts',
      'lodash-es',
      'react-syntax-highlighter',
      '@tanstack/react-query',
    ],
  },

  // Next 16 top-level turbopack config (used by `next dev --turbo` / future default).
  turbopack: {
    resolveAlias: {
      ...(!isEnterprise
        ? { '@/ee/components/PricingModal': './src/components/PricingModal.noop.tsx' }
        : {}),
      '@/ee/stores/useSubscriptionStore': eeSubscriptionStoreTurbo,
      ...antdEllipsisAlias,
    },
  },

  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@/ee/stores/useSubscriptionStore': eeSubscriptionStore,
      '@/ee': eeEntry,
      ...(!isEnterprise
        ? { '@/ee/components/PricingModal': pricingModalNoop }
        : {}),
      'antd/es/typography/Base/Ellipsis': path.resolve(process.cwd(), 'src/patches/antd-safe-ellipsis.tsx'),
      'antd/es/typography/Base/Ellipsis.js': path.resolve(process.cwd(), 'src/patches/antd-safe-ellipsis.tsx'),
      'antd/lib/typography/Base/Ellipsis': path.resolve(process.cwd(), 'src/patches/antd-safe-ellipsis.tsx'),
      'antd/lib/typography/Base/Ellipsis.js': path.resolve(process.cwd(), 'src/patches/antd-safe-ellipsis.tsx'),
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };

      try {
        config.resolve.alias['@sentry/nextjs'] = require.resolve(
          '@sentry/nextjs/build/cjs/index.client.js',
        );
      } catch {
        // @sentry/nextjs not installed — no-op
      }
    }

    return config;
  },
};

const withSentryConfig = sentryEnabled ? loadSentryWrapper() : null;

export default withSerwist(
  withSentryConfig
    ? withSentryConfig(nextConfig, {
        silent: true,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        widenClientFileUpload: true,
      })
    : nextConfig,
);
