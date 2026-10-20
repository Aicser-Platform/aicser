#!/usr/bin/env node
/**
 * Sync structural i18n keys from en.json into other locales (merge missing, rename keys).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(__dirname, '../src/messages');
const en = JSON.parse(fs.readFileSync(path.join(messagesDir, 'en.json'), 'utf8'));

const ERD_KEYS = Object.keys(en.dashboards_page || {}).filter((k) => k.startsWith('erd_'));

const JOIN_LIST_LABELS = {
  de: 'Join-Liste',
  es: 'Lista de uniones',
  fr: 'Liste des jointures',
  id: 'Daftar join',
  ja: '結合リスト',
  km: 'បញ្ជី join',
  th: 'รายการ join',
  vi: 'Danh sách join',
  zh: '连接列表',
};

const RESTORING = {
  de: 'Unterhaltung wird wiederhergestellt…',
  es: 'Restaurando la conversación…',
  fr: 'Restauration de la conversation…',
  id: 'Memulihkan percakapan…',
  ja: '会話を復元しています…',
  km: 'កំពុងស្តារការសន្ទនា…',
  th: 'กำลังกู้คืนการสนทนา…',
  vi: 'Đang khôi phục cuộc trò chuyện…',
  zh: '正在恢复对话…',
};

const ASK_PLAIN = {
  de: 'In einfachen Worten fragen',
  es: 'Preguntar en lenguaje natural',
  fr: 'Demander en langage courant',
  id: 'Tanya dengan bahasa biasa',
  ja: '自然な言葉で質問',
  km: 'សួរជាភាសាធម្មតា',
  th: 'ถามเป็นภาษาพูด',
  vi: 'Hỏi bằng ngôn ngữ tự nhiên',
  zh: '用自然语言提问',
};

const BROWSE_INSIGHTS = {
  de: 'Einblicke durchsuchen',
  es: 'Explorar insights',
  fr: 'Parcourir les insights',
  id: 'Jelajahi insight',
  ja: 'インサイトを見る',
  km: 'រុករកទស្សនៈ',
  th: 'เรียกดูอินไซต์',
  vi: 'Duyệt insight',
  zh: '浏览洞察',
};

const NAV_ASK = {
  de: 'Fragen',
  es: 'Preguntar',
  fr: 'Demander',
  id: 'Tanya',
  ja: '質問',
  km: 'សួរ',
  th: 'ถาม',
  vi: 'Hỏi',
  zh: '提问',
};

for (const file of fs.readdirSync(messagesDir)) {
  if (!file.endsWith('.json') || file === 'en.json') continue;
  const locale = file.replace('.json', '');
  const filePath = path.join(messagesDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  data.chat_page = data.chat_page || {};
  if (!data.chat_page.restoring_conversation) {
    data.chat_page.restoring_conversation = RESTORING[locale] || en.chat_page.restoring_conversation;
  }
  if (data.chat_page.feedback_modal_desc && !data.chat_page.feedback_modal_hint) {
    data.chat_page.feedback_modal_hint = data.chat_page.feedback_modal_desc;
    delete data.chat_page.feedback_modal_desc;
  }
  if (data.chat_page.feedback_placeholder && !data.chat_page.feedback_modal_placeholder) {
    data.chat_page.feedback_modal_placeholder = data.chat_page.feedback_placeholder;
    delete data.chat_page.feedback_placeholder;
  }

  if (data.dashboards?.data_model_relationships_table && !data.dashboards.data_model_relationships_section) {
    data.dashboards.data_model_relationships_section = data.dashboards.data_model_relationships_table;
    delete data.dashboards.data_model_relationships_table;
  }

  data.dashboards_page = data.dashboards_page || {};
  if (!data.dashboards_page.data_model_join_list) {
    data.dashboards_page.data_model_join_list =
      JOIN_LIST_LABELS[locale] || en.dashboards_page.data_model_join_list;
  }
  if (data.dashboards_page.data_model_relationships_table) {
    delete data.dashboards_page.data_model_relationships_table;
  }
  if (data.dashboards_page.data_no_sources) {
    delete data.dashboards_page.data_no_sources;
  }
  for (const key of ERD_KEYS) {
    if (data.dashboards_page[key] === undefined && en.dashboards_page[key] !== undefined) {
      data.dashboards_page[key] = en.dashboards_page[key];
    }
  }

  if (data.feed) {
    if (data.feed.discover === 'Discover' || data.feed.discover === 'discover') {
      data.feed.discover = BROWSE_INSIGHTS[locale] || en.feed.discover;
    }
    if (data.feed.discover_sidebar === 'Discover') {
      data.feed.discover_sidebar = BROWSE_INSIGHTS[locale] || en.feed.discover_sidebar;
    }
  }

  if (data.nav?.chat && data.nav.chat.includes('Chat')) {
    data.nav.chat = NAV_ASK[locale] || en.nav.chat;
  }

  if (data.query_editor?.ask_ai_engine) {
    data.query_editor.ask_ai_engine = ASK_PLAIN[locale] || en.query_editor.ask_ai_engine;
  }

  data.chat_page = data.chat_page || {};
  for (const key of ['trust_badge_t1', 'trust_badge_t2', 'trust_badge_t0']) {
    if (data.chat_page[key] === undefined && en.chat_page?.[key]) {
      data.chat_page[key] = en.chat_page[key];
    }
  }

  if (data.settings_nav && en.settings_nav) {
    for (const key of [
      'identity_label',
      'identity_desc',
      'integrations_desc',
      'ai-decision-layer_label',
      'ai-decision-layer_desc',
    ]) {
      if (en.settings_nav[key]) data.settings_nav[key] = en.settings_nav[key];
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log('Updated', file);
}

console.log('Locale sync done.');
