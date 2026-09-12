import type { ComponentType } from 'react';

type MaybeModule<T> = T | { default: T } | null | undefined;

function isRenderableComponent(value: unknown): value is ComponentType<unknown> {
  if (typeof value === 'function') return true;
  // forwardRef / memo exotic components
  return Boolean(value && typeof value === 'object' && '$$typeof' in (value as object));
}

/**
 * Normalize a dynamic-import export for next/dynamic + React 19.
 *
 * React error #306 fires when a lazy() promise resolves to a plain module
 * object (`{ default: Comp }`) instead of a component. Webpack/ESM interop
 * sometimes nests `default` one level too deep on barrel re-exports — unwrap
 * until we have a real component, then wrap as `{ default }` for next/dynamic.
 */
export function asDynamicModule<TProps = unknown>(
  exported: MaybeModule<ComponentType<TProps>>,
  Fallback?: ComponentType<TProps>,
): { default: ComponentType<TProps> } {
  let cur: unknown = exported;
  for (let i = 0; i < 3; i += 1) {
    if (isRenderableComponent(cur)) {
      return { default: cur as ComponentType<TProps> };
    }
    if (cur && typeof cur === 'object' && 'default' in (cur as object)) {
      cur = (cur as { default: unknown }).default;
      continue;
    }
    break;
  }
  if (Fallback && isRenderableComponent(Fallback)) {
    return { default: Fallback };
  }
  const Empty = ((_props: TProps) => null) as ComponentType<TProps>;
  return { default: Empty };
}

/** When next/dynamic loader uses `.then(m => m.Named)` (component, not module). */
export function asDynamicComponent<TProps = unknown>(
  exported: MaybeModule<ComponentType<TProps>>,
  Fallback: ComponentType<TProps>,
): ComponentType<TProps> {
  return asDynamicModule(exported, Fallback).default;
}
