const fs = require('fs');
const path = require('path');

const startServerPaths = [
  path.join(process.cwd(), 'node_modules', 'next', 'dist', 'server', 'lib', 'start-server.js'),
  path.join(process.cwd(), 'node_modules', 'next', 'dist', 'esm', 'server', 'lib', 'start-server.js'),
];
const nextDevPath = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'cli', 'next-dev.js');

const replacements = [
  [
    'if (_v8.default.getHeapStatistics().used_heap_size > 0.8 * _v8.default.getHeapStatistics().heap_size_limit) {',
    'if (false && _v8.default.getHeapStatistics().used_heap_size > 0.8 * _v8.default.getHeapStatistics().heap_size_limit) {',
  ],
  [
    'if (v8.getHeapStatistics().used_heap_size > 0.8 * v8.getHeapStatistics().heap_size_limit) {',
    'if (false && v8.getHeapStatistics().used_heap_size > 0.8 * v8.getHeapStatistics().heap_size_limit) {',
  ],
];

let patched = 0;
let skipped = 0;

for (const startServerPath of startServerPaths) {
  try {
    if (!fs.existsSync(startServerPath)) {
      skipped += 1;
      continue;
    }

    let source = fs.readFileSync(startServerPath, 'utf8');
    let changed = false;

    for (const [memoryCheck, patchedMemoryCheck] of replacements) {
      if (source.includes(patchedMemoryCheck)) {
        continue;
      }
      if (source.includes(memoryCheck)) {
        source = source.replace(memoryCheck, patchedMemoryCheck);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(startServerPath, source);
      patched += 1;
    }
  } catch (error) {
    console.warn(`[next-dev-patch] failed to patch ${startServerPath}: ${error.message}`);
  }
}

try {
  if (fs.existsSync(nextDevPath)) {
    const restartExitOnly = 'if (code === _utils.RESTART_EXIT_CODE) {';
    const restartCleanWorkerExit = 'if (code === _utils.RESTART_EXIT_CODE || code === 0) {';
    const source = fs.readFileSync(nextDevPath, 'utf8');

    if (!source.includes(restartCleanWorkerExit) && source.includes(restartExitOnly)) {
      fs.writeFileSync(nextDevPath, source.replace(restartExitOnly, restartCleanWorkerExit));
      patched += 1;
    }
  }
} catch (error) {
  console.warn(`[next-dev-patch] failed to patch ${nextDevPath}: ${error.message}`);
}

if (patched > 0) {
  console.log(`[next-dev-patch] disabled Next.js dev memory auto-restart in ${patched} file(s)`);
} else if (skipped === startServerPaths.length) {
  console.warn('[next-dev-patch] start-server.js not found; skipping memory watcher patch');
}
