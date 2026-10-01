'use client';

import { App as AntdApp, ConfigProvider, theme } from 'antd';
import { MULTILINGUAL_FONT_STACK } from '@/config/typography';
import { ThemeModeContext } from './ThemeModeContext';
import AntdMessageBridgeConnector from './AntdMessageBridgeConnector';
import { ReactNode, useLayoutEffect, useState, useEffect, useMemo } from 'react';
import {
    accessiblePrimary, contrastRatio, primaryLinkTokens, primaryTintTokens, statusTintTokens, darkenForWhiteText, hexToRgb, pickReadableTextColor, relativeLuminance,
} from '@/utils/colorContrast';

const BRAND_THEME_STORAGE_KEY = 'aiser_brand_theme_vars';
/** light | dark | auto — synced from Settings → General; header toggle sets light/dark explicitly */
const AISER_THEME_MODE_KEY = 'aiser_theme_mode';

/**
 * Light-mode surface layers (dark mode keeps its own values). As in Ant Design, Material 3 and
 * GitHub Primer, the page is a soft neutral canvas and content sits on white surfaces above it;
 * popups are white with a shadow. Decorative edges (cards, tables, dividers) are light; edges a
 * person must find to act on (inputs, buttons) keep the stronger WCAG 1.4.11 border.
 */
const LIGHT = {
    canvas: '#f0f2f5', // page background, sidebar (Ant Design Pro's layout grey: visibly a layer, not glare)
    surface: '#ffffff', // cards, panels, tables, forms, inputs, popups
    subtle: '#f6f8fa', // table headers, quiet fills
    edge: '#d0d7de', // card / table / divider lines
    control: '#8c959f', // input, select, picker and button edges (3:1 against white, WCAG 1.4.11)
} as const;

function readEffectiveDarkFromStorage(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const mode = window.localStorage.getItem(AISER_THEME_MODE_KEY);
        if (mode === 'dark') return true;
        if (mode === 'light') return false;
        if (mode === 'auto') {
            return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
        }
        const legacy = window.localStorage.getItem('darkMode');
        if (legacy !== null) return legacy === 'true';
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
        return false;
    }
}

