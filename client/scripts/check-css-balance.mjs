#!/usr/bin/env node
/**
 * Verifies CSS files have balanced `{` / `}` (ignoring strings and comments).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');

function braceDepth(css) {
  let depth = 0;
  let inComment = false;
  let inString = false;
  let strChar = '';

  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (!inString && c === '/' && css[i + 1] === '*') {
      inComment = true;
      i++;
      continue;
    }
    if (inComment && c === '*' && css[i + 1] === '/') {
      inComment = false;
      i++;
      continue;
    }
    if (inComment) continue;
    if (!inString && (c === '"' || c === "'")) {
      inString = true;
      strChar = c;
      continue;
    }
    if (inString && c === strChar && css[i - 1] !== '\\') {
      inString = false;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (depth < 0) return depth;
  }
  return depth;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const roots = [path.join(clientRoot, 'src'), path.join(clientRoot, 'ee')].filter((p) =>
  fs.existsSync(p),
);

const files = roots.flatMap((root) => walk(root));
const failures = [];

for (const file of files) {
  const css = fs.readFileSync(file, 'utf8');
  const depth = braceDepth(css);
  if (depth !== 0) {
    failures.push({ file: path.relative(clientRoot, file), depth });
  }
}

if (failures.length) {
  console.error('CSS brace balance check failed:');
  for (const f of failures) {
    console.error(`  ${f.file}: depth ${f.depth}`);
  }
  process.exit(1);
}

console.log(`CSS brace balance OK (${files.length} files)`);
