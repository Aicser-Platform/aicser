import { isSelfHostDeploymentFromEnv } from '@/utils/deploymentMode';

export const COMMUNITY_URL = 'https://t.me/dataticon_ai';

/** A private Enterprise install stays free of outside links. */
export const showCommunity = process.env.NEXT_PUBLIC_EDITION !== 'enterprise' || !isSelfHostDeploymentFromEnv();
