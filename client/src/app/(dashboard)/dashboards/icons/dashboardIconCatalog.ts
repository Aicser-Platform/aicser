import type { DashboardIconCatalogEntry, WidgetIconCategory } from './dashboardIconTypes';

/** Curated Ant Design icons for dashboard authoring (~90). */
export const DASHBOARD_ANT_ICON_CATALOG: DashboardIconCatalogEntry[] = [
  // Finance
  { id: 'DollarOutlined', set: 'antd', category: 'finance', label: 'Dollar', keywords: ['money', 'revenue', 'sales', 'currency'] },
  { id: 'EuroOutlined', set: 'antd', category: 'finance', label: 'Euro', keywords: ['money', 'eur', 'currency'] },
  { id: 'PoundOutlined', set: 'antd', category: 'finance', label: 'Pound', keywords: ['money', 'gbp', 'currency'] },
  { id: 'PercentageOutlined', set: 'antd', category: 'finance', label: 'Percent', keywords: ['margin', 'rate', '%'] },
  { id: 'FundOutlined', set: 'antd', category: 'finance', label: 'Fund', keywords: ['invest', 'capital'] },
  { id: 'WalletOutlined', set: 'antd', category: 'finance', label: 'Wallet', keywords: ['cash', 'balance'] },
  { id: 'BankOutlined', set: 'antd', category: 'finance', label: 'Bank', keywords: ['finance', 'account'] },
  { id: 'CreditCardOutlined', set: 'antd', category: 'finance', label: 'Card', keywords: ['payment', 'billing'] },
  { id: 'AccountBookOutlined', set: 'antd', category: 'finance', label: 'Ledger', keywords: ['books', 'accounting'] },
  { id: 'TransactionOutlined', set: 'antd', category: 'finance', label: 'Transaction', keywords: ['transfer', 'pay'] },
  // People
  { id: 'UserOutlined', set: 'antd', category: 'people', label: 'User', keywords: ['person', 'customer'] },
  { id: 'TeamOutlined', set: 'antd', category: 'people', label: 'Team', keywords: ['users', 'group', 'staff'] },
  { id: 'UserAddOutlined', set: 'antd', category: 'people', label: 'Add user', keywords: ['signup', 'invite'] },
  { id: 'SolutionOutlined', set: 'antd', category: 'people', label: 'Solution', keywords: ['hr', 'role'] },
  { id: 'ContactsOutlined', set: 'antd', category: 'people', label: 'Contacts', keywords: ['crm', 'directory'] },
  { id: 'IdcardOutlined', set: 'antd', category: 'people', label: 'ID card', keywords: ['badge', 'employee'] },
  { id: 'CustomerServiceOutlined', set: 'antd', category: 'people', label: 'Support', keywords: ['help', 'service'] },
  // Ops
  { id: 'ShoppingOutlined', set: 'antd', category: 'ops', label: 'Shopping', keywords: ['orders', 'commerce'] },
  { id: 'ShoppingCartOutlined', set: 'antd', category: 'ops', label: 'Cart', keywords: ['checkout', 'basket'] },
  { id: 'ShopOutlined', set: 'antd', category: 'ops', label: 'Shop', keywords: ['store', 'retail'] },
  { id: 'CarOutlined', set: 'antd', category: 'ops', label: 'Car', keywords: ['fleet', 'delivery'] },
  { id: 'RocketOutlined', set: 'antd', category: 'ops', label: 'Rocket', keywords: ['launch', 'growth'] },
  { id: 'CloudOutlined', set: 'antd', category: 'ops', label: 'Cloud', keywords: ['infra', 'saas'] },
  { id: 'DatabaseOutlined', set: 'antd', category: 'ops', label: 'Database', keywords: ['data', 'storage'] },
  { id: 'ApiOutlined', set: 'antd', category: 'ops', label: 'API', keywords: ['integration', 'service'] },
  { id: 'ClusterOutlined', set: 'antd', category: 'ops', label: 'Cluster', keywords: ['nodes', 'scale'] },
  { id: 'ToolOutlined', set: 'antd', category: 'ops', label: 'Tools', keywords: ['settings', 'ops'] },
  { id: 'BuildOutlined', set: 'antd', category: 'ops', label: 'Build', keywords: ['construction', 'project'] },
  { id: 'InboxOutlined', set: 'antd', category: 'ops', label: 'Inbox', keywords: ['mail', 'queue'] },
  { id: 'MailOutlined', set: 'antd', category: 'ops', label: 'Mail', keywords: ['email', 'message'] },
  { id: 'PhoneOutlined', set: 'antd', category: 'ops', label: 'Phone', keywords: ['call', 'contact'] },
  { id: 'GlobalOutlined', set: 'antd', category: 'ops', label: 'Global', keywords: ['world', 'geo', 'map'] },
  { id: 'EnvironmentOutlined', set: 'antd', category: 'ops', label: 'Location', keywords: ['map', 'pin', 'place'] },
  // Time
  { id: 'ClockCircleOutlined', set: 'antd', category: 'time', label: 'Clock', keywords: ['time', 'duration'] },
  { id: 'CalendarOutlined', set: 'antd', category: 'time', label: 'Calendar', keywords: ['date', 'schedule'] },
  { id: 'FieldTimeOutlined', set: 'antd', category: 'time', label: 'Field time', keywords: ['sla', 'latency'] },
  { id: 'HistoryOutlined', set: 'antd', category: 'time', label: 'History', keywords: ['past', 'log'] },
  { id: 'ScheduleOutlined', set: 'antd', category: 'time', label: 'Schedule', keywords: ['plan', 'agenda'] },
  // Status
  { id: 'CheckCircleOutlined', set: 'antd', category: 'status', label: 'Success', keywords: ['ok', 'done', 'pass'] },
  { id: 'CloseCircleOutlined', set: 'antd', category: 'status', label: 'Error', keywords: ['fail', 'danger'] },
  { id: 'WarningOutlined', set: 'antd', category: 'status', label: 'Warning', keywords: ['alert', 'caution'] },
  { id: 'InfoCircleOutlined', set: 'antd', category: 'status', label: 'Info', keywords: ['about', 'help'] },
  { id: 'ThunderboltOutlined', set: 'antd', category: 'status', label: 'Bolt', keywords: ['fast', 'power', 'energy'] },
  { id: 'FireOutlined', set: 'antd', category: 'status', label: 'Fire', keywords: ['hot', 'trending'] },
  { id: 'HeartOutlined', set: 'antd', category: 'status', label: 'Heart', keywords: ['favorite', 'health'] },
  { id: 'StarOutlined', set: 'antd', category: 'status', label: 'Star', keywords: ['rating', 'featured'] },
  { id: 'FlagOutlined', set: 'antd', category: 'status', label: 'Flag', keywords: ['milestone', 'goal'] },
  { id: 'SafetyOutlined', set: 'antd', category: 'status', label: 'Safety', keywords: ['secure', 'shield'] },
  { id: 'LockOutlined', set: 'antd', category: 'status', label: 'Lock', keywords: ['secure', 'private'] },
  { id: 'BugOutlined', set: 'antd', category: 'status', label: 'Bug', keywords: ['issue', 'defect'] },
  // Charts
  { id: 'BarChartOutlined', set: 'antd', category: 'charts', label: 'Bar chart', keywords: ['volume', 'bars'] },
  { id: 'LineChartOutlined', set: 'antd', category: 'charts', label: 'Line chart', keywords: ['trend', 'growth'] },
  { id: 'PieChartOutlined', set: 'antd', category: 'charts', label: 'Pie chart', keywords: ['share', 'mix'] },
  { id: 'AreaChartOutlined', set: 'antd', category: 'charts', label: 'Area chart', keywords: ['volume', 'trend'] },
  { id: 'DotChartOutlined', set: 'antd', category: 'charts', label: 'Scatter', keywords: ['correlation'] },
  { id: 'FundProjectionScreenOutlined', set: 'antd', category: 'charts', label: 'Projection', keywords: ['forecast', 'screen'] },
  { id: 'RiseOutlined', set: 'antd', category: 'charts', label: 'Rise', keywords: ['up', 'increase'] },
  { id: 'FallOutlined', set: 'antd', category: 'charts', label: 'Fall', keywords: ['down', 'decrease'] },
  { id: 'StockOutlined', set: 'antd', category: 'charts', label: 'Stock', keywords: ['market', 'ticker'] },
  { id: 'HeatMapOutlined', set: 'antd', category: 'charts', label: 'Heatmap', keywords: ['density', 'matrix'] },
  // Media
  { id: 'PictureOutlined', set: 'antd', category: 'media', label: 'Image', keywords: ['photo', 'picture'] },
  { id: 'VideoCameraOutlined', set: 'antd', category: 'media', label: 'Video', keywords: ['camera', 'media'] },
  { id: 'FileOutlined', set: 'antd', category: 'media', label: 'File', keywords: ['document', 'doc'] },
  { id: 'FileTextOutlined', set: 'antd', category: 'media', label: 'Document', keywords: ['text', 'report'] },
  { id: 'LinkOutlined', set: 'antd', category: 'media', label: 'Link', keywords: ['url', 'embed'] },
  { id: 'PaperClipOutlined', set: 'antd', category: 'media', label: 'Attachment', keywords: ['clip', 'file'] },
  // General
  { id: 'NumberOutlined', set: 'antd', category: 'general', label: 'Number', keywords: ['kpi', 'metric', 'count'] },
  { id: 'DashboardOutlined', set: 'antd', category: 'general', label: 'Dashboard', keywords: ['home', 'overview'] },
  { id: 'AppstoreOutlined', set: 'antd', category: 'general', label: 'Apps', keywords: ['grid', 'modules'] },
  { id: 'ApartmentOutlined', set: 'antd', category: 'general', label: 'Org', keywords: ['structure', 'company'] },
  { id: 'HomeOutlined', set: 'antd', category: 'general', label: 'Home', keywords: ['start', 'main'] },
  { id: 'SettingOutlined', set: 'antd', category: 'general', label: 'Settings', keywords: ['config', 'prefs'] },
  { id: 'FilterOutlined', set: 'antd', category: 'general', label: 'Filter', keywords: ['slicer', 'query'] },
  { id: 'SearchOutlined', set: 'antd', category: 'general', label: 'Search', keywords: ['find', 'lookup'] },
  { id: 'BulbOutlined', set: 'antd', category: 'general', label: 'Idea', keywords: ['insight', 'tip'] },
  { id: 'TrophyOutlined', set: 'antd', category: 'general', label: 'Trophy', keywords: ['win', 'award'] },
  { id: 'GiftOutlined', set: 'antd', category: 'general', label: 'Gift', keywords: ['promo', 'reward'] },
  { id: 'TagOutlined', set: 'antd', category: 'general', label: 'Tag', keywords: ['label', 'category'] },
  { id: 'TagsOutlined', set: 'antd', category: 'general', label: 'Tags', keywords: ['labels', 'categories'] },
  { id: 'AimOutlined', set: 'antd', category: 'general', label: 'Target', keywords: ['goal', 'kpi'] },
  { id: 'CompassOutlined', set: 'antd', category: 'general', label: 'Compass', keywords: ['direction', 'nav'] },
  { id: 'ExperimentOutlined', set: 'antd', category: 'general', label: 'Experiment', keywords: ['ab', 'test'] },
];

