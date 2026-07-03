import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import NL2SqlPromptBar from '@/components/data/SQLEditor/NL2SqlPromptBar';

vi.mock('@/hooks/useAi', () => ({
  useAiModels: () => ({
    data: [
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', available: true },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', available: false },
    ],
    isLoading: false,
  }),
  useGenerateSql: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

describe('NL2SqlPromptBar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the ask input and a generate button', () => {
    render(<NL2SqlPromptBar dataSourceId="d1" onInsert={() => {}} />);
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate/i })).toBeTruthy();
  });
});
