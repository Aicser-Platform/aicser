// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DatePicker } from 'antd';
import { LocaleProvider } from '@/components/Providers/LocaleProvider';
import { ThemeProvider } from '@/components/Providers/ThemeProvider';
import { TIMEZONE_OPTIONS } from '@/config/locales';

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({ authLoading: false, isAuthenticated: false }),
  },
}));

vi.mock('@/auth/ce/bearerToken', () => ({
  getCeBearerToken: () => null,
}));

vi.mock('@/utils/api', () => ({
  fetchApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/utils/loadLocaleMessages', () => ({
  loadLocaleMessages: vi.fn().mockResolvedValue({ common: { ok: 'OK' } }),
}));

describe('LocaleProvider and ThemeProvider runtime locale (id)', () => {
  beforeEach(() => {
    const store: Record<string, string> = { aiser_locale: 'id' };
    Object.defineProperty(window, 'localStorage', {
      writable: true,
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = String(v);
        },
        removeItem: (k: string) => {
          delete store[k];
        },
        clear: () => {
          Object.keys(store).forEach((k) => delete store[k]);
        },
      },
    });
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }
  });

  it('includes Indonesian timezones (WIB, WITA, WIT) in TIMEZONE_OPTIONS', () => {
    const values = TIMEZONE_OPTIONS.map((tz) => tz.value);
    expect(values).toContain('Asia/Jakarta');
    expect(values).toContain('Asia/Makassar');
    expect(values).toContain('Asia/Jayapura');
  });

  it('renders antd DatePicker with Indonesian placeholder when locale is id', async () => {
    render(
      <ThemeProvider>
        <LocaleProvider>
          <DatePicker open />
        </LocaleProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Pilih tanggal')).toBeInTheDocument();
    });
  });
});
