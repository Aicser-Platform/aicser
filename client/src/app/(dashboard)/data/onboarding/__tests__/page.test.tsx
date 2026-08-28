import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));

import OnboardingPage from '../[sessionId]/page';

const messages = {
  data_platform: { upgrade_title: 'Upgrade required', view_plans: 'View plans' },
  onboarding: { upgrade_desc: 'Available on Team and Enterprise.' },
};

describe('OnboardingPage (CE)', () => {
  it('shows the upgrade prompt when the edition is not enterprise', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <OnboardingPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText('Upgrade required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View plans' })).toBeInTheDocument();
  });
});
