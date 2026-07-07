import { describe, it, expect } from 'vitest';
import { shouldPersistLayoutSync } from '../layoutSyncGuard';

describe('shouldPersistLayoutSync', () => {
  it('allows the save when the dashboard is still active 400ms later', () => {
    expect(shouldPersistLayoutSync('dash-a', 'dash-a')).toBe(true);
  });

  it('blocks the save when the user switched to a different dashboard before it fired', () => {
    // Regression: switching dashboards inside the debounce window used to
    // let a stale/degenerate layout get persisted onto whichever dashboard
    // happened to be active when the timer fired.
    expect(shouldPersistLayoutSync('dash-a', 'dash-b')).toBe(false);
  });

  it('blocks when no dashboard was active at schedule time', () => {
    expect(shouldPersistLayoutSync(null, 'dash-a')).toBe(false);
  });

  it('blocks when nothing is active at fire time either', () => {
    expect(shouldPersistLayoutSync(null, null)).toBe(false);
  });
});
