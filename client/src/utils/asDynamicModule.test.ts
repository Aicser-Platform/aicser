import { describe, expect, it } from 'vitest';
import { asDynamicComponent, asDynamicModule } from './asDynamicModule';

function CompA() {
  return null;
}
function CompB() {
  return null;
}

describe('asDynamicModule', () => {
  it('wraps a bare component as { default }', () => {
    expect(asDynamicModule(CompA).default).toBe(CompA);
  });

  it('unwraps one level of nested default (webpack interop)', () => {
    expect(asDynamicModule({ default: CompA }).default).toBe(CompA);
  });

  it('unwraps two levels of nested default', () => {
    expect(asDynamicModule({ default: { default: CompA } }).default).toBe(CompA);
  });

  it('falls back when export is a plain object', () => {
    expect(asDynamicModule({ notAComponent: true } as never, CompB).default).toBe(CompB);
  });
});

describe('asDynamicComponent', () => {
  it('returns the component directly for next/dynamic .then(m => named) loaders', () => {
    expect(asDynamicComponent({ default: CompA }, CompB)).toBe(CompA);
    expect(asDynamicComponent(undefined, CompB)).toBe(CompB);
  });
});
