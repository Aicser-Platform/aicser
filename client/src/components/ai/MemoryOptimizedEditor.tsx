'use client';

import React, { useRef, useEffect, useCallback, memo, useImperativeHandle, forwardRef } from 'react';
import { useTranslations } from 'next-intl';
import { Editor } from '@monaco-editor/react';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import * as monaco from 'monaco-editor';

export interface MemoryOptimizedEditorHandle {
  insertTextAtCursor: (text: string) => void;
  /** Current editor content (live); use when switching tabs so debounced state is not stale */
  getValue: () => string;
  /** Returns the currently highlighted text, or empty string if nothing is selected */
  getSelectedText: () => string;
  /** Triggers Monaco's format-document action (uses any registered formatting provider) */
  formatDocument: () => void;
}

interface MemoryOptimizedEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  theme?: string;
  height?: string;
  options?: any;
  className?: string;
  /** When true (e.g. for SQL), enable quickSuggestions and suggestOnTriggerCharacters for schema-based autocomplete */
  enableSuggestions?: boolean;
  /** Called on every content change (no debounce); use to keep a ref in sync for tab-switch persistence */
  onContentChange?: (value: string) => void;
  /** Called when editor and monaco are ready (editor, monaco). Return a cleanup function to run on unmount. Use to register completion providers on the same monaco instance the editor uses. */
  onMonacoMount?: (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: unknown) => void | (() => void);
}

