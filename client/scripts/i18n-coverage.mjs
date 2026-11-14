import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(__dirname, '../src/messages');

export function flatten(value, prefix = '') {
  return Object.entries(value || {}).reduce((out, [key, item]) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      Object.assign(out, flatten(item, `${prefix}${key}.`));
    } else {
      out[`${prefix}${key}`] = String(item);
    }
    return out;
  }, {});
}

export function computeCoverage(options = {}) {
  const dir = options.messagesDir || messagesDir;
  const en = flatten(JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')));
  const id = flatten(JSON.parse(readFileSync(join(dir, 'id.json'), 'utf8')));

  let allowlist = { allowedPhrases: [], allowedKeys: [] };
  const allowlistPath = join(dir, 'id.allowlist.json');
  if (existsSync(allowlistPath)) {
    try {
      allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
    } catch {
      // ignore parse error if allowlist is malformed
    }
  }

  const allowedPhrasesSet = new Set((allowlist.allowedPhrases || []).map((p) => p.trim().toLowerCase()));
  const allowedKeysSet = new Set(allowlist.allowedKeys || []);

  const namespaces = {};

  for (const [key, enValue] of Object.entries(en)) {
    const ns = key.split('.')[0] || 'root';
    if (!namespaces[ns]) {
      namespaces[ns] = {
        namespace: ns,
        total: 0,
        missing: 0,
        sameAsEn: 0,
        translated: 0,
      };
    }
    const stat = namespaces[ns];
    stat.total += 1;

    if (!(key in id)) {
      stat.missing += 1;
      continue;
    }

    const idValue = id[key];
    const isAllowlisted = allowedKeysSet.has(key) || allowedPhrasesSet.has(String(enValue).trim().toLowerCase());

    if (idValue !== enValue || isAllowlisted) {
      stat.translated += 1;
    } else {
      stat.sameAsEn += 1;
    }
  }

  const rows = Object.values(namespaces)
    .sort((a, b) => a.namespace.localeCompare(b.namespace))
    .map((item) => {
      const percentage = item.total > 0 ? (item.translated / item.total) * 100 : 0;
      return {
        ...item,
        coveragePct: parseFloat(percentage.toFixed(2)),
      };
    });

  const totals = rows.reduce(
    (acc, row) => {
      acc.total += row.total;
      acc.missing += row.missing;
      acc.sameAsEn += row.sameAsEn;
      acc.translated += row.translated;
      return acc;
    },
    { namespace: 'TOTAL', total: 0, missing: 0, sameAsEn: 0, translated: 0, coveragePct: 0 }
  );

  totals.coveragePct = totals.total > 0 ? parseFloat(((totals.translated / totals.total) * 100).toFixed(2)) : 0;

  return { rows, totals };
}

// If executed directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { rows, totals } = computeCoverage();

  console.log('\n========================================================================================');
  console.log('                        i18n Coverage Report: Indonesian (id)                           ');
  console.log('========================================================================================\n');

  console.log(
    'Namespace'.padEnd(25) +
      'Total'.padStart(8) +
      'Missing'.padStart(10) +
      'Same as EN'.padStart(14) +
      'Translated'.padStart(14) +
      'Coverage'.padStart(12)
  );
  console.log('-'.repeat(83));

  for (const r of rows) {
    console.log(
      r.namespace.padEnd(25) +
        String(r.total).padStart(8) +
        String(r.missing).padStart(10) +
        String(r.sameAsEn).padStart(14) +
        String(r.translated).padStart(14) +
        `${r.coveragePct.toFixed(2)}%`.padStart(12)
    );
  }

  console.log('-'.repeat(83));
  console.log(
    totals.namespace.padEnd(25) +
      String(totals.total).padStart(8) +
      String(totals.missing).padStart(10) +
      String(totals.sameAsEn).padStart(14) +
      String(totals.translated).padStart(14) +
      `${totals.coveragePct.toFixed(2)}%`.padStart(12)
  );
  console.log('========================================================================================\n');
}
