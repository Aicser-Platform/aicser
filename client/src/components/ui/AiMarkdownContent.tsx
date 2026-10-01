'use client';

import React from 'react';
import MarkdownRenderer from '@/components/ui/markdown/MarkdownRenderer';
import '@/styles/ai-markdown-content.css';

type AiMarkdownContentProps = {
  content: string;
  className?: string;
};

/** LLM Markdown in modals and side panels — the same renderer as chat, in its compact size. */
export function AiMarkdownContent({ content, className = '' }: AiMarkdownContentProps) {
  return (
    <div className={`ai-markdown-content${className ? ` ${className}` : ''}`}>
      <MarkdownRenderer content={content} className="markdown-compact" />
    </div>
  );
}
