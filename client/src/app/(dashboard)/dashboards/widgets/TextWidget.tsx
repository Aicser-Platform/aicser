import React, { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Tooltip, Select, ColorPicker, Input } from 'antd';
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  StrikethroughOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  FontColorsOutlined,
} from '@ant-design/icons';
import './TextWidget.css';

/** Compact toolbar group separator (CSS only — no Ant Divider “|” chrome). */
function ToolbarSep() {
  return <span className="text-widget-toolbar-sep" aria-hidden />;
}

interface TextWidgetProps {
  config: {
    content?: string;
    fontSize?: number;
    fontWeight?: string | number;
    color?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    /** Widget title — rendered as an integrated document heading (not a separate card chrome). */
    title?: string;
  };
  onUpdate?: (updates: Record<string, unknown>) => void;
  readOnly?: boolean;
  isSelected?: boolean;
}

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 64];

export const TextWidget: React.FC<TextWidgetProps> = ({
  config,
  onUpdate,
  readOnly = false,
  isSelected = false,
}) => {
  const t = useTranslations('dash_widget');
  const {
    content = '',
    fontSize: configFontSize = 14,
    textAlign: configTextAlign = 'left',
    title = '',
  } = config;

  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(title);
  }, [title, editingTitle]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }
  };

  const restoreSelection = () => {
    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedSelectionRef.current);
      }
    }
  };

  useEffect(() => {
    if (!isEditing && editorRef.current) {
      editorRef.current.innerHTML =
        content ||
        (readOnly ? '' : `<p class="text-widget-placeholder">${t('click_add_text')}</p>`);
    }
  }, [content, isEditing, readOnly, t]);

  const handleBlur = (e: React.FocusEvent) => {
    saveSelection();
    const relatedTarget = e.relatedTarget as HTMLElement;

    if (
      relatedTarget?.closest('.text-widget-toolbar') ||
      relatedTarget?.closest('.ant-select-dropdown') ||
      relatedTarget?.closest('.ant-color-picker-panel')
    ) {
      return;
    }

    setTimeout(() => {
      const activeElement = document.activeElement;
      if (
        activeElement?.closest('.text-widget-toolbar') ||
        activeElement?.closest('.ant-select-dropdown') ||
        activeElement?.closest('.ant-color-picker-panel')
      ) {
        return;
      }

      const newContent = editorRef.current?.innerHTML || '';
      const cleaned = newContent.replace(/<p class="text-widget-placeholder">[\s\S]*?<\/p>/g, '').trim();
      if (cleaned !== content) {
        onUpdate?.({ content: cleaned || newContent });
      }
      setIsEditing(false);
    }, 150);
  };

  const applyCommand = (
    e: React.MouseEvent | { preventDefault: () => void; stopPropagation: () => void },
    command: string,
    value?: string | number,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    editorRef.current?.focus();
    restoreSelection();

    const selection = window.getSelection();
    const isWithinEditor =
      selection && selection.anchorNode && editorRef.current?.contains(selection.anchorNode);

    if (command === 'fontSize') {
      if (isWithinEditor && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const fragment = range.cloneContents();
        const div = document.createElement('div');
        div.appendChild(fragment);
        document.execCommand(
          'insertHTML',
          false,
          `<span style="font-size: ${value}px">${div.innerHTML}</span>`,
        );
        saveSelection();
      } else {
        onUpdate?.({ fontSize: value });
      }
    } else {
      document.execCommand(command, false, value as string | undefined);
      saveSelection();
    }

    editorRef.current?.focus();
  };

  const handleFocus = () => {
    if (readOnly) return;
    setIsEditing(true);
    if (!content && editorRef.current?.querySelector('.text-widget-placeholder')) {
      editorRef.current.innerHTML = '<p><br></p>';
    }
  };

  const commitTitle = () => {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (next !== title.trim()) {
      onUpdate?.({ __widgetTitle: next });
    }
  };

  // Toolbar only while editing so selection chrome stays a thin rule and body space is preserved.
  const showToolbar = isEditing && !readOnly;
  const heading = title.trim();

  return (
    <div
      className={`text-widget-wrapper${isEditing ? ' is-editing' : ''}${isSelected ? ' is-selected' : ''}${readOnly ? ' is-readonly' : ''}`}
    >
      {heading || (!readOnly && isSelected) ? (
        <div className="text-widget-heading-row no-drag">
          {editingTitle && !readOnly ? (
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onPressEnter={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setTitleDraft(title);
                  setEditingTitle(false);
                }
              }}
              autoFocus
              size="small"
              className="text-widget-heading-input"
              onClick={(e) => e.stopPropagation()}
              placeholder={t('text_title_placeholder', { defaultMessage: 'Section title' })}
            />
          ) : heading ? (
            <h2
              className="text-widget-heading"
              onDoubleClick={(e) => {
                if (readOnly) return;
                e.preventDefault();
                e.stopPropagation();
                setEditingTitle(true);
              }}
              title={!readOnly ? t('double_click_edit_title', { defaultMessage: 'Double-click to rename' }) : undefined}
            >
              {heading}
            </h2>
          ) : (
            <button
              type="button"
              className="text-widget-heading-add no-drag"
              onClick={(e) => {
                e.stopPropagation();
                setEditingTitle(true);
              }}
            >
              {t('add_title', { defaultMessage: 'Add title' })}
            </button>
          )}
        </div>
      ) : null}

      {showToolbar && (
        <div
          className="text-widget-toolbar"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-widget-toolbar-group">
            <Tooltip title={t('bold')}>
              <Button size="small" type="text" icon={<BoldOutlined />} onMouseDown={(e) => applyCommand(e, 'bold')} />
            </Tooltip>
            <Tooltip title={t('italic')}>
              <Button size="small" type="text" icon={<ItalicOutlined />} onMouseDown={(e) => applyCommand(e, 'italic')} />
            </Tooltip>
            <Tooltip title={t('underline')}>
              <Button size="small" type="text" icon={<UnderlineOutlined />} onMouseDown={(e) => applyCommand(e, 'underline')} />
            </Tooltip>
            <Tooltip title={t('strike')}>
              <Button
                size="small"
                type="text"
                icon={<StrikethroughOutlined />}
                onMouseDown={(e) => applyCommand(e, 'strikeThrough')}
              />
            </Tooltip>
          </div>

          <ToolbarSep />

          <div className="text-widget-toolbar-group">
            <Tooltip title={t('bullet_list')}>
              <Button
                size="small"
                type="text"
                icon={<UnorderedListOutlined />}
                onMouseDown={(e) => applyCommand(e, 'insertUnorderedList')}
              />
            </Tooltip>
            <Tooltip title={t('number_list')}>
              <Button
                size="small"
                type="text"
                icon={<OrderedListOutlined />}
                onMouseDown={(e) => applyCommand(e, 'insertOrderedList')}
              />
            </Tooltip>
          </div>

          <ToolbarSep />

          <div className="text-widget-toolbar-group">
            <Tooltip title={t('align_left')}>
              <Button size="small" type="text" icon={<AlignLeftOutlined />} onMouseDown={(e) => applyCommand(e, 'justifyLeft')} />
            </Tooltip>
            <Tooltip title={t('align_center')}>
              <Button
                size="small"
                type="text"
                icon={<AlignCenterOutlined />}
                onMouseDown={(e) => applyCommand(e, 'justifyCenter')}
              />
            </Tooltip>
            <Tooltip title={t('align_right')}>
              <Button
                size="small"
                type="text"
                icon={<AlignRightOutlined />}
                onMouseDown={(e) => applyCommand(e, 'justifyRight')}
              />
            </Tooltip>
          </div>

          <ToolbarSep />

          <div className="text-widget-toolbar-group">
            <Tooltip title={t('text_color')}>
              <div onMouseDown={(e) => e.stopPropagation()} className="text-widget-color-trigger">
                <ColorPicker
                  size="small"
                  onChange={(color: { toHexString: () => string }) => {
                    const dummyEvent = { preventDefault: () => {}, stopPropagation: () => {} };
                    applyCommand(dummyEvent, 'foreColor', color.toHexString());
                  }}
                >
                  <Button size="small" type="text" icon={<FontColorsOutlined />} onMouseDown={(e) => e.preventDefault()} />
                </ColorPicker>
              </div>
            </Tooltip>

            <Select
              size="small"
              value={configFontSize}
              variant="borderless"
              className="font-size-select"
              onChange={(val) => {
                const dummyEvent = { preventDefault: () => {}, stopPropagation: () => {} };
                applyCommand(dummyEvent, 'fontSize', val);
              }}
              options={FONT_SIZES.map((s) => ({ label: `${s}px`, value: s }))}
              dropdownStyle={{ zIndex: 2000 }}
              popupMatchSelectWidth={false}
            />
          </div>
        </div>
      )}

      <div
        ref={editorRef}
        className={`text-widget-editor no-drag ${readOnly ? 'read-only' : ''}`}
        contentEditable={!readOnly}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        style={{
          fontSize: `${configFontSize}px`,
          textAlign: configTextAlign,
          color: config.color || undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        suppressContentEditableWarning
      />
    </div>
  );
};
