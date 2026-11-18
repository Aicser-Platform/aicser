import { beforeEach, describe, expect, it, vi } from 'vitest';

const sonner = vi.hoisted(() => {
  const fn = (level: string) => vi.fn((_text: string, options?: { id?: string | number }) => options?.id ?? level);
  return {
    success: fn('success'),
    error: fn('error'),
    info: fn('info'),
    warning: fn('warning'),
    loading: fn('loading'),
    dismiss: vi.fn(),
  };
});
vi.mock('sonner', () => ({ toast: sonner }));

import { message } from './toast';

describe('message (AntD call shapes on sonner)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a plain string with the default duration', () => {
    message.success('Saved');
    expect(sonner.success).toHaveBeenCalledWith('Saved', { id: undefined, duration: undefined });
  });

  it('turns seconds into milliseconds and 0 into a toast that stays', () => {
    message.error('Failed', 3);
    expect(sonner.error).toHaveBeenCalledWith('Failed', { id: undefined, duration: 3000 });
    message.warning({ content: 'Careful', duration: 0 });
    expect(sonner.warning).toHaveBeenCalledWith('Careful', { id: undefined, duration: Infinity });
  });

  it('replaces a toast by key, as AntD does', () => {
    message.loading({ content: 'Switching…', key: 'switch' });
    message.success({ content: 'Switched', key: 'switch', duration: 2 });
    expect(sonner.loading).toHaveBeenCalledWith('Switching…', { id: 'switch', duration: Infinity });
    expect(sonner.success).toHaveBeenCalledWith('Switched', { id: 'switch', duration: 2000 });
  });

  it('opens by type and closes by key', () => {
    message.open({ type: 'info', content: 'Hello', key: 1 });
    expect(sonner.info).toHaveBeenCalledWith('Hello', { id: 1, duration: undefined });
    message.destroy('switch');
    expect(sonner.dismiss).toHaveBeenCalledWith('switch');
  });
});
