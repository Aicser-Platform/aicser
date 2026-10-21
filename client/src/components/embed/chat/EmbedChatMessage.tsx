'use client';

import React, { useState } from 'react';
import { Check, ChevronRight, Copy, Lightbulb, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import MarkdownRenderer from '@/components/ui/markdown/MarkdownRenderer';

export function EmbedChatUserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--ant-color-primary,#00c2cb)] px-4 py-2 text-sm leading-relaxed text-white">
        {content}
      </div>
    </div>
  );
}

/**
 * One answer: the steps the assistant took (collapsed), its text, the result card, insights and
 * follow-up questions — the layout of the in-app chat.
 */
export function EmbedChatAssistantMessage({
  avatar,
  content,
  streaming,
  error,
  progressMessage,
  toolSteps,
  before,
  result,
  after,
  insights,
  followUps,
  onFollowUp,
  onRetry,
}: {
  avatar: React.ReactNode;
  content: string;
  streaming?: boolean;
  error?: boolean;
  progressMessage?: string;
  toolSteps: string[];
  /** Above the text, e.g. a dashboard being built. */
  before?: React.ReactNode;
  /** The chart / query / table card. */
  result?: React.ReactNode;
  /** Under the result, e.g. sources. */
  after?: React.ReactNode;
  insights: string[];
  followUps: string[];
  onFollowUp: (question: string) => void;
  onRetry?: () => void;
}) {
  const t = useTranslations('embed_chat');
  const [stepsOpen, setStepsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="group flex gap-3">
      <div className="shrink-0 pt-0.5">{avatar}</div>
      <div className="min-w-0 flex-1">
        {toolSteps.length > 0 && (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setStepsOpen((o) => !o)}
              className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm text-text-secondary hover:text-text"
              aria-expanded={stepsOpen}
            >
              {t('tools_used', { count: toolSteps.length })}
              <ChevronRight className={`h-4 w-4 transition-transform ${stepsOpen ? 'rotate-90' : ''}`} />
            </button>
            {stepsOpen && (
              <ol className="mb-0 mt-2 list-decimal space-y-1 pl-5 text-xs text-text-secondary">
                {toolSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        )}

        {streaming && !content && (
          <div className="flex items-center gap-2 py-1 text-sm text-text-secondary" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progressMessage || t('thinking')}
          </div>
        )}

        {before}

        {content ? (
          <div className={`text-sm leading-relaxed ${error ? 'text-[var(--ant-color-error,#ff4d4f)]' : 'text-text'}`}>
            <MarkdownRenderer content={content} className="markdown-compact" />
            {streaming && (
              <span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-current align-text-bottom" />
            )}
          </div>
        ) : null}

        {result}

        {insights.length > 0 && (
          <ul className="mb-0 mt-3 list-none space-y-2 p-0">
            {insights.map((text, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-text">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ant-color-primary,#00c2cb)]" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        )}

        {after}

        {!streaming && followUps.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {followUps.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onFollowUp(q)}
                className="rounded-full border border-border bg-transparent px-3 py-1 text-xs text-text hover:border-[var(--ant-color-primary,#00c2cb)]"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {!streaming && (content || onRetry) && (
          <div
            className={`mt-2 flex gap-1 transition-opacity ${
              error ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
            }`}
          >
            {content && !error && (
              <button
                type="button"
                onClick={copy}
                title={t('copy')}
                aria-label={t('copy')}
                className="inline-flex items-center rounded-md border-0 bg-transparent p-1.5 text-text-secondary hover:bg-[var(--ant-color-fill-tertiary,rgba(0,0,0,0.04))] hover:text-text"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-2 py-1 text-xs text-text-secondary hover:bg-[var(--ant-color-fill-tertiary,rgba(0,0,0,0.04))] hover:text-text"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
