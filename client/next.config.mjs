/**
 * Next.js configuration
 * Proxy auth service under the same origin during development.
 */
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// @/ee resolves to ee/src/ (EE, submodule present) or src/ee-fallback.ts (CE, submodule absent)
const eeIndex    = path.resolve(__dirname, 'ee/src/index.ts');
const eeFallback = path.resolve(__dirname, 'src/ee-fallback.ts');
const eeEntry    = existsSync(eeIndex) ? path.dirname(eeIndex) : eeFallback;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Avoid failing builds due to ESLint plugin issues in CI/dev images
  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  output: 'standalone',

  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons', 'echarts'],
    turbo: {
      resolveAlias: {
        'antd/es/typography/Base/Ellipsis': './src/patches/antd-safe-ellipsis.tsx',
        'antd/es/typography/Base/Ellipsis.js': './src/patches/antd-safe-ellipsis.tsx',
        'antd/lib/typography/Base/Ellipsis': './src/patches/antd-safe-ellipsis.tsx',
        'antd/lib/typography/Base/Ellipsis.js': './src/patches/antd-safe-ellipsis.tsx',
      },
    },
  },

  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // CE/EE build-time swap — no runtime decision, no symlinks
      '@/ee': eeEntry,
      // Ant Design ellipsis patch
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
    }

    return config;
  },
};

export default nextConfig;
