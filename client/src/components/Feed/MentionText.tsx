import React, { Fragment } from 'react';

const MENTION_PATTERN = /@([a-zA-Z0-9._-]+)/g;

/** Split text on @mention tokens (same pattern useMentionableMembers resolves
 * against) and wrap each one in a styled span, so a mention reads as a real
 * tag instead of getting lost as plain "@name" text - standard on every
 * platform this composer's mention picker is modeled after (Slack, LinkedIn).
 * Not a link: resolving a token back to a specific profile needs the
 * mentionable-members list for whichever org/project scope the content was
 * posted in, which isn't available to every viewer rendering this text. */
export function renderTextWithMentions(text: string): React.ReactNode {
  if (!text) return text;
  const parts = text.split(MENTION_PATTERN);
  // String.split with a capturing group alternates plain / captured-group text.
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="feed-mention">
        @{part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