/** Reads the brand color overrides set by the (EE) ThemeCustomizer, if any. */
function readBrandTokens(isDarkMode: boolean): Record<string, string> {
    if (typeof window === 'undefined') return {};
    try {
        const stored = window.localStorage.getItem(BRAND_THEME_STORAGE_KEY);
        if (!stored) return {};
        const parsed = JSON.parse(stored);
        return parsed.light && parsed.dark ? (isDarkMode ? parsed.dark : parsed.light) : parsed;
    } catch {
        return {};
    }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => readEffectiveDarkFromStorage());

    // Settings page, other tabs, and system preference (when mode is auto)
    useEffect(() => {
        const apply = () => setIsDarkMode(readEffectiveDarkFromStorage());
        apply();
        const onStorage = (e: StorageEvent) => {
            if (e.key === AISER_THEME_MODE_KEY || e.key === 'darkMode') apply();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('aiser-theme-preference', apply);
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        mql.addEventListener('change', apply);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('aiser-theme-preference', apply);
            mql.removeEventListener('change', apply);
        };
    }, []);

    // Calculate navigation background - always use theme-appropriate default
    // IMPORTANT: Dark mode = #030712 (Aiser obsidian navy), Light mode = the page canvas
    // This is recalculated on every render to ensure it updates when isDarkMode changes
    // We ignore any stale custom values to prevent colors from getting stuck
    const getNavigationBg = () => {
        if (typeof window === 'undefined') {
            return isDarkMode ? '#030712' : LIGHT.canvas;
        }
        // Always use theme-appropriate default to prevent stuck colors after multiple toggles
        // Dark mode = brand obsidian navy (#030712), Light mode = off-white (#fafafa)
        return isDarkMode ? '#030712' : LIGHT.canvas;
    };
    
    // Recalculate navigationBg whenever isDarkMode changes
    const navigationBg = getNavigationBg();

    const resolveCSSVar = (varName: string, fallback: string) => {
        if (typeof window === 'undefined') {
            return fallback;
        }
        const value = getComputedStyle(document.documentElement).getPropertyValue(varName)?.trim();
        return value || fallback;
    };

    // Brand color overrides from the (EE) ThemeCustomizer — falls back to the Aiser teal.
    const brandTokens = useMemo(() => readBrandTokens(isDarkMode), [isDarkMode]);
    // The brand colour as the UI uses it: darkened in light mode until labels on it and links in
    // it pass WCAG AA (the default teal is ~2.2:1 on white); unchanged in dark mode.
    const primaryShades = useMemo(
        () => brandTokens['--ant-primary-color']
            ? accessiblePrimary(brandTokens['--ant-primary-color'], isDarkMode,
                brandTokens['--ant-primary-color-hover'], brandTokens['--ant-primary-color-active'])
            : accessiblePrimary('#00c2cb', isDarkMode, '#00a5af', '#008b95'),
        [brandTokens, isDarkMode]
    );
    const primaryColor = primaryShades.base;
    const primaryColorHover = primaryShades.hover;
    const primaryColorActive = primaryShades.active;
    const primaryColorOutline =
        brandTokens['--ant-primary-color-outline'] ||
        (isDarkMode ? 'rgba(0, 194, 203, 0.22)' : 'rgba(0, 194, 203, 0.14)');
    // Readable label color for anything filled with primaryColor (buttons,
    // selected menu item, tags) - adapts to brand overrides instead of
    // assuming white always works (the default teal fails white at ~2.2:1).
    const primaryColorText = useMemo(
        () => pickReadableTextColor(primaryColor, '#0d1117', '#ffffff'),
        [primaryColor]
    );
    // Guaranteed-readable-for-white-text versions of the primary gradient
    // stops, for surfaces (e.g. the chat user-message bubble) that always
    // want white text rather than switching to dark text on light brand
    // colors - darkening the background instead keeps both legible.
    const primaryBubbleBg = useMemo(() => darkenForWhiteText(primaryColor), [primaryColor]);
    // Selected sidebar item text: the brand colour, kept AA-readable on its tint - darkened in light
    // mode; in dark mode the brand colour itself unless it's too dark to read there.
    const navSelectedText = useMemo(() => {
        if (!isDarkMode) return darkenForWhiteText(primaryColor, 5.6);
        const rgb = hexToRgb(primaryColor);
        const dark = relativeLuminance(13, 17, 23); // #0d1117
        return rgb && contrastRatio(relativeLuminance(...rgb), dark) >= 4.5 ? primaryColor : '#e6edf3';
    }, [isDarkMode, primaryColor]);
    const primaryBubbleBgHover = useMemo(
        () => darkenForWhiteText(primaryColorHover),
        [primaryColorHover]
    );

    const navigationSiderBg = useMemo(
        () => resolveCSSVar('--color-bg-navigation-sider', isDarkMode ? '#030712' : LIGHT.canvas),
        [isDarkMode]
    );

    const navigationHeaderBg = useMemo(
        () => resolveCSSVar('--color-bg-navigation-header', isDarkMode ? '#10131c' : LIGHT.canvas),
        [isDarkMode]
    );

    const navigationHeaderGlow = useMemo(
        () => resolveCSSVar('--color-bg-navigation-header-glow', isDarkMode ? '#1c2432' : '#dfe4ec'),
        [isDarkMode]
    );
    
    // Listen for navigation background changes from BrandThemeProvider
    useEffect(() => {
        const handleThemeTokenUpdate = (e: CustomEvent) => {
            if (e.detail?.token === '--color-bg-navigation') {
                // Force re-render to pick up new navigation color
                setIsDarkMode(prev => prev);
            }
        };
        window.addEventListener('theme-token-updated', handleThemeTokenUpdate as EventListener);
        return () => window.removeEventListener('theme-token-updated', handleThemeTokenUpdate as EventListener);
    }, []);
    
    // Apply theme changes immediately and persist to localStorage
    useLayoutEffect(() => {
        // Persist to localStorage
        try {
            window.localStorage.setItem('darkMode', isDarkMode.toString());
        } catch (e) {
            console.warn('Failed to persist theme preference:', e);
        }
        
        // Apply to DOM
        const root = document.documentElement;
        if (isDarkMode) {
            root.classList.add('dark');
            root.setAttribute('data-theme', 'dark');
        } else {
            root.classList.remove('dark');
            root.setAttribute('data-theme', 'light');
        }
        
        // Sync Ant Design theme tokens to CSS variables for CSS file usage
        // This ensures CSS files can use var(--ant-color-bg-layout) etc.
        // Simplified 5-color system for clear hierarchy
        // All variables are synchronized - no duplicates or conflicts
        
        const themeDefaultNav = isDarkMode ? '#030712' : LIGHT.canvas;
        const themeDefaultSider = isDarkMode ? '#030712' : LIGHT.canvas;
        const themeDefaultHeader = isDarkMode ? '#10131c' : LIGHT.canvas;
        const themeDefaultHeaderGlow = isDarkMode ? '#1c2432' : '#dfe4ec';
        
        const tokens = {
            // 1. Base Background (Page/Layout) - Darkest/Lightest
            '--ant-color-bg-layout': isDarkMode ? '#0d1117' : LIGHT.canvas,
            '--color-bg-base': isDarkMode ? '#0d1117' : LIGHT.canvas,
            
            // 2. Container Background (Cards, Panels, Tables, Forms)
            '--ant-color-bg-container': isDarkMode ? '#161b22' : LIGHT.surface,
            '--color-bg-container': isDarkMode ? '#161b22' : LIGHT.surface,
            
            // 3. Elevated Background (Modals, Dropdowns, Hover states, Table headers)
            '--ant-color-bg-elevated': isDarkMode ? '#1c2128' : LIGHT.surface,
            '--color-bg-elevated': isDarkMode ? '#1c2128' : LIGHT.surface,
            
            // 4. Navigation Background (Header, Sidebar, Menu) - Use custom brand values when present
            '--ant-color-bg-navigation': brandTokens['--color-bg-navigation'] || themeDefaultNav,
            '--color-bg-navigation': brandTokens['--color-bg-navigation'] || themeDefaultNav,
            '--color-bg-navigation-sider': brandTokens['--color-bg-navigation-sider'] || themeDefaultSider,
            '--color-bg-navigation-header': brandTokens['--color-bg-navigation-header'] || themeDefaultHeader,
            '--color-bg-navigation-header-glow': brandTokens['--color-bg-navigation-header-glow'] || themeDefaultHeaderGlow,
            // Hover on the canvas-coloured navigation: one visible step darker than the canvas
            '--ant-color-bg-navigation-hover': isDarkMode ? '#0b162e' : '#e4e7eb',
            
            // 5. Border/Divider - Single consistent color. WCAG 1.4.11
            // non-text contrast minimum is 3:1; the prior #30363d/#e1e4e8
            // measured ~1.4:1/1.2:1 against the container background in each
            // mode - card, table, and divider edges were effectively invisible.
            '--ant-color-border': isDarkMode ? '#67717d' : '#7a7f85',
            '--color-border': isDarkMode ? '#67717d' : '#7a7f85',
            '--ant-color-border-secondary': isDarkMode ? '#67717d' : LIGHT.edge,
            // Edges of form controls (inputs, selects, date pickers) - one value for all of them.
            '--color-border-control': isDarkMode ? '#67717d' : LIGHT.control,

            // Text Colors - Clear hierarchy (synchronized)
            '--ant-color-text': isDarkMode ? '#e6edf3' : '#24292f',
            '--color-text-primary': isDarkMode ? '#e6edf3' : '#24292f',
            '--ant-color-text-secondary': isDarkMode ? '#8b949e' : '#57606a',
            '--color-text-secondary': isDarkMode ? '#8b949e' : '#57606a',
            // Light-mode values are WCAG 2.1 AA-verified (>=4.5:1 tertiary,
            // >=3:1 quaternary) against both the surface (#ffffff) and the page
            // canvas (#f0f2f5) backgrounds - the prior #8b949e/#bfbfbf measured only
            // 2.9:1/1.7:1, failing even the large-text/UI-component minimum.
            '--ant-color-text-tertiary': isDarkMode ? '#6e7681' : '#5f6773',
            '--color-text-tertiary': isDarkMode ? '#6e7681' : '#5f6773',
            '--ant-color-text-quaternary': isDarkMode ? '#6b7280' : '#7c8590',
            
            // Primary Color - Consistent (all variants synchronized), driven by brand overrides
            '--ant-color-primary': primaryColor,
            '--color-primary': primaryColor,
            '--ant-primary-color': primaryColor, // Ant Design alias
            '--ant-color-primary-hover': primaryColorHover,
            '--color-primary-hover': primaryColorHover,
            '--ant-primary-color-hover': primaryColorHover, // Ant Design alias
            '--ant-color-primary-active': primaryColorActive,
            '--color-primary-active': primaryColorActive,
            '--ant-primary-color-active': primaryColorActive, // Ant Design alias
            '--ant-color-primary-bg': primaryShades.tints?.bg ?? primaryColorOutline,
            '--ant-primary-color-outline': primaryColorOutline,
            // Readable label color for anything filled with primaryColor - for
            // CSS files that can't do antd's colorTextLightSolid token merge
            // (e.g. `color: var(--color-primary-text, #fff)` in place of a
            // hardcoded `color: #fff` on a primaryColor background).
            '--color-primary-text': primaryColorText,
            // Darkened gradient stops guaranteeing AA contrast for fixed white
            // text (e.g. chat user-message bubble) - see darkenForWhiteText().
            '--color-primary-bubble-bg': primaryBubbleBg,
            '--color-primary-bubble-bg-hover': primaryBubbleBgHover,

            // Functional Colors - Minimal usage
            '--ant-color-success': '#16a34a',
            '--ant-color-warning': '#f97316',
            '--ant-color-error': '#dc2626',
            '--ant-color-info': '#0891b2',
            
            // Fill Colors - Use elevated/container for consistency
            '--ant-color-fill': isDarkMode ? '#1c2128' : '#f1f3f5',
            '--ant-color-fill-secondary': isDarkMode ? '#1c2128' : '#f1f3f5',
            '--ant-color-fill-tertiary': isDarkMode ? '#161b22' : LIGHT.subtle,
        };
        
        // Apply CSS variables to root element with !important priority
        // This ensures our values override any from BrandThemeProvider or Ant Design
        Object.entries(tokens).forEach(([key, value]) => {
            root.style.setProperty(key, value);
        });
        
        // Remove deprecated variables that might conflict
        const deprecatedVars = [
            '--ant-color-bg-header',
            '--ant-color-bg-sider',
            '--ant-color-bg-content',
        ];
        deprecatedVars.forEach(key => {
            root.style.removeProperty(key);
        });
    }, [isDarkMode, brandTokens, primaryShades, primaryColor, primaryColorHover, primaryColorActive, primaryColorOutline, primaryColorText, primaryBubbleBg, primaryBubbleBgHover]);

    // Wrapper to ensure persistence on every change
    const setDarkModeWithPersistence = (value: boolean | ((prev: boolean) => boolean)) => {
        setIsDarkMode(prev => {
            const newValue = typeof value === 'function' ? value(prev) : value;
            try {
                window.localStorage.setItem('darkMode', newValue.toString());
                window.localStorage.setItem(AISER_THEME_MODE_KEY, newValue ? 'dark' : 'light');
            } catch (e) {
                console.warn('Failed to persist theme preference:', e);
            }
            return newValue;
        });
    };

    return (
        <ThemeModeContext.Provider value={{ isDarkMode, setIsDarkMode: setDarkModeWithPersistence }}>
            <ConfigProvider
                theme={{
                    algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
                    token: {
                        // Core brand colors - follows the (EE) ThemeCustomizer's brand overrides
                        colorPrimary: primaryColor,
                        colorPrimaryHover: primaryColorHover,
                        colorPrimaryActive: primaryColorActive,
                        controlOutline: primaryColorOutline,
                        // Text color for anything filled with colorPrimary (Button
                        // type="primary", Tag, Badge, ...) - white on the default
                        // teal measured ~2.2:1, failing WCAG AA; adapts per the
                        // actual resolved primary color instead of assuming white.
                        colorTextLightSolid: primaryColorText,
                        ...primaryTintTokens(primaryShades),
                        ...primaryLinkTokens(primaryShades, isDarkMode),
                        colorSuccess: '#16a34a',
                        colorWarning: '#f97316',
                        colorError: '#dc2626',
                        colorInfo: '#0891b2',
                        ...statusTintTokens(isDarkMode, { success: '#16a34a', warning: '#f97316', error: '#dc2626', info: '#0891b2' }),
                        
                        // Simplified 5-color system - synchronized with CSS variables
                        colorBgLayout: isDarkMode ? '#0d1117' : LIGHT.canvas, // 1. Base (page background)
                        colorBgContainer: isDarkMode ? '#161b22' : LIGHT.surface, // 2. Container (cards, panels, tables, forms)
                        colorBgElevated: isDarkMode ? '#1c2128' : LIGHT.surface, // 3. Elevated (modals, dropdowns, hover, table headers)
                        // antd's own default (colorFillTertiary: 8%/4% white/black overlay) measures
                        // ~1.1-1.3:1 against colorBgElevated above - barely perceptible as a hover
                        // cue on a plain <Dropdown menu={...}> popup (Select/Menu get their own
                        // component-level overrides below for the same reason). A brand tint keeps
                        // a visible hue shift regardless of how dark/light the popup surface is.
                        controlItemBgHover: primaryColorOutline,

                        // Text tokens - Clear hierarchy (synchronized with CSS variables)
                        colorText: isDarkMode ? '#e6edf3' : '#24292f',
                        colorTextSecondary: isDarkMode ? '#8b949e' : '#57606a',
                        colorTextTertiary: isDarkMode ? '#6e7681' : '#5f6773',
                        colorTextQuaternary: isDarkMode ? '#6b7280' : '#7c8590',
                        
                        // Border tokens - Single consistent color (synchronized)
                        colorBorder: isDarkMode ? '#67717d' : LIGHT.control,
                        colorBorderSecondary: isDarkMode ? '#67717d' : LIGHT.edge,
                        
                        // Typography - Enhanced for premium feel
                        fontSize: 14,
                        fontFamily: MULTILINGUAL_FONT_STACK,
                        fontSizeHeading1: 38,
                        fontSizeHeading2: 30,
                        fontSizeHeading3: 24,
                        fontSizeHeading4: 20,
                        fontSizeHeading5: 16,
                        lineHeight: 1.6,
                        lineHeightHeading1: 1.2,
                        lineHeightHeading2: 1.3,
                        lineHeightHeading3: 1.4,
                        
                        // Spacing and borders - shadcn-flavored rounding
                        borderRadius: 10,
                        borderRadiusXS: 2,
                        borderRadiusSM: 6,
                        borderRadiusLG: 14,

                        // Control heights
                        controlHeight: 32,
                        controlHeightLG: 40,
                        controlHeightSM: 24,

                        // Motion
                        motionDurationSlow: '0.3s',
                        motionDurationMid: '0.2s',
                        motionDurationFast: '0.1s',

                        // Flat shadcn-style shadows
                        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
                        boxShadowSecondary:
                            '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
                    },
                    components: {
                        Layout: {
                            // Simplified 5-color system
                            bodyBg: isDarkMode ? '#0d1117' : LIGHT.canvas, // 1. Base
                            headerBg: navigationHeaderBg, // 4. Navigation (uses custom value if set)
                            siderBg: navigationSiderBg, // 4. Navigation (uses custom value if set)
                        },
                        Menu: {
                            // Menu uses navigation color (matches sidebar/header)
                            itemBg: navigationSiderBg, // 4. Navigation (uses custom value if set)
                            // Selected item: a brand tint with brand-coloured text (a solid brand bar
                            // was the loudest thing on every page); the text is darkened as needed to
                            // stay AA-readable on the tint, whatever the brand colour.
                            itemSelectedBg: primaryColorOutline,
                            itemSelectedColor: navSelectedText,
                            // Popup background is navigationSiderBg below (popupBg) - this used to
                            // be a fixed Elevated-tier gray, which measures ~1:1-1.24:1 against
                            // that background (imperceptible, and worse against a custom brand
                            // navigation color). A brand-tinted overlay keeps a visible hue shift
                            // regardless of how light/dark the popup background actually is.
                            itemHoverBg: primaryColorOutline,
                            itemHoverColor: isDarkMode ? '#e6edf3' : '#24292f', // Hover changes bg only, not text
                            itemColor: isDarkMode ? '#e6edf3' : '#24292f', // Text primary
                            popupBg: navigationSiderBg, // 4. Navigation (matches sidebar, uses custom value if set)
                            colorText: isDarkMode ? '#e6edf3' : '#24292f',
                            colorTextSecondary: isDarkMode ? '#8b949e' : '#57606a',
                            // SidebarNav.tsx passes theme={isDarkMode ? 'dark' : 'light'} to antd's
                            // <Menu> - that per-instance prop switches which token family antd's
                            // Menu style generator reads (menuDarkToken overrides itemColor with
                            // darkItemColor, itemHoverColor with darkItemHoverColor, etc. - see
                            // antd/es/menu/style/index.js), completely bypassing every itemXxx
                            // override above. Without these, the dark-mode sidebar silently used
                            // antd's own generic dark-menu defaults - including darkItemHoverColor,
                            // which defaults to colorTextLightSolid (repurposed above for
                            // brand-color-adaptive button text, so it can resolve to a DARK navy)
                            // rendered against antd's own dark hover background: dark-on-dark,
                            // near-invisible hover text on every non-selected sidebar item.
                            darkItemBg: navigationSiderBg,
                            darkItemColor: '#e6edf3',
                            darkItemHoverBg: primaryColorOutline, // see itemHoverBg above - same fix, dark-Menu token family
                            darkItemHoverColor: '#e6edf3',
                            darkItemSelectedBg: primaryColorOutline,
                            darkItemSelectedColor: navSelectedText,
                            darkPopupBg: navigationSiderBg,
                            darkSubMenuItemBg: navigationSiderBg,
                            // Navigation density: 36px rows with 2px between them (common for
                            // app sidebars that keep growing — Linear/GitHub/VS Code sit at 28–34),
                            // 16px icons with a steady gap to the label.
                            itemHeight: 36,
                            itemMarginBlock: 2,
                            iconSize: 16,
                            iconMarginInlineEnd: 12,
                        },
                        Card: {
                            // Spacing via tokens (not global !important CSS) so size="small" keeps
                            // its tighter inset; header and body share the same horizontal inset
                            // so a card's title lines up with its content.
                            headerPadding: 24,
                            bodyPadding: 24,
                            headerPaddingSM: 16,
                            bodyPaddingSM: 16,
                            // Cards use container color
                            colorBgContainer: isDarkMode ? '#161b22' : LIGHT.surface, // 2. Container
                            colorBorderSecondary: isDarkMode ? '#67717d' : LIGHT.edge, // 5. Border
                        },
                        Tooltip: {
                            // Tooltip's background (colorBgSpotlight) is a near-black solid
                            // regardless of light/dark theme, so its text token must stay a
                            // fixed light color - it must NOT default to colorTextLightSolid
                            // above, which is deliberately repurposed for readability against
                            // the (possibly light/mid-toned) brand primary color and can
                            // resolve to a dark navy there (see the Menu comment below for the
                            // same class of bug) - rendered against a near-black tooltip, that
                            // measured well under WCAG AA, reading as barely-legible dim text.
                            colorTextLightSolid: '#ffffff',
                        },
                        Table: {
                            // Tables use container color
                            colorBgContainer: isDarkMode ? '#161b22' : LIGHT.surface, // 2. Container
                            headerBg: isDarkMode ? '#1c2128' : LIGHT.subtle, // 3. Elevated (header)
                            borderColor: isDarkMode ? '#67717d' : LIGHT.edge, // 5. Border
                        },
                        Form: {
                            // Forms use container color
                            colorBgContainer: isDarkMode ? '#161b22' : LIGHT.surface, // 2. Container
                        },
                        Button: {
                            controlHeight: 32,
                            controlHeightLG: 40,
                            controlHeightSM: 24,
                            fontWeight: 500,
                            borderRadius: 6,
                            // Flat shadcn look: no drop shadow on any button variant
                            primaryShadow: 'none',
                            defaultShadow: 'none',
                            dangerShadow: 'none',
                            defaultColor: isDarkMode ? '#e6edf3' : '#24292f', // Text primary
                            defaultBg: isDarkMode ? '#161b22' : '#ffffff',
                            defaultBorderColor: isDarkMode ? '#67717d' : LIGHT.control, // 5. Border
                            defaultHoverColor: isDarkMode ? '#e6edf3' : '#24292f',
                            defaultHoverBg: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated
                            defaultHoverBorderColor: isDarkMode ? '#67717d' : LIGHT.control,
                            defaultActiveBg: isDarkMode ? '#0d1117' : '#e1e4e8',
                            defaultActiveBorderColor: isDarkMode ? '#67717d' : LIGHT.control,
                        },
                        Input: {
                            controlHeight: 32,
                            controlHeightLG: 40,
                            controlHeightSM: 24,
                            colorBgContainer: isDarkMode ? '#161b22' : LIGHT.surface, // 2. Container
                            // Deliberately stronger than the sitewide colorBorder
                            // (~1.2:1/1.4:1 against this same container color in
                            // each mode - well under WCAG 1.4.11's 3:1 non-text
                            // minimum). Inputs sit ON that container color, so a
                            // field the user needs to locate and type into can't
                            // rely on it as the only edge cue - scoped to just
                            // form controls rather than the global border token,
                            // which would visibly darken every card/table/divider
                            // site-wide.
                            colorBorder: isDarkMode ? '#67717d' : LIGHT.control,
                            borderRadius: 6,
                            activeShadow: 'none',
                            hoverBorderColor: primaryColor,
                            activeBorderColor: primaryColor,
                        },
                        Select: {
                            controlHeight: 32,
                            controlHeightLG: 40,
                            controlHeightSM: 24,
                            colorBgContainer: isDarkMode ? '#161b22' : LIGHT.surface, // 2. Container
                            colorBorder: isDarkMode ? '#67717d' : LIGHT.control, // see Input above
                            borderRadius: 6,
                            // Input (above) sets these explicitly so hover/focus reads as the
                            // brand color rather than antd's derived default - Select lacked
                            // the same pair, so a Select sitting next to an Input in the same
                            // form (e.g. Settings → Profile) looked inconsistent the moment a
                            // user interacted with either field, even though both look
                            // identical at rest.
                            hoverBorderColor: primaryColor,
                            activeBorderColor: primaryColor,
                            // The popup itself renders on colorBgElevated ('#1c2128'/'#f1f3f5') -
                            // these used to reuse that same Elevated tier (or the adjacent
                            // Container tier, one step away) for hover/selected, which measures
                            // ~1.06:1 against the popup background - essentially invisible.
                            // primaryColorOutline is a brand-aware tint (hue, not just a gray
                            // step), so it stays visually distinct regardless of how dark/light
                            // colorBgElevated is.
                            optionSelectedBg: primaryColorOutline,
                            optionActiveBg: primaryColorOutline,
                            optionSelectedFontWeight: 500,
                        },
                        Progress: {
                            defaultColor: primaryColor,
                            remainingColor: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated
                        },
                        Switch: {
                            trackHeight: 24,
                            trackMinWidth: 44,
                            innerMinMargin: 4,
                            innerMaxMargin: 24,
                        },
                        Checkbox: {
                            borderRadiusSM: 4,
                        },
                        Slider: {
                            trackBg: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated
                            trackHoverBg: isDarkMode ? '#30363d' : '#e1e4e8', // 5. Border (fill, not a boundary - WCAG 1.4.11 doesn't apply)
                            handleSize: 18,
                            handleSizeHover: 20,
                            railSize: 6,
                        },
                        ColorPicker: {
                            borderRadius: 6,
                        },
                        Dropdown: {
                            // Dropdowns use elevated color
                            colorBgElevated: isDarkMode ? '#1c2128' : LIGHT.surface, // 3. Elevated
                            colorBorder: isDarkMode ? '#67717d' : LIGHT.edge, // 5. Border
                        },
                        Modal: {
                            // Modals use elevated color
                            colorBgElevated: isDarkMode ? '#1c2128' : LIGHT.surface, // 3. Elevated
                            colorBorder: isDarkMode ? '#67717d' : LIGHT.edge, // 5. Border
                            borderRadiusLG: 12,
                        },
                        Alert: {
                            borderRadiusLG: 8,
                        },
                        List: {
                            // Plain lists: row spacing only. Bordered lists keep antd's own inset
                            // (the text used to touch the border).
                            itemPadding: '12px 0',
                        },
                        Drawer: {
                            // Drawers use elevated color
                            colorBgElevated: isDarkMode ? '#1c2128' : LIGHT.surface, // 3. Elevated
                            colorBorder: isDarkMode ? '#67717d' : LIGHT.edge, // 5. Border
                        },
                    },
                }}
            >
                {/* component={false}: no wrapper DOM node, just App context (message/notification/
                    Modal static-function calls can consume the dynamic theme via App.useApp()) */}
                <AntdApp component={false}>
                    <AntdMessageBridgeConnector />
                    {children}
                </AntdApp>
            </ConfigProvider>
        </ThemeModeContext.Provider>
    );
}