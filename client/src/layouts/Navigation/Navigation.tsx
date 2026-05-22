'use client';
import useClickOutside from '@/hooks/useClickOutside';
import {
    DatabaseOutlined,
    MessageOutlined,
    SettingOutlined,
    DashboardOutlined,
    CodeOutlined,
    CommentOutlined,
    AppstoreOutlined,
    AreaChartOutlined,
    DeploymentUnitOutlined,
    RadarChartOutlined,
} from '@ant-design/icons';
import { Button, Layout, Menu, MenuProps, Tooltip } from 'antd';
import { useRouter, usePathname } from "next/navigation";
import React from 'react';
import AiserLogo from '@/components/ui/Logo/AiserLogo';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { useTranslations } from 'next-intl';

const { Sider } = Layout;
const isEnterpriseEdition = ['enterprise', 'ee'].includes(
    (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

interface NavigationProps {
    collapsed: boolean;
    isBreakpoint: boolean;
    onBreakpoint: (broken: boolean) => void;
    onCollapse: (collapsed: boolean) => void;
}

const Navigation: React.FC<NavigationProps> = (props: NavigationProps) => {
    const ref = React.useRef<HTMLDivElement>(null);
    const t = useTranslations('nav');
    const brandText = isEnterpriseEdition ? 'Aicser' : 'Aicser Community Edition';

    useClickOutside(ref, () => {
        if (props.isBreakpoint && !props.collapsed) {
            props.onCollapse(true);
        }
    });

    const dashboardsItem = {
        key: 'dashboards',
        icon: <DashboardOutlined />,
        label: props.collapsed ? t('dashboards') : t('dashboard_studio'),
        ...(!props.collapsed ? {
            children: [
                { key: 'dashboards', label: t('dashboards') },
                { key: 'chart-designer', label: t('chart_designer') },
            ]
        } : {})
    };

    const communityItems = React.useMemo(
        () => [
            {
                key: 'dashboards',
                icon: <DashboardOutlined />,
                label: t('dashboards'),
            },
            {
                key: 'chart-designer',
                icon: <AreaChartOutlined />,
                label: t('chart_designer'),
            },
            {
                key: 'feed',
                icon: <AppstoreOutlined />,
                label: t('feed'),
            },
            {
                key: 'query-editor',
                icon: <CodeOutlined />,
                label: t('query_editor'),
            },
            {
                key: 'data',
                icon: <DatabaseOutlined />,
                label: t('data'),
            },
        ],
        [t]
    );

    const mainItems = React.useMemo(
        () => isEnterpriseEdition
            ? [
                {
                    key: 'chat',
                    icon: <MessageOutlined />,
                    label: t('ai_engine'),
                },
                {
                    key: 'query-editor',
                    icon: <CodeOutlined />,
                    label: t('query_editor'),
                },
                {
                    key: 'feed',
                    icon: <AppstoreOutlined />,
                    label: t('feed'),
                },
                dashboardsItem,
                ...(props.collapsed ? [{
                    key: 'chart-designer',
                    icon: <AreaChartOutlined />,
                    label: t('chart_designer'),
                }] : []),
                {
                    key: 'data',
                    icon: <DatabaseOutlined />,
                    label: t('data'),
                },
                {
                    key: 'alerts',
                    icon: <RadarChartOutlined />,
                    label: t('alerts'),
                },
                {
                    key: 'platform-services',
                    icon: <DeploymentUnitOutlined />,
                    label: t('platform_services'),
                },
            ]
            : communityItems,
        [communityItems, dashboardsItem, props.collapsed, t]
    );

    const bottomItems = React.useMemo(
        () => [
            {
                key: 'settings',
                icon: <SettingOutlined />,
                label: t('settings'),
            },
        ],
        [t]
    );

    const router = useRouter();
    const pathname = usePathname();

    // Determine selected keys based on current route
    const selectedKeys = React.useMemo(() => {
        if (pathname === '/chat') {
            return ['chat'];
        } else if (pathname === '/data') {
            return ['data'];
        } else if (pathname?.startsWith('/settings')) {
            return ['settings'];
        } else if (pathname?.startsWith('/feed')) {
            return ['feed'];
        } else if (pathname === '/query-editor') {
            return ['query-editor'];
        } else if (pathname === '/dashboards') {
            return ['dashboards'];
        } else if (pathname === '/chart-designer') {
            return ['chart-designer'];
        } else if (pathname === '/data-platform') {
            return ['platform-services'];
        } else if (pathname === '/alerts') {
            return ['alerts'];
        }
        return [];
    }, [pathname]);

    const [openKeysState, setOpenKeysState] = React.useState<string[]>([]);

    const openKeys = React.useMemo(() => {
        // Use state if available
        if (openKeysState.length > 0) {
            return openKeysState;
        }
        return [];
    }, [openKeysState]);

    const onOpenChange: MenuProps['onOpenChange'] = React.useCallback((keys: string[]) => {
        setOpenKeysState(keys);
    }, []);

    const onClick: MenuProps['onClick'] = React.useCallback(
        (e: Parameters<NonNullable<MenuProps['onClick']>>[0]) => {
            switch (e.key) {
                case 'chat':
                    router.push('/chat');
                    break;
                case 'dashboards':
                    router.push('/dashboards');
                    break;
                case 'feed':
                    router.push('/feed');
                    break;
                case 'chart-designer':
                    router.push('/chart-designer');
                    break;
                case 'query-editor':
                    router.push('/query-editor');
                    break;
                case 'data':
                    router.push('/data');
                    break;
                case 'alerts':
                    router.push('/alerts');
                    break;
                case 'platform-services':
                    router.push('/data-platform');
                    break;
                case 'settings':
                    router.push('/settings');
                    break;
            }
        },
        [router]
    );

    // Open Aicser Support (feedback, roadmap, changelog at /support)
    const handleSupportClick = React.useCallback(() => router.push('/support'), [router]);
    const { isDarkMode: isDarkModeContext } = useThemeMode();

    // Avoid hydration mismatch by only applying the theme prop after client mount.
    const [isDarkMode, setIsDarkMode] = React.useState<boolean>(false);
    React.useEffect(() => {
        setIsDarkMode(!!isDarkModeContext);
    }, [isDarkModeContext]);

    // Sidebar gradient matching header
    const sidebarGradient = isDarkMode
        ? 'linear-gradient(135deg, var(--color-bg-navigation-sider, var(--color-bg-navigation)) 0%, var(--color-bg-navigation-sider-glow, rgba(24, 144, 255, 0.15)) 100%)'
        : 'linear-gradient(135deg, var(--color-bg-navigation-sider, var(--color-bg-navigation)) 0%, var(--color-bg-navigation-sider-glow, rgba(255,255,255,0.25)) 100%)';

    // Set CSS variable for sidebar width (for status bar positioning)
    React.useEffect(() => {
        document.documentElement.style.setProperty('--sidebar-width', `${props.collapsed ? 80 : 210}px`);
    }, [props.collapsed]);

    // On mobile (isBreakpoint), the sidebar slides off-screen when collapsed
    // and slides in as an overlay (below the 64px header) when expanded.
    const isMobile = props.isBreakpoint;
    const sidebarWidth = props.collapsed ? 80 : 256;

    // Mobile: sidebar lives below the header; slides via transform
    const mobileStyles: React.CSSProperties = isMobile ? {
        top: 64,                           // Below the fixed header
        height: 'calc(100vh - 64px)',
        minHeight: 'calc(100vh - 64px)',
        maxHeight: 'calc(100vh - 64px)',
        transform: props.collapsed ? 'translateX(-100%)' : 'translateX(0)',
        willChange: 'transform',
        boxShadow: props.collapsed ? 'none' : '4px 0 24px rgba(0, 0, 0, 0.25)',
    } : {};

    return (
        <Sider
            ref={ref}
            theme={isDarkMode ? 'dark' : 'light'}
            collapsible
            collapsed={props.collapsed}
            trigger={null}
            breakpoint="lg"
            width={sidebarWidth}
            collapsedWidth={isMobile ? 0 : 80}
            style={{
                width: isMobile && props.collapsed ? 0 : sidebarWidth,
                minWidth: isMobile && props.collapsed ? 0 : sidebarWidth,
                maxWidth: sidebarWidth,
                transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1), box-shadow 0.22s ease',
                height: '100vh',
                minHeight: '100vh',
                maxHeight: '100vh',
                position: 'fixed',
                left: 0,
                top: 0,
                zIndex: 1000, // Below header (1001)
                boxShadow: '2px 0 8px rgba(0, 0, 0, 0.1)',
                borderRight: '1px solid var(--ant-color-border)',
                margin: 0,
                padding: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                boxSizing: 'border-box',
                borderTop: 'none',
                borderBottom: 'none',
                borderLeft: 'none',
                background: sidebarGradient,
                color: 'var(--color-text-primary, var(--ant-color-text))',
                // Mobile overrides — applied last so they take precedence
                ...mobileStyles,
            }}
        >
            {/* Wrapper for relative positioning */}
            <div style={{
                position: 'relative',
                height: '100%',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
            }}>
                {/* Logo Header - Fixed at top */}
                <div style={{
                    padding: props.collapsed ? '12px' : '12px', // Tightened padding
                    paddingBottom: props.collapsed ? '12px' : '12px',
                    textAlign: 'left',
                    margin: 0,
                    marginBottom: 0,
                    height: '64px',
                    minHeight: '64px',
                    maxHeight: '64px',
                    flexShrink: 0, // Don't shrink
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: props.collapsed ? 'center' : 'flex-start',
                    borderBottom: '1px solid var(--ant-color-border)',
                    background: 'transparent', // Inherit gradient from parent
                    boxSizing: 'border-box',
                }}>
                    <AiserLogo
                        size={props.collapsed ? 32 : 36}
                        showText={!props.collapsed}
                        text={brandText}
                    />
                </div>
                {/* Main Menu - Takes up available space, scrollable, with bottom padding for Settings */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    overflow: 'hidden',
                    flexShrink: 1,
                    paddingBottom: '60px', // Reserve space for bottom section (Settings menu + padding)
                }}>
                    <Menu
                        mode="inline"
                        triggerSubMenuAction="hover"
                        subMenuOpenDelay={0}
                        subMenuCloseDelay={0}
                        selectedKeys={selectedKeys}
                        openKeys={openKeys}
                        onOpenChange={onOpenChange}
                        items={mainItems}
                        onClick={onClick}
                        theme={isDarkMode ? 'dark' : 'light'}
                        style={{
                            border: 'none',
                            flex: 1,
                            minHeight: 0, // Allow flex item to shrink below content size
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            paddingBottom: '0px',
                            background: 'transparent', // Inherit gradient from parent
                            color: 'var(--color-text-primary, var(--ant-color-text))',
                        }}
                    />
                </div>

                {/* Bottom Section - Fixed at absolute bottom, space for future items */}
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                }}>
                    {isEnterpriseEdition && (
                        <div style={{
                            position: 'absolute',
                            bottom: '64px', // Position higher above Settings menu (moved up from 48px)
                            right: props.collapsed ? '8px' : '12px',
                            zIndex: 10,
                        }}>
                            <Tooltip title={t('support')} placement="left">
                                <Button
                                    type="text"
                                    icon={<CommentOutlined />}
                                    onClick={handleSupportClick}
                                    style={{
                                        width: props.collapsed ? '32px' : '36px',
                                        height: props.collapsed ? '32px' : '36px',
                                        padding: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '6px',
                                        color: 'var(--ant-color-text-secondary)',
                                        border: 'none',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = 'var(--ant-color-primary)';
                                        e.currentTarget.style.backgroundColor = 'var(--ant-color-fill-secondary)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = 'var(--ant-color-text-secondary)';
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                />
                            </Tooltip>
                        </div>
                    )}

                    {/* Settings Menu - Always at bottom */}
                    <Menu
                        mode="inline"
                        selectedKeys={selectedKeys}
                        items={bottomItems}
                        onClick={onClick}
                        theme={isDarkMode ? 'dark' : 'light'}
                        style={{
                            border: 'none',
                            borderTop: '1px solid var(--ant-color-border)',
                            background: 'transparent', // Inherit gradient from parent
                            color: 'var(--color-text-primary, var(--ant-color-text))',
                            paddingTop: '8px', // Space above divider
                            paddingBottom: '8px', // Space at bottom
                            marginTop: 0,
                            marginBottom: 0,
                        }}
                    />
                </div>
            </div>
        </Sider>
    );
};

export default React.memo(Navigation);
