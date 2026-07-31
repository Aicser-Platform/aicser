export type AiserDeploymentMode = 'saas' | 'self_host';

export function getPublicDeploymentMode(): AiserDeploymentMode | null {
  const raw = (process.env.NEXT_PUBLIC_AISER_DEPLOYMENT_MODE || '').trim().toLowerCase();
  if (['self_host', 'self-host', 'selfhost'].includes(raw)) return 'self_host';
  if (['saas', 'hosted', 'cloud'].includes(raw)) return 'saas';
  return null;
}

export function isSelfHostDeploymentFromEnv(): boolean {
  return getPublicDeploymentMode() === 'self_host';
}
