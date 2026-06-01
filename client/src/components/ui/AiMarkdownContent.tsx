'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import '@/styles/ai-markdown-content.css';

type AiMarkdownContentProps = {
  content: string;
  className?: string;
};

/** Renders LLM markdown (headings, lists, fenced code) for modals and side panels. */
export function AiMarkdownContent({ content, className = '' }: AiMarkdownContentProps) {
  return (
    <div className={`ai-markdown-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: ({ inline, className: codeClassName, children, ...props }: React.ComponentProps<'code'> & { inline?: boolean }) => {
            const cls = typeof codeClassName === 'string' ? codeClassName : '';
            const isBlock = inline === false || (inline !== true && /\blanguage-[\w-]+\b/.test(cls));
            if (isBlock) {
              return (
                <pre className="ai-markdown-pre">
                  <code className={codeClassName} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            return (
              <code className="ai-markdown-inline-code" {...props}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="table-wrapper">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
