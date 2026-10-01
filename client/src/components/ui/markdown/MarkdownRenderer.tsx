'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import './MarkdownRenderer.css';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';

import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  escapeCurrencyDollarsForMarkdown,
  repairCollapsedMarkdown,
} from '@/utils/userFriendlyMessages';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

function reactNodeToPlainText(node: React.ReactNode): string {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(reactNodeToPlainText).join('');
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
        return reactNodeToPlainText(node.props.children);
    }
    return '';
}

function MarkdownCodeBlock({
    className,
    children,
    ...props
}: Omit<React.ComponentPropsWithoutRef<'code'>, 'children'> & {
    children?: React.ReactNode;
}) {
    const [copied, setCopied] = React.useState(false);
    const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        return () => {
            if (resetTimer.current) clearTimeout(resetTimer.current);
        };
    }, []);

    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const text = reactNodeToPlainText(children).replace(/\n$/, '');

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            if (resetTimer.current) clearTimeout(resetTimer.current);
            resetTimer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            /* ignore — clipboard may be unavailable */
        }
    };

    return (
        <div className="code-block-wrapper">
            <div className="code-block-header">
                {language ? <span className="code-language">{language}</span> : null}
                <button
                    type="button"
                    className="code-copy-btn"
                    onClick={handleCopy}
                    aria-label={copied ? 'Copied' : 'Copy code'}
                >
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <pre className="code-block">
                <code className={className} {...props}>
                    {children}
                </code>
            </pre>
        </div>
    );
}

let mermaidSeq = 0;

/** ```mermaid blocks as diagrams (flowcharts, sequences, timelines…). Mermaid loads only when a
 * diagram appears; strict mode keeps labels as text (no HTML or scripts). If a diagram doesn't
 * parse, its source shows as code instead. */
function MermaidDiagram({ code }: { code: string }) {
    const { isDarkMode } = useThemeMode();
    const [svg, setSvg] = React.useState<string | null>(null);
    const [failed, setFailed] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        void import('mermaid').then(async ({ default: mermaid }) => {
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDarkMode ? 'dark' : 'default' });
            try {
                const { svg: out } = await mermaid.render(`md-diagram-${++mermaidSeq}`, code);
                if (!cancelled) { setSvg(out); setFailed(false); }
            } catch {
                if (!cancelled) setFailed(true);
            }
        }).catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [code, isDarkMode]);

    if (failed) {
        return <MarkdownCodeBlock className="language-mermaid">{code}</MarkdownCodeBlock>;
    }
    return svg
        ? <div className="markdown-diagram" role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: svg }} />
        : <div className="markdown-diagram" aria-busy="true" />;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ 
    content, 
    className = '' 
}) => {
    const prepared = React.useMemo(
        () => escapeCurrencyDollarsForMarkdown(repairCollapsedMarkdown(content || '')),
        [content],
    );

    return (
        <div className={`markdown-content ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
                rehypePlugins={[
                    rehypeHighlight,
                    [rehypeKatex, { strict: false, throwOnError: false }],
                ]}
                components={{
                    code: ({ inline, className, children, ...props }: any) => {
                        const cls = typeof className === 'string' ? className : '';
                        const hasFenceLanguage = /\blanguage-[\w-]+\b/.test(cls);
                        // Fenced blocks: inline === false, or language-* class (react-markdown / rehype).
                        // Inline backticks: inline === true, or no fence class when inline isn't forced false.
                        const isBlock = inline === false || (inline !== true && hasFenceLanguage);
                        if (isBlock && /\blanguage-mermaid\b/.test(cls)) {
                            return <MermaidDiagram code={reactNodeToPlainText(children).replace(/\n$/, '')} />;
                        }
                        if (isBlock) {
                            return (
                                <MarkdownCodeBlock className={className} {...props}>
                                    {children}
                                </MarkdownCodeBlock>
                            );
                        }
                        return (
                            <code className="inline-code" {...props}>
                                {children}
                            </code>
                        );
                    },
                    // Fenced blocks render their own container (code with copy, or a diagram);
                    // react-markdown's outer <pre> would wrap diagrams in a code box.
                    pre: ({ children }) => <>{children}</>,
                    // Customize tables
                    table: ({ children }) => (
                        <div className="table-wrapper">
                            <table className="markdown-table">
                                {children}
                            </table>
                        </div>
                    ),
                    // Customize blockquotes
                    blockquote: ({ children }) => (
                        <blockquote className="markdown-blockquote">
                            {children}
                        </blockquote>
                    ),
                    // Customize lists (preserve GFM task-list classes)
                    ul: ({ className, children, ...props }) => (
                        <ul className={['markdown-list', className].filter(Boolean).join(' ')} {...props}>
                            {children}
                        </ul>
                    ),
                    ol: ({ className, children, ...props }) => (
                        <ol className={['markdown-list', className].filter(Boolean).join(' ')} {...props}>
                            {children}
                        </ol>
                    ),
                    li: ({ className, children, ...props }) => (
                        <li className={['markdown-list-item', className].filter(Boolean).join(' ')} {...props}>
                            {children}
                        </li>
                    ),
                    input: ({ type, checked, ...props }) => {
                        if (type === 'checkbox') {
                            return (
                                <input
                                    type="checkbox"
                                    className="markdown-task-checkbox"
                                    checked={Boolean(checked)}
                                    disabled
                                    readOnly
                                    {...props}
                                />
                            );
                        }
                        return <input type={type} {...props} />;
                    },
                    // Customize headings
                    h1: ({ children }) => (
                        <h1 className="markdown-h1">
                            {children}
                        </h1>
                    ),
                    h2: ({ children }) => (
                        <h2 className="markdown-h2">
                            {children}
                        </h2>
                    ),
                    h3: ({ children }) => (
                        <h3 className="markdown-h3">
                            {children}
                        </h3>
                    ),
                    h4: ({ children }) => (
                        <h4 className="markdown-h4">{children}</h4>
                    ),
                    h5: ({ children }) => (
                        <h5 className="markdown-h5">{children}</h5>
                    ),
                    h6: ({ children }) => (
                        <h6 className="markdown-h6">{children}</h6>
                    ),
                    // Customize paragraphs
                    p: ({ children }) => (
                        <p className="markdown-paragraph">
                            {children}
                        </p>
                    ),
                    // Customize links
                    a: ({ href, children, node: _node, className: linkClass, ...rest }: any) => {
                        // Citations ([^1]) and their back-links stay in the page; other links open
                        // in a new tab.
                        const inPage = typeof href === 'string' && href.startsWith('#');
                        return (
                            <a
                                href={href}
                                {...rest}
                                {...(inPage ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                                className={['markdown-link', linkClass].filter(Boolean).join(' ')}
                            >
                                {children}
                            </a>
                        );
                    },
                    // Customize strong/bold
                    strong: ({ children }) => (
                        <strong className="markdown-strong">
                            {children}
                        </strong>
                    ),
                    // Customize emphasis/italic
                    em: ({ children }) => (
                        <em className="markdown-em">
                            {children}
                        </em>
                    )
                }}
            >
                {prepared}
            </ReactMarkdown>
        </div>
    );
};

export default MarkdownRenderer;
