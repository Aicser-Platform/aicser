'use client';

import React from 'react';
import { Alert, Typography } from 'antd';
import './guided-form.css';

const { Text } = Typography;

/**
 * The "New alert" way of asking for settings: a few numbered, plain-language questions with
 * sensible defaults, optional details folded away, and one sentence that says what will happen.
 * Use it wherever a form asks a newcomer for more than three or four things.
 */
export function GuidedForm({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`guided-form${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function GuidedStep({ n, title, hint, children }: { n: number; title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="guided-form__step" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="guided-form__title">
        <span className="guided-form__n" aria-hidden>{n}</span>
        <Text strong>{title}</Text>
      </div>
      <div className="guided-form__body">
        {/* Guidance for the question comes before its fields, where it's read before choosing */}
        {hint ? <Text type="secondary" className="guided-form__hint">{hint}</Text> : null}
        {children}
      </div>
    </section>
  );
}

/** What will happen, in one sentence; a warning when something needed is still missing. */
export function GuidedSummary({ children, missing }: { children: React.ReactNode; missing?: React.ReactNode }) {
  return <Alert className="guided-form__summary" type={missing ? 'warning' : 'info'} showIcon message={missing || children} />;
}
