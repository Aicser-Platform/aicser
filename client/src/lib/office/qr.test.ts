import { describe, expect, it } from 'vitest';
import { qrModules } from './qr';

describe('qrModules', () => {
  it('gives a square matrix with finder patterns in three corners', () => {
    const { size, modules } = qrModules('https://app.example.com/remote/abc');
    expect(modules).toHaveLength(size * size);
    expect(size).toBeGreaterThanOrEqual(21);
    const at = (x: number, y: number) => modules[y * size + x];
    // Each finder pattern starts with a dark 7-module edge.
    for (const [x, y] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ] as const) {
      expect(at(x, y)).toBe('1');
      expect(at(x + 6, y)).toBe('1');
      expect(at(x + 1, y + 1)).toBe('0');
    }
  });
});