export const DASHBOARD_ICON_CATEGORIES: { id: WidgetIconCategory | 'all'; labelKey: string }[] = [
  { id: 'all', labelKey: 'icon_cat_all' },
  { id: 'finance', labelKey: 'icon_cat_finance' },
  { id: 'people', labelKey: 'icon_cat_people' },
  { id: 'ops', labelKey: 'icon_cat_ops' },
  { id: 'time', labelKey: 'icon_cat_time' },
  { id: 'status', labelKey: 'icon_cat_status' },
  { id: 'charts', labelKey: 'icon_cat_charts' },
  { id: 'media', labelKey: 'icon_cat_media' },
  { id: 'general', labelKey: 'icon_cat_general' },
];

/** Common emoji presets for Phase 2. */
export const DASHBOARD_EMOJI_PRESETS: { emoji: string; label: string; keywords: string[] }[] = [
  { emoji: '📈', label: 'Growth', keywords: ['up', 'trend', 'chart'] },
  { emoji: '📉', label: 'Decline', keywords: ['down', 'drop'] },
  { emoji: '💰', label: 'Money', keywords: ['cash', 'revenue'] },
  { emoji: '💵', label: 'Dollar', keywords: ['usd', 'sales'] },
  { emoji: '🧾', label: 'Receipt', keywords: ['invoice', 'bill'] },
  { emoji: '👥', label: 'People', keywords: ['users', 'team'] },
  { emoji: '🧑‍💼', label: 'Professional', keywords: ['staff', 'work'] },
  { emoji: '🛒', label: 'Cart', keywords: ['orders', 'shop'] },
  { emoji: '📦', label: 'Package', keywords: ['shipping', 'inventory'] },
  { emoji: '🚀', label: 'Rocket', keywords: ['launch', 'growth'] },
  { emoji: '⚡', label: 'Bolt', keywords: ['fast', 'energy'] },
  { emoji: '🔥', label: 'Hot', keywords: ['trending', 'viral'] },
  { emoji: '✅', label: 'Done', keywords: ['ok', 'success'] },
  { emoji: '⚠️', label: 'Warning', keywords: ['alert', 'caution'] },
  { emoji: '❌', label: 'Error', keywords: ['fail', 'stop'] },
  { emoji: '🎯', label: 'Target', keywords: ['goal', 'kpi'] },
  { emoji: '🏆', label: 'Trophy', keywords: ['win', 'award'] },
  { emoji: '⭐', label: 'Star', keywords: ['favorite', 'rating'] },
  { emoji: '💡', label: 'Idea', keywords: ['insight', 'tip'] },
  { emoji: '🕒', label: 'Clock', keywords: ['time', 'schedule'] },
  { emoji: '📅', label: 'Calendar', keywords: ['date', 'plan'] },
  { emoji: '🌍', label: 'World', keywords: ['global', 'geo'] },
  { emoji: '📍', label: 'Pin', keywords: ['location', 'map'] },
  { emoji: '🔔', label: 'Bell', keywords: ['notify', 'alert'] },
  { emoji: '📊', label: 'Bars', keywords: ['chart', 'stats'] },
  { emoji: '🧩', label: 'Puzzle', keywords: ['module', 'piece'] },
  { emoji: '🔐', label: 'Secure', keywords: ['lock', 'security'] },
  { emoji: '☁️', label: 'Cloud', keywords: ['saas', 'infra'] },
  { emoji: '🛠️', label: 'Tools', keywords: ['ops', 'fix'] },
  { emoji: '❤️', label: 'Heart', keywords: ['health', 'love'] },
];

