'use client';

import React from 'react';
import { Typography } from 'antd';
import { describeRule, type DescribableRule } from './accessSentence';

const { Text } = Typography;

const identifier: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.92em',
};

/**
 * Renders a rule as the sentence an admin would say, with the parts they can
 * act on — the column, and whose value it is compared to — pulled forward.
 */
export const AccessSentence: React.FC<{
  rule: DescribableRule;
  /** Muted for supporting lines; normal where the sentence is the content. */
  tone?: 'normal' | 'muted';
}> = ({ rule, tone = 'muted' }) => {
  const { target, verb, scope, complete } = describeRule(rule);
  if (!complete) return null;

  return (
    <Text type={tone === 'muted' ? 'secondary' : undefined} style={{ fontSize: 13, lineHeight: 1.6 }}>
      Show rows where <Text style={{ ...identifier }} strong>{target}</Text> {verb}
      {scope ? (
        <>
          {' '}
          <Text strong>{scope}</Text>
        </>
      ) : null}
    </Text>
  );
};

export default AccessSentence;
