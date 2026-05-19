// Shared Dashboard Types
// Consolidated from various components to avoid duplication

export interface DashboardWidget {
    id: string;
    type:
        | 'chart'
        | 'metric'
        | 'table'
        | 'text'
        | 'image'
        | 'filter'
        | 'kpi'
        | 'gauge'
        | 'heatmap'
        | 'funnel'
        | 'radar'
        | 'scatter'
        | 'area'
        | 'line'
        | 'bar'
        | 'pie';
    title: string;
    subtitle?: string;
    position: { x: number; y: number; w: number; h: number };
    config: any;
    options?: any; // For comprehensive defaults compatibility
    dataSource?: string;
    refreshInterval?: number;
    isVisible: boolean;
    isLocked: boolean;

    // Layout & Style Properties (Tableau-style)
    layout?: {
        // Positioning
        x: number;
        y: number;
        width: number;
        height: number;
        minWidth?: number;
        minHeight?: number;
        maxWidth?: number;
        maxHeight?: number;

        // Responsive behavior
        responsive: boolean;
        breakpoints?: {
            xs?: { w: number; h: number };
            sm?: { w: number; h: number };
            md?: { w: number; h: number };
            lg?: { w: number; h: number };
            xl?: { w: number; h: number };
        };

        // Grid behavior
        static?: boolean;
        isDraggable?: boolean;
        isResizable?: boolean;
        isBounded?: boolean;

        // Container properties
        containerPadding?: [number, number];
        margin?: [number, number];
    };

    style?: {
        // Background & Borders
        backgroundColor?: string;
        borderColor?: string;
        borderWidth?: number;
        borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
        borderRadius?: number;

        // Spacing & Padding
        padding?: number | [number, number] | [number, number, number, number];
        margin?: number | [number, number] | [number, number, number, number];

        // Typography
        fontSize?: number;
        fontWeight?: 'normal' | 'bold' | 'lighter' | 'bolder' | number;
        fontFamily?: string;
        textAlign?: 'left' | 'center' | 'right';
        color?: string;
        lineHeight?: number;

        // Effects & Animation
        shadow?: string;
        opacity?: number;
        zIndex?: number;
        transform?: string;
        transition?: string;
        animation?: string;
    };

    // Interaction & Behavior
    behavior?: {
        clickable?: boolean;
        hoverable?: boolean;
        selectable?: boolean;
        draggable?: boolean;
        resizable?: boolean;
        onHover?: 'highlight' | 'tooltip' | 'none';
        onClick?: 'select' | 'drill' | 'navigate' | 'none';
    };

    // Data & Refresh
    data?: {
        source?: string;
        query?: string;
        refreshInterval?: number;
        autoRefresh?: boolean;
        cache?: boolean;
        cacheTimeout?: number;
        // If widget is bound to a saved query snapshot
        snapshotId?: string | number;
    };

    // Widget-specific properties
    chart?: {
        type:
            | 'bar'
            | 'line'
            | 'pie'
            | 'area'
            | 'scatter'
            | 'radar'
            | 'heatmap'
            | 'funnel'
            | 'gauge';
        options?: any;
        colors?: string[];
        animation?: boolean;
        legend?: boolean;
        tooltip?: boolean;
        grid?: boolean;
    };

    filter?: {
        type: 'dropdown' | 'dateRange' | 'slider' | 'search' | 'checkbox';
        field: string;
        options?: any[];
        defaultValue?: any;
        isGlobal?: boolean;
        affects?: string[];
    };

    // Enhanced properties
    tags?: string[];
    description?: string;
    author?: string;
    createdAt?: Date;
    updatedAt?: Date;
    version?: string;
    isTemplate?: boolean;
    isPublic?: boolean;
    likes?: number;
    downloads?: number;
}

export interface DashboardFilter {
    id: string;
    name: string;
    type: 'dropdown' | 'dateRange' | 'slider' | 'search' | 'checkbox';
    field: string;
    options?: any[];
    defaultValue?: any;
    isGlobal?: boolean;
    affects?: string[];
}

export interface DashboardTheme {
    id: string;
    name: string;
    colors: {
        primary: string;
        secondary: string;
        background: string;
        surface: string;
        text: string;
        textSecondary: string;
    };
    typography: {
        fontFamily: string;
        fontSize: number;
        fontWeight: string;
    };
    spacing: {
        padding: number;
        margin: number;
        borderRadius: number;
    };
    isDark: boolean;
}

export interface DashboardLayout {
    id: string;
    name: string;
    columns: number;
    rows: number;
    breakpoints: {
        xs: number;
        sm: number;
        md: number;
        lg: number;
        xl: number;
    };
    containerPadding: [number, number];
    margin: [number, number];
}

export interface DashboardConfig {
    id: string;
    name: string;
    description?: string;
    widgets: DashboardWidget[];
    filters: DashboardFilter[];
    theme: DashboardTheme;
    layout: DashboardLayout;
    settings: {
        autoSave: boolean;
        autoRefresh: boolean;
        refreshInterval: number;
        allowEdit: boolean;
        allowShare: boolean;
        allowExport: boolean;
    };
    metadata: {
        createdBy: string;
        createdAt: Date;
        updatedAt: Date;
        version: string;
        tags: string[];
    };
}

// Simplified widget interface for Zustand store
export interface Widget {
    id: string;
    type: string;
    title: string;
    config: any;
    data?: any;
    position: { x: number; y: number; w: number; h: number };
}

// Enhanced widget interface for UnifiedDesignPanel
export interface EnhancedDashboardWidget {
    id: string;
    type: string;
    title: string;
    name: string;
    icon: React.ReactNode;
    category: string;
    tooltip: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    config?: any;
    data?: any;
    content?: string;
    style: {
        backgroundColor: string;
        borderColor: string;
        borderRadius: number;
        padding: number;
        shadow: string;
        opacity: number;
        zIndex: number;
        fontSize?: number;
        fontWeight?: string;
        textAlign?: 'left' | 'center' | 'right';
        color?: string;
    };
    isVisible: boolean;
    isSelected: boolean;
    isLocked: boolean;
    isResizable: boolean;
    isDraggable: boolean;
    refreshInterval?: number;
    lastRefresh?: Date;
    dataSource?: string;
    query?: string;
    filters?: string[];
    parameters?: string[];
    tags?: string[];
    description?: string;
    author?: string;
    createdAt?: Date;
    updatedAt?: Date;
    version?: string;
    isTemplate?: boolean;
    isPublic?: boolean;
    likes?: number;
    downloads?: number;
}
