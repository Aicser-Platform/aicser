import { redirect } from 'next/navigation';

/**
 * Upload onboarding was retired: an uploaded file is a connection people can use straight away,
 * cleaned in Prepare and sent to the lakehouse from a pipeline when needed. Old links land on
 * Connections.
 */
export default function OnboardingRedirect() {
  redirect('/data');
}