const MemoryOptimizedEditor = memo(forwardRef<MemoryOptimizedEditorHandle, MemoryOptimizedEditorProps>(({
  value,
  onChange,
  language = 'sql',
  theme = 'vs-light',
  height = '100%',
  options = {},
  className,
  enableSuggestions = false,
  onContentChange,
  onMonacoMount,
}, ref) => {
  const tEditor = useTranslations('monaco_sql_editor');
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const monacoMountCleanupRef = useRef<(() => void) | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  useImperativeHandle(ref, () => ({
    insertTextAtCursor: (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      const selection = editor.getSelection();
      const range = selection ?? { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
      editor.executeEdits('insert-from-datapanel', [{ range, text, forceMoveMarkers: true }]);
      const newVal = model.getValue();
      onChange(newVal);
    },
    getValue: () => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      return (model?.getValue() ?? value) || '';
    },
    getSelectedText: () => {
      const editor = editorRef.current;
      if (!editor) return '';
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) return '';
      return editor.getModel()?.getValueInRange(selection) ?? '';
    },
    formatDocument: () => {
      editorRef.current?.trigger('keyboard', 'editor.action.formatDocument', null);
    },
  }), [onChange, value]);

  // Debounced onChange handler to prevent excessive re-renders
  const debouncedOnChange = useCallback((newValue: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
    }, 300); // 300ms debounce
  }, [onChange]);

  // Handle editor mount with memory optimization (Editor from @monaco-editor/react passes editor, monaco)
  const handleEditorDidMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor, monacoInstance?: any) => {
    editorRef.current = editor;
    if (monacoMountCleanupRef.current) {
      monacoMountCleanupRef.current();
      monacoMountCleanupRef.current = null;
    }
    if (onMonacoMount && monacoInstance) {
      const cleanup = onMonacoMount(editor, monacoInstance);
      if (typeof cleanup === 'function') monacoMountCleanupRef.current = cleanup;
    }

    // Optimize editor for memory usage; when enableSuggestions (SQL), keep suggestions on for schema autocomplete
    editor.updateOptions({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'on',
      folding: true,
      foldingStrategy: 'indentation',
      showFoldingControls: 'always',
      renderWhitespace: 'none',
      renderControlCharacters: false,
      guides: { indentation: false, highlightActiveIndentation: false },
      renderLineHighlight: 'line',
      occurrencesHighlight: 'off',
      selectionHighlight: false,
      codeLens: false,
      quickSuggestions: enableSuggestions ? { other: true, comments: false, strings: true } : false,
      suggestOnTriggerCharacters: enableSuggestions,
      acceptSuggestionOnEnter: enableSuggestions ? 'on' : 'off',
      tabCompletion: enableSuggestions ? 'on' : 'off',
      wordBasedSuggestions: 'off',
      parameterHints: { enabled: enableSuggestions },
      hover: { enabled: true },
    });

    // Set up change listener: debounced parent onChange + immediate onContentChange (for tab-switch persistence)
    editor.onDidChangeModelContent(() => {
      const newValue = editor.getValue();
      onContentChangeRef.current?.(newValue);
      debouncedOnChange(newValue);
    });

    // On blur, flush pending debounce so parent state is up to date before e.g. tab switch
    const flushPending = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        const v = editor.getModel()?.getValue();
        if (v !== undefined) onChange(v);
      }
    };
    editor.onDidBlurEditorText(flushPending);

    // Memory cleanup on unmount
    const cleanup = () => {
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };

    // Store cleanup function for later use
    (editor as any)._cleanup = cleanup;
  }, [debouncedOnChange, onMonacoMount]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (monacoMountCleanupRef.current) {
        monacoMountCleanupRef.current();
        monacoMountCleanupRef.current = null;
      }
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  // Update editor value when prop changes (but avoid unnecessary updates)
  useEffect(() => {
    if (editorRef.current && editorRef.current.getValue() !== value) {
      editorRef.current.setValue(value);
    }
  }, [value]);

  // When enableSuggestions changes (e.g. switch to SQL), update editor options so autocomplete works
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      quickSuggestions: enableSuggestions ? { other: true, comments: false, strings: true } : false,
      suggestOnTriggerCharacters: enableSuggestions,
      acceptSuggestionOnEnter: enableSuggestions ? 'on' : 'off',
      tabCompletion: enableSuggestions ? 'on' : 'off',
      parameterHints: { enabled: enableSuggestions },
    });
  }, [enableSuggestions]);

  // Language-specific formatting options
  const getLanguageOptions = (lang: string) => {
    const baseOptions = {
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'on',
      folding: true,
      foldingStrategy: 'indentation' as const,
      showFoldingControls: 'always' as const,
      // Memory optimizations
      renderWhitespace: 'none' as const,
      renderControlCharacters: false,
      guides: { indentation: false, highlightActiveIndentation: false },
      renderLineHighlight: 'line' as const,
      occurrencesHighlight: 'off' as const,
      selectionHighlight: false,
      codeLens: false,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      acceptSuggestionOnEnter: 'off' as const,
      tabCompletion: 'off' as const,
      wordBasedSuggestions: 'off' as const,
      parameterHints: { enabled: false },
      hover: { enabled: false },
    };

    // Language-specific formatting
    if (lang === 'python') {
      return {
        ...baseOptions,
        tabSize: 4,
        insertSpaces: true,
        detectIndentation: false,
        trimAutoWhitespace: true,
        formatOnPaste: true,
        formatOnType: true,
      };
    } else if (lang === 'sql') {
      return {
        ...baseOptions,
        tabSize: 2,
        insertSpaces: true,
        detectIndentation: false,
        trimAutoWhitespace: true,
        formatOnPaste: true,
        formatOnType: true,
        quickSuggestions: { other: true, comments: false, strings: true },
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: 'on',
        tabCompletion: 'on',
        parameterHints: { enabled: true },
        quickSuggestionsDelay: 50,
      };
    }
    
    return {
      ...baseOptions,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
    };
  };

  // Optimized editor options with language-specific formatting
  const optimizedOptions = {
    ...getLanguageOptions(language),
    ...options
  };

  return (
    <div ref={containerRef} className={className} style={{ height, width: '100%' }}>
      <Editor
        height={height}
        language={language}
        theme={theme}
        value={value}
        onMount={handleEditorDidMount}
        options={optimizedOptions}
        loading={
          <div className="qe-monaco-loading">
            <AppLoadingIndicator variant="inline" tip={tEditor('loading_editor')} />
          </div>
        }
      />
    </div>
  );
}));

MemoryOptimizedEditor.displayName = 'MemoryOptimizedEditor';

export default MemoryOptimizedEditor;
