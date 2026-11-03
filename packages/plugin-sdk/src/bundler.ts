export interface PluginBundleConfigOptions {
  entry?: string;
  outDir?: string;
  minify?: boolean;
}

export function defineVisualBuildConfig(options: PluginBundleConfigOptions = {}) {
  return {
    entry: [options.entry || 'src/index.ts'],
    format: ['esm'] as const,
    target: 'es2022',
    minify: options.minify ?? true,
    outDir: options.outDir || '../static',
    clean: true,
    external: ['echarts', 'react', 'react-dom'],
  };
}

