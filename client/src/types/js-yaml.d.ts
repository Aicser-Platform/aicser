declare module 'js-yaml' {
  export type LoadOptions = {
    filename?: string;
    json?: boolean;
    onWarning?: (error: Error) => void;
    schema?: unknown;
  };

  export type DumpOptions = {
    indent?: number;
    noRefs?: boolean;
    lineWidth?: number;
    sortKeys?: boolean | ((a: string, b: string) => number);
  };

  export function load(input: string, options?: LoadOptions): unknown;
  export function dump(input: unknown, options?: DumpOptions): string;

  const yaml: {
    load: typeof load;
    dump: typeof dump;
  };

  export default yaml;
}
