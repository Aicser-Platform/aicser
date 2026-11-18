import type { Finding } from '@/api/prep';

/** The key a CLEAN-panel decision is stored under: one per issue kind and column. */
export const decisionKey = (f: Finding) => `${f.code}:${f.column ?? ''}`;
