export function isAiFrontendEnabled(): boolean {
  const raw = (process.env.NEXT_PUBLIC_AI_ENABLED ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off', 'disabled'].includes(raw);
}
