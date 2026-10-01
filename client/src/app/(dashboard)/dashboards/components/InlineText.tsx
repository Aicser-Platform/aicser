'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Text you edit where you read it (Canva / Notion): click to type, changes apply as you type,
 * Enter or clicking away finishes, Esc puts the text back. Read-only when `editable` is false.
 * An empty field shows its placeholder only while the card is hovered or selected.
 */
export function InlineText({
  value,
  placeholder,
  editable,
  multiline = false,
  maxLength = 200,
  className = '',
  onChange,
}: {
  value: string;
  placeholder: string;
  editable: boolean;
  multiline?: boolean;
  maxLength?: number;
  className?: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const original = useRef(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  if (!editable) {
    return value ? <span className={className}>{value}</span> : null;
  }

  if (editing) {
    const common = {
      ref,
      className: `inline-text-input ${className}`,
      value,
      maxLength,
      'aria-label': placeholder,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement & HTMLInputElement>) => onChange(e.target.value),
      onBlur: () => setEditing(false),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
          onChange(original.current);
          setEditing(false);
        } else if (e.key === 'Enter' && (!multiline || !e.shiftKey)) {
          e.preventDefault();
          setEditing(false);
        }
        e.stopPropagation();
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    };
    return multiline ? <textarea rows={2} {...common} /> : <input {...common} />;
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className={`inline-text ${value ? '' : 'inline-text-empty'} ${className}`}
      title={placeholder}
      onClick={() => {
        original.current = value;
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          original.current = value;
          setEditing(true);
        }
      }}
    >
      {value || placeholder}
    </span>
  );
}
