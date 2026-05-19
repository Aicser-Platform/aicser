import React, { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Tooltip, Select, Divider, ColorPicker } from 'antd';
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
  LinkOutlined,
  FontColorsOutlined,
} from '@ant-design/icons';
import './TextWidget.css';

interface TextWidgetProps {
  config: {
    content?: string;
    fontSize?: number;
    fontWeight?: string | number;
    color?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
  };
  onUpdate?: (updates: any) => void;
  readOnly?: boolean;
  isSelected?: boolean;
}

export const TextWidget: React.FC<TextWidgetProps> = ({ config, onUpdate, readOnly = false, isSelected = false }) => {
  const t = useTranslations('dash_widget');
  const { content = '', fontSize: configFontSize = 14, textAlign: configTextAlign = 'left' } = config;

  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      // Only save if the selection is within our editor
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

  // Sync content only if not currently editing
  useEffect(() => {
    if (!isEditing && editorRef.current) {
      editorRef.current.innerHTML = content || (readOnly ? '' : `<p style="color: #8b949e; font-style: italic;">${t('click_add_text')}</p>`);
    }
  }, [content, isEditing, readOnly]);

  const handleBlur = (e: React.FocusEvent) => {
    saveSelection();
    const relatedTarget = e.relatedTarget as HTMLElement;
    
    // Check if new focus is in toolbar or any dropdown/popup
    if (relatedTarget?.closest('.text-widget-toolbar') || 
        relatedTarget?.closest('.ant-select-dropdown') || 
        relatedTarget?.closest('.ant-color-picker-panel')) {
      return;
    }
    
    // Tiny delay to handle cases where relatedTarget is null briefly during portal transfers
    setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement?.closest('.text-widget-toolbar') || 
          activeElement?.closest('.ant-select-dropdown') || 
          activeElement?.closest('.ant-color-picker-panel')) {
        return;
      }
      
      const newContent = editorRef.current?.innerHTML || '';
      if (newContent !== content) {
        onUpdate?.({ content: newContent });
      }
      setIsEditing(false);
    }, 150);
  };

  const applyCommand = (e: React.MouseEvent | { preventDefault: () => void, stopPropagation: () => void }, command: string, value?: any) => {
    e.preventDefault();
    e.stopPropagation();

    editorRef.current?.focus();
    restoreSelection();

    const selection = window.getSelection();
    const isWithinEditor = selection && selection.anchorNode && editorRef.current?.contains(selection.anchorNode);

    if (command === 'fontSize') {
      if (isWithinEditor && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const fragment = range.cloneContents();
        const div = document.createElement('div');
        div.appendChild(fragment);
        const html = div.innerHTML;
        
        // Wrap the selected HTML in a span with the targeted pixel size
        document.execCommand('insertHTML', false, `<span style="font-size: ${value}px">${html}</span>`);
        saveSelection(); // Update saved selection
      } else {
        // No selection: We allow it to apply globally if nothing is selected
        // to handle the cases where users just want a quick resize.
        onUpdate?.({ fontSize: value });
      }
    } else {
      document.execCommand(command, false, value);
      saveSelection(); // Update saved selection
    }
    
    editorRef.current?.focus();
  };


  const handleFocus = () => {
    if (readOnly) return;
    setIsEditing(true);
    if (!content && editorRef.current?.innerText === t('click_add_text')) {
      editorRef.current.innerHTML = '<p><br></p>';
    }
  };

  const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 64];

  return (
    <div className={`text-widget-wrapper ${isEditing ? 'is-editing' : ''}`}>
      {(isEditing || isSelected) && !readOnly && (
        <div className="text-widget-toolbar" onMouseDown={e => e.preventDefault()} onClick={e => e.stopPropagation()}>
          <Tooltip title={t('bold')}><Button size="small" type="text" icon={<BoldOutlined />} onMouseDown={(e) => applyCommand(e, 'bold')} /></Tooltip>
          <Tooltip title={t('italic')}><Button size="small" type="text" icon={<ItalicOutlined />} onMouseDown={(e) => applyCommand(e, 'italic')} /></Tooltip>
          <Tooltip title={t('underline')}><Button size="small" type="text" icon={<UnderlineOutlined />} onMouseDown={(e) => applyCommand(e, 'underline')} /></Tooltip>
          <Tooltip title={t('strike')}><Button size="small" type="text" icon={<StrikethroughOutlined />} onMouseDown={(e) => applyCommand(e, 'strikeThrough')} /></Tooltip>
          
          <Divider type="vertical" />
          
          <Tooltip title={t('bullet_list')}><Button size="small" type="text" icon={<UnorderedListOutlined />} onMouseDown={(e) => applyCommand(e, 'insertUnorderedList')} /></Tooltip>
          <Tooltip title={t('number_list')}><Button size="small" type="text" icon={<OrderedListOutlined />} onMouseDown={(e) => applyCommand(e, 'insertOrderedList')} /></Tooltip>
          
          <Divider type="vertical" />
          
          <Tooltip title={t('align_left')}><Button size="small" type="text" icon={<AlignLeftOutlined />} onMouseDown={(e) => applyCommand(e, 'justifyLeft')} /></Tooltip>
          <Tooltip title={t('align_center')}><Button size="small" type="text" icon={<AlignCenterOutlined />} onMouseDown={(e) => applyCommand(e, 'justifyCenter')} /></Tooltip>
          <Tooltip title={t('align_right')}><Button size="small" type="text" icon={<AlignRightOutlined />} onMouseDown={(e) => applyCommand(e, 'justifyRight')} /></Tooltip>
          
          <Divider type="vertical" />

          <Tooltip title={t('text_color')}>
            <div onMouseDown={(e) => e.stopPropagation()} style={{ display: 'inline-block' }}>
              <ColorPicker
                size="small"
                onChange={(color: any) => {
                  const dummyEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;
                  applyCommand(dummyEvent, 'foreColor', color.toHexString());
                }}
              >
                <Button 
                  size="small" 
                  type="text" 
                  icon={<FontColorsOutlined />} 
                  onMouseDown={(e) => e.preventDefault()}
                />
              </ColorPicker>
            </div>
          </Tooltip>
          
          <Select 
            size="small" 
            value={configFontSize} 
            variant="borderless"
            className="font-size-select"
            onChange={(val) => {
              const dummyEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;
              applyCommand(dummyEvent, 'fontSize', val);
            }}
            options={FONT_SIZES.map(s => ({ label: `${s}px`, value: s }))}
            dropdownStyle={{ zIndex: 2000 }}
          />
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
          minHeight: '100%',
          flex: 1,
          padding: (isEditing || isSelected) && !readOnly ? '52px 8px 8px' : '8px',
        }}
        onClick={(e) => e.stopPropagation()}
        suppressContentEditableWarning={true}
      />
    </div>
  );
};
