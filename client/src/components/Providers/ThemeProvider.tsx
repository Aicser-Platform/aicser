'use client';

import { App as AntdApp, ConfigProvider, theme } from 'antd';
import { MULTILINGUAL_FONT_STACK } from '@/config/typography';
import { ThemeModeContext } from './ThemeModeContext';
import AntdMessageBridgeConnector from './AntdMessageBridgeConnector';
import { ReactNode, useLayoutEffect, useState, useEffect, useMemo } from 'react';

const BRAND_THEME_STORAGE_KEY = 'aiser_brand_theme_vars';
/** light | dark | auto — synced from Settings → General; header toggle sets light/dark explicitly */
const AISER_THEME_MODE_KEY = 'aiser_theme_mode';

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

/**
 * White text on the default brand teal (#00c2cb) measures ~2.2:1, well under
 * WCAG AA's 4.5:1 - and a static dark-text swap would break the same way for
 * an org with a dark custom brand color (ThemeCustomizer). Picks whichever of
 * the two candidates has the higher contrast against the actual resolved
 * background, so it adapts to brand overrides instead of assuming teal.
 */
function pickReadableTextColor(bgHex: string, darkText: string, lightText: string): string {
    const hex = bgHex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return lightText;
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
    const bgLuminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const contrastWithBlack = (bgLuminance + 0.05) / 0.05;
    const contrastWithWhite = 1.05 / (bgLuminance + 0.05);
    return contrastWithBlack >= contrastWithWhite ? darkText : lightText;
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
    // IMPORTANT: Dark mode = #030712 (Aiser obsidian navy), Light mode = #fafafa (off-white)
    // This is recalculated on every render to ensure it updates when isDarkMode changes
    // We ignore any stale custom values to prevent colors from getting stuck
    const getNavigationBg = () => {
        if (typeof window === 'undefined') {
            return isDarkMode ? '#030712' : '#fafafa';
        }
        // Always use theme-appropriate default to prevent stuck colors after multiple toggles
        // Dark mode = brand obsidian navy (#030712), Light mode = off-white (#fafafa)
        return isDarkMode ? '#030712' : '#fafafa';
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
    const primaryColor = brandTokens['--ant-primary-color'] || '#00c2cb';
    const primaryColorHover = brandTokens['--ant-primary-color-hover'] || '#00a5af';
    const primaryColorActive = brandTokens['--ant-primary-color-active'] || '#008b95';
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

    const navigationSiderBg = useMemo(
        () => resolveCSSVar('--color-bg-navigation-sider', isDarkMode ? '#030712' : '#eef1f5'),
        [isDarkMode]
    );

    const navigationHeaderBg = useMemo(
        () => resolveCSSVar('--color-bg-navigation-header', isDarkMode ? '#10131c' : '#ffffff'),
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
        
        const themeDefaultNav = isDarkMode ? '#030712' : '#fafafa';
        const themeDefaultSider = isDarkMode ? '#030712' : '#eef1f5';
        const themeDefaultHeader = isDarkMode ? '#10131c' : '#ffffff';
        const themeDefaultHeaderGlow = isDarkMode ? '#1c2432' : '#dfe4ec';
        
        const tokens = {
            // 1. Base Background (Page/Layout) - Darkest/Lightest
            '--ant-color-bg-layout': isDarkMode ? '#0d1117' : '#ffffff',
            '--color-bg-base': isDarkMode ? '#0d1117' : '#ffffff',
            
            // 2. Container Background (Cards, Panels, Tables, Forms)
            '--ant-color-bg-container': isDarkMode ? '#161b22' : '#f8f9fa',
            '--color-bg-container': isDarkMode ? '#161b22' : '#f8f9fa',
            
            // 3. Elevated Background (Modals, Dropdowns, Hover states, Table headers)
            '--ant-color-bg-elevated': isDarkMode ? '#1c2128' : '#f1f3f5',
            '--color-bg-elevated': isDarkMode ? '#1c2128' : '#f1f3f5',
            
            // 4. Navigation Background (Header, Sidebar, Menu) - Use custom brand values when present
            '--ant-color-bg-navigation': brandTokens['--color-bg-navigation'] || themeDefaultNav,
            '--color-bg-navigation': brandTokens['--color-bg-navigation'] || themeDefaultNav,
            '--color-bg-navigation-sider': brandTokens['--color-bg-navigation-sider'] || themeDefaultSider,
            '--color-bg-navigation-header': brandTokens['--color-bg-navigation-header'] || themeDefaultHeader,
            '--color-bg-navigation-header-glow': brandTokens['--color-bg-navigation-header-glow'] || themeDefaultHeaderGlow,
            '--ant-color-bg-navigation-hover': isDarkMode ? '#0b162e' : '#f0f0f0',
            
            // 5. Border/Divider - Single consistent color. WCAG 1.4.11
            // non-text contrast minimum is 3:1; the prior #30363d/#e1e4e8
            // measured ~1.4:1/1.2:1 against the container background in each
            // mode - card, table, and divider edges were effectively invisible.
            '--ant-color-border': isDarkMode ? '#67717d' : '#7a7f85',
            '--color-border': isDarkMode ? '#67717d' : '#7a7f85',
            '--ant-color-border-secondary': isDarkMode ? '#67717d' : '#7a7f85',

            // Text Colors - Clear hierarchy (synchronized)
            '--ant-color-text': isDarkMode ? '#e6edf3' : '#24292f',
            '--color-text-primary': isDarkMode ? '#e6edf3' : '#24292f',
            '--ant-color-text-secondary': isDarkMode ? '#8b949e' : '#57606a',
            '--color-text-secondary': isDarkMode ? '#8b949e' : '#57606a',
            // Light-mode values are WCAG 2.1 AA-verified (>=4.5:1 tertiary,
            // >=3:1 quaternary) against both container (#f8f9fa) and layout
            // (#ffffff) backgrounds - the prior #8b949e/#bfbfbf measured only
            // 2.9:1/1.7:1, failing even the large-text/UI-component minimum.
            '--ant-color-text-tertiary': isDarkMode ? '#6e7681' : '#697280',
            '--color-text-tertiary': isDarkMode ? '#6e7681' : '#697280',
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
            '--ant-color-primary-bg': primaryColorOutline,
            '--ant-primary-color-outline': primaryColorOutline,
            // Readable label color for anything filled with primaryColor - for
            // CSS files that can't do antd's colorTextLightSolid token merge
            // (e.g. `color: var(--color-primary-text, #fff)` in place of a
            // hardcoded `color: #fff` on a primaryColor background).
            '--color-primary-text': primaryColorText,

            // Functional Colors - Minimal usage
            '--ant-color-success': '#16a34a',
            '--ant-color-warning': '#f97316',
            '--ant-color-error': '#dc2626',
            '--ant-color-info': '#0891b2',
            
            // Fill Colors - Use elevated/container for consistency
            '--ant-color-fill': isDarkMode ? '#1c2128' : '#f1f3f5',
            '--ant-color-fill-secondary': isDarkMode ? '#1c2128' : '#f1f3f5',
            '--ant-color-fill-tertiary': isDarkMode ? '#161b22' : '#f8f9fa',
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
    }, [isDarkMode, brandTokens, primaryColor, primaryColorHover, primaryColorActive, primaryColorOutline, primaryColorText]);

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
                        colorSuccess: '#16a34a',
                        colorWarning: '#f97316',
                        colorError: '#dc2626',
                        colorInfo: '#0891b2',
                        
                        // Simplified 5-color system - synchronized with CSS variables
                        colorBgLayout: isDarkMode ? '#0d1117' : '#ffffff', // 1. Base (page background)
                        colorBgContainer: isDarkMode ? '#161b22' : '#f8f9fa', // 2. Container (cards, panels, tables, forms)
                        colorBgElevated: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated (modals, dropdowns, hover, table headers)
                        // antd's own default (colorFillTertiary: 8%/4% white/black overlay) measures
                        // ~1.1-1.3:1 against colorBgElevated above - barely perceptible as a hover
                        // cue on a plain <Dropdown menu={...}> popup (Select/Menu get their own
                        // component-level overrides below for the same reason). A brand tint keeps
                        // a visible hue shift regardless of how dark/light the popup surface is.
                        controlItemBgHover: primaryColorOutline,

                        // Text tokens - Clear hierarchy (synchronized with CSS variables)
                        colorText: isDarkMode ? '#e6edf3' : '#24292f',
                        colorTextSecondary: isDarkMode ? '#8b949e' : '#57606a',
                        colorTextTertiary: isDarkMode ? '#6e7681' : '#697280',
                        colorTextQuaternary: isDarkMode ? '#6b7280' : '#7c8590',
                        
                        // Border tokens - Single consistent color (synchronized)
                        colorBorder: isDarkMode ? '#67717d' : '#7a7f85',
                        colorBorderSecondary: isDarkMode ? '#67717d' : '#7a7f85',
                        
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
                            bodyBg: isDarkMode ? '#0d1117' : '#ffffff', // 1. Base
                            headerBg: navigationHeaderBg, // 4. Navigation (uses custom value if set)
                            siderBg: navigationSiderBg, // 4. Navigation (uses custom value if set)
                        },
                        Menu: {
                            // Menu uses navigation color (matches sidebar/header)
                            itemBg: navigationSiderBg, // 4. Navigation (uses custom value if set)
                            itemSelectedBg: primaryColor, // Primary color (follows brand override)
                            itemSelectedColor: primaryColorText,
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
                            darkItemSelectedBg: primaryColor,
                            darkItemSelectedColor: primaryColorText,
                            darkPopupBg: navigationSiderBg,
                            darkSubMenuItemBg: navigationSiderBg,
                        },
                        Card: {
                            // Cards use container color
                            colorBgContainer: isDarkMode ? '#161b22' : '#f8f9fa', // 2. Container
                            colorBorderSecondary: isDarkMode ? '#67717d' : '#7a7f85', // 5. Border
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
                            colorBgContainer: isDarkMode ? '#161b22' : '#f8f9fa', // 2. Container
                            headerBg: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated (header)
                            borderColor: isDarkMode ? '#67717d' : '#7a7f85', // 5. Border
                        },
                        Form: {
                            // Forms use container color
                            colorBgContainer: isDarkMode ? '#161b22' : '#f8f9fa', // 2. Container
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
                            defaultBorderColor: isDarkMode ? '#67717d' : '#7a7f85', // 5. Border
                            defaultHoverColor: isDarkMode ? '#e6edf3' : '#24292f',
                            defaultHoverBg: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated
                            defaultHoverBorderColor: isDarkMode ? '#67717d' : '#7a7f85',
                            defaultActiveBg: isDarkMode ? '#0d1117' : '#e1e4e8',
                            defaultActiveBorderColor: isDarkMode ? '#67717d' : '#7a7f85',
                        },
                        Input: {
                            controlHeight: 32,
                            controlHeightLG: 40,
                            controlHeightSM: 24,
                            colorBgContainer: isDarkMode ? '#161b22' : '#f8f9fa', // 2. Container
                            // Deliberately stronger than the sitewide colorBorder
                            // (~1.2:1/1.4:1 against this same container color in
                            // each mode - well under WCAG 1.4.11's 3:1 non-text
                            // minimum). Inputs sit ON that container color, so a
                            // field the user needs to locate and type into can't
                            // rely on it as the only edge cue - scoped to just
                            // form controls rather than the global border token,
                            // which would visibly darken every card/table/divider
                            // site-wide.
                            colorBorder: isDarkMode ? '#67717d' : '#7a7f85',
                            borderRadius: 6,
                            activeShadow: 'none',
                            hoverBorderColor: primaryColor,
                            activeBorderColor: primaryColor,
                        },
                        Select: {
                            controlHeight: 32,
                            controlHeightLG: 40,
                            controlHeightSM: 24,
                            colorBgContainer: isDarkMode ? '#161b22' : '#f8f9fa', // 2. Container
                            colorBorder: isDarkMode ? '#67717d' : '#7a7f85', // see Input above
                            borderRadius: 6,
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
                            colorBgElevated: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated
                            colorBorder: isDarkMode ? '#67717d' : '#7a7f85', // 5. Border
                        },
                        Modal: {
                            // Modals use elevated color
                            colorBgElevated: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated
                            colorBorder: isDarkMode ? '#67717d' : '#7a7f85', // 5. Border
                            borderRadiusLG: 12,
                        },
                        Alert: {
                            borderRadiusLG: 8,
                        },
                        Drawer: {
                            // Drawers use elevated color
                            colorBgElevated: isDarkMode ? '#1c2128' : '#f1f3f5', // 3. Elevated
                            colorBorder: isDarkMode ? '#67717d' : '#7a7f85', // 5. Border
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