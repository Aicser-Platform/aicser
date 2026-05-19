'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from 'antd';
import { 
    LeftOutlined, 
    RightOutlined, 
    UpOutlined, 
    DownOutlined 
} from '@ant-design/icons';

interface ResizablePanelProps {
    children: React.ReactNode;
    collapsed: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
    direction?: 'horizontal' | 'vertical';
    minSize?: number;
    maxSize?: number;
    defaultSize?: number;
    className?: string;
    style?: React.CSSProperties;
}

const ResizablePanel: React.FC<ResizablePanelProps> = ({
    children,
    collapsed,
    onCollapsedChange,
    direction = 'horizontal',
    minSize = 200,
    maxSize = 800,
    defaultSize = 300,
    className = '',
    style = {}
}) => {
    const [size, setSize] = useState(defaultSize);
    const [isResizing, setIsResizing] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const startPos = useRef(0);
    const startSize = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
        startSize.current = size;
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    }, [direction, size]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing) return;
        
        const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
        const delta = currentPos - startPos.current;
        const newSize = Math.max(minSize, Math.min(maxSize, startSize.current + delta));
        
        setSize(newSize);
    }, [isResizing, direction, minSize, maxSize]);

    const handleMouseUp = useCallback(() => {
        setIsResizing(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, [handleMouseMove]);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [handleMouseMove, handleMouseUp]);

    const toggleCollapsed = () => {
        onCollapsedChange(!collapsed);
    };

    const getCollapseIcon = () => {
        if (direction === 'horizontal') {
            return collapsed ? <RightOutlined /> : <LeftOutlined />;
        } else {
            return collapsed ? <DownOutlined /> : <UpOutlined />;
        }
    };

    const panelStyle: React.CSSProperties = {
        position: 'relative',
        transition: isResizing ? 'none' : 'all 0.3s ease',
        overflow: 'hidden',
        ...style
    };

    if (direction === 'horizontal') {
        panelStyle.width = collapsed ? '40px' : `${size}px`;
        panelStyle.minWidth = collapsed ? '40px' : `${minSize}px`;
        panelStyle.maxWidth = collapsed ? '40px' : `${maxSize}px`;
    } else {
        panelStyle.height = collapsed ? '40px' : `${size}px`;
        panelStyle.minHeight = collapsed ? '40px' : `${minSize}px`;
        panelStyle.maxHeight = collapsed ? '40px' : `${maxSize}px`;
    }

    const resizerStyle: React.CSSProperties = {
        position: 'absolute',
        backgroundColor: 'transparent',
        zIndex: 10,
        transition: 'background-color 0.2s ease'
    };

    if (direction === 'horizontal') {
        resizerStyle.right = 0;
        resizerStyle.top = 0;
        resizerStyle.bottom = 0;
        resizerStyle.width = '4px';
        resizerStyle.cursor = 'col-resize';
    } else {
        resizerStyle.bottom = 0;
        resizerStyle.left = 0;
        resizerStyle.right = 0;
        resizerStyle.height = '4px';
        resizerStyle.cursor = 'row-resize';
    }

    return (
        <div
            ref={panelRef}
            className={`resizable-panel ${className}`}
            style={panelStyle}
        >
            {/* Collapse/Expand Button */}
            <div
                style={{
                    position: 'absolute',
                    top: '8px',
                    [direction === 'horizontal' ? 'right' : 'left']: '8px',
                    zIndex: 20
                }}
            >
                <Button
                    type="text"
                    size="small"
                    icon={getCollapseIcon()}
                    onClick={toggleCollapsed}
                    style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        border: '1px solid #d9d9d9',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}
                />
            </div>

            {/* Panel Content */}
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    overflow: collapsed ? 'hidden' : 'auto',
                    opacity: collapsed ? 0 : 1,
                    transition: 'opacity 0.3s ease'
                }}
            >
                {children}
            </div>

            {/* Resizer Handle */}
            {!collapsed && (
                <div
                    style={resizerStyle}
                    onMouseDown={handleMouseDown}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(24, 144, 255, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                        if (!isResizing) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                        }
                    }}
                />
            )}

            {/* Resizing Indicator */}
            {isResizing && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.1)',
                        zIndex: 9999,
                        pointerEvents: 'none'
                    }}
                />
            )}
        </div>
    );
};

export default ResizablePanel;