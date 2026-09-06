/**
 * Client-side guard for the "Share with" form (Settings > Embed > Chat
 * assistants > visibility=shared): a share grant targets either one
 * colleague (by email) or one whole project, never both, never neither.
 * The server enforces the same rule; this just gives the form fast,
 * synchronous feedback before a round trip.
 */
export interface ShareTargetInput {
  shared_with?: string | null;
  project_id?: string | null;
}

/** Returns an error message if the input is invalid, or null if it's fine. */
export function validateShareTarget(
  input: ShareTargetInput,
  messages: { both: string; neither: string } = {
    both: 'Share with either a colleague or a project, not both.',
    neither: 'Enter a colleague email or pick a project to share with.',
  }
): string | null {
  const hasUser = Boolean(input.shared_with && input.shared_with.trim());
  const hasProject = Boolean(input.project_id && input.project_id.trim());
  if (hasUser && hasProject) return messages.both;
  if (!hasUser && !hasProject) return messages.neither;
  return null;
}
