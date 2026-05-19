// Lightweight shim for Next metadata internal types referenced by dev cache
declare module 'next/dist/lib/metadata/types/metadata-interface.js' {
  export interface ResolvingMetadata {
    [key: string]: any;
  }

  export interface MetadataRoute {
    [key: string]: any;
  }

  export interface ResolvingViewport {
    [key: string]: any;
  }

  const _default: any;
  export default _default;
}

declare module 'next/dist/lib/metadata/types/metadata-interface' {
  export * from 'next/dist/lib/metadata/types/metadata-interface.js';
}


