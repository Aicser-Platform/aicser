'use client';

import React, { useEffect, useRef } from 'react';
import { Send, Sparkles, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';

const MAX_TEXTAREA_PX = 160;

/** The message box under the conversation: grows with the text, Enter sends, Shift+Enter breaks. */
export function EmbedChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  loading,
  modeLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  loading: boolean;
  /** What the assistant does with a question (search knowledge, analyze data…). */
  modeLabel?: string;
}) {
  const t = useTranslations('embed_chat');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !loading;

  return (
    <div className="rounded-2xl border border-border bg-bg-container p-3 shadow-sm focus-within:border-[var(--ant-color-primary,#00c2cb)]">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        placeholder={t('input_placeholder')}
        disabled={loading}
        aria-label={t('input_placeholder')}
        className="block w-full resize-none border-0 bg-transparent p-1 text-sm leading-relaxed text-text outline-none placeholder:text-text-tertiary disabled:opacity-60"
      />
      <div className="mt-2 flex items-center gap-2">
        {modeLabel ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-text-secondary">
            <Sparkles className="h-3.5 w-3.5" />
            {modeLabel}
          </span>
        ) : null}
        <div className="flex-1" />
        {loading ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm text-text hover:bg-[var(--ant-color-fill-tertiary,rgba(0,0,0,0.04))]"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            {t('stop')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-[var(--ant-color-primary,#00c2cb)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {t('send')}
          </button>
        )}
      </div>
    </div>
  );
}
