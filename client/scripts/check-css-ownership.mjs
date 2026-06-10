#!/usr/bin/env node
/**
 * Warn when component-scoped CSS files declare global Ant Design owners.
 * Canonical owners: aiser-unified-design-system.css + aiser-interaction-system.css
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');

const GLOBAL_OWNERS = [
  /^\.ant-btn(?:[^-]|$)/,
  /^\.ant-btn-primary/,
  /^\.ant-card(?:[^-]|$)/,
  /^\.ant-dropdown-menu/,
  /^\.ant-modal-content/,
];

const ALLOWLIST = new Set([
  path.normalize('src/styles/aiser-unified-design-system.css'),
  path.normalize('src/styles/aiser-interaction-system.css'),
  path.normalize('src/styles/aiser-color-system.css'),
  path.normalize('src/styles/workspace-chrome.css'),
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function scanFile(css) {
  const issues = [];
  const lines = css.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    for (const re of GLOBAL_OWNERS) {
      if (re.test(trimmed) && !trimmed.includes('.chat-panel') && !trimmed.includes('.query-editor')) {
        issues.push({ line: i + 1, text: trimmed });
        break;
      }
    }
  }
  return issues;
}

const roots = [path.join(clientRoot, 'src'), path.join(clientRoot, 'ee')].filter((p) =>
  fs.existsSync(p),
);

const warnings = [];

for (const file of roots.flatMap((root) => walk(root))) {
  const rel = path.relative(clientRoot, file).split(path.sep).join('/');
  if (ALLOWLIST.has(path.normalize(rel))) continue;
  if (rel.includes('/styles/aiser-')) continue;
  const issues = scanFile(fs.readFileSync(file, 'utf8'));
  if (issues.length) warnings.push({ rel, issues });
}

if (warnings.length) {
  console.warn('Global Ant Design selector warnings (review one-owner-per-control):');
  for (const w of warnings) {
    console.warn(`\n${w.rel}`);
    for (const issue of w.issues.slice(0, 5)) {
      console.warn(`  L${issue.line}: ${issue.text}`);
    }
    if (w.issues.length > 5) console.warn(`  … +${w.issues.length - 5} more`);
  }
}

console.log('CSS ownership scan complete.');