export function filterAntIcons(
  query: string,
  category: WidgetIconCategory | 'all' = 'all',
): DashboardIconCatalogEntry[] {
  const q = query.trim().toLowerCase();
  return DASHBOARD_ANT_ICON_CATALOG.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (!q) return true;
    const hay = `${entry.id} ${entry.label} ${entry.keywords.join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
}

export function filterEmojiPresets(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return DASHBOARD_EMOJI_PRESETS;
  return DASHBOARD_EMOJI_PRESETS.filter((e) => {
    const hay = `${e.emoji} ${e.label} ${e.keywords.join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
}

/** Infer a sensible Ant icon from free text (legacy KPI heuristic). */
export function inferAntIconIdFromText(text: string): string {
  const t = text.toLowerCase();
  if (/margin|percent|%|rate/.test(t)) return 'PercentageOutlined';
  if (/revenue|sales|profit|cost|expense|usd|currency|dollar|money/.test(t)) return 'DollarOutlined';
  if (/user|people|customer|team|staff/.test(t)) return 'TeamOutlined';
  if (/order|cart|shop|retail/.test(t)) return 'ShoppingCartOutlined';
  if (/trend|growth|line/.test(t)) return 'LineChartOutlined';
  if (/bar|volume/.test(t)) return 'BarChartOutlined';
  if (/time|latency|duration|sla/.test(t)) return 'ClockCircleOutlined';
  if (/warn|alert|risk/.test(t)) return 'WarningOutlined';
  if (/error|fail|critical/.test(t)) return 'CloseCircleOutlined';
  if (/goal|target|kpi/.test(t)) return 'AimOutlined';
  return 'NumberOutlined';
}
